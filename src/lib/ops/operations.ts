import { z } from 'zod';
import { clipsDuration, removeOutputRanges, removeSourceRanges, trimTo } from '@/lib/timeline/ops';
import {
  clamp,
  DEFAULT_POSITION,
  round3,
  type Caption,
  type Clip,
  type Grade,
  type PunchIn,
  type TimelineSpec,
} from '@/lib/timeline/spec';

/**
 * The operation vocabulary. A model never edits a timeline: it returns a list of
 * these, which are validated and clamped before anything is rendered.
 */
export const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('remove_ranges'),
    ranges: z.array(z.object({ startSec: z.number(), endSec: z.number() })).min(1).max(200),
    /** output = timeline time (what the user sees); source = the source file's own clock. */
    timebase: z.enum(['output', 'source']).default('output'),
  }),
  z.object({
    op: z.literal('keep_ranges'),
    ranges: z.array(z.object({ startSec: z.number(), endSec: z.number() })).min(1).max(200),
    timebase: z.enum(['output', 'source']).default('output'),
  }),
  z.object({
    op: z.literal('trim_to'),
    startSec: z.number(),
    endSec: z.number(),
  }),
  z.object({
    op: z.literal('add_captions'),
    captions: z
      .array(
        z.object({
          startSec: z.number(),
          endSec: z.number(),
          text: z.string().min(1).max(240),
        }),
      )
      .min(1)
      .max(200),
    position: z.enum(['top', 'center', 'bottom']).default(DEFAULT_POSITION),
  }),
  z.object({
    op: z.literal('punch_in'),
    punchIns: z
      .array(z.object({ startSec: z.number(), endSec: z.number(), scale: z.number() }))
      .min(1)
      .max(100),
  }),
  z.object({
    op: z.literal('grade'),
    brightness: z.number().optional(),
    contrast: z.number().optional(),
    saturation: z.number().optional(),
    gamma: z.number().optional(),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;
export type OperationKind = Operation['op'];

export const OPERATION_KINDS: OperationKind[] = [
  'remove_ranges',
  'keep_ranges',
  'trim_to',
  'add_captions',
  'punch_in',
  'grade',
];

/**
 * Where an operation came from. `field` is a path into a StyleProfile, so every
 * automatic edit can be pointed at the measurement that produced it.
 */
export type Grounding = {
  source: 'style_profile' | 'user_request' | 'system';
  field: string;
  value?: string;
  reason: string;
};

export type OperationOutcome = {
  spec: TimelineSpec;
  applied: { op: OperationKind; detail: string }[];
  dropped: { op: string; reason: string }[];
  grounding: Grounding[];
};

export type ClampContext = {
  /** Longest allowed extent for output-time values (the current timeline length). */
  outputDurationSec: number;
  /** Longest allowed extent for source-time values (the media's own duration). */
  sourceDurationSec: number;
};

export type ProposedOperation = {
  operation: unknown;
  grounding?: Grounding;
};

const GRADE_LIMITS = {
  brightness: { min: -1, max: 1 },
  contrast: { min: 0, max: 3 },
  saturation: { min: 0, max: 3 },
  gamma: { min: 0.1, max: 3 },
} as const;

export const PUNCH_IN_LIMITS = { min: 1, max: 3 } as const;

function clampRange(
  range: { startSec: number; endSec: number },
  limit: number,
): { startSec: number; endSec: number } | null {
  const lo = clamp(Math.min(range.startSec, range.endSec), 0, limit);
  const hi = clamp(Math.max(range.startSec, range.endSec), 0, limit);
  if (hi - lo < 0.05) return null;
  return { startSec: round3(lo), endSec: round3(hi) };
}

/**
 * Validate and clamp a proposed operation list against the actual media.
 *
 * Everything that survives is inside the real duration of the media it refers
 * to; everything that cannot be expressed safely is dropped with a reason
 * rather than silently mangled.
 */
export function applyOperations(
  spec: TimelineSpec,
  proposed: ProposedOperation[],
  ctx: ClampContext,
): OperationOutcome {
  const applied: OperationOutcome['applied'] = [];
  const dropped: OperationOutcome['dropped'] = [];
  const grounding: Grounding[] = [];

  let clips: Clip[] = spec.clips;
  let grade: Grade = spec.grade ?? {};
  let punchIns: PunchIn[] = spec.punchIns ?? [];
  let captions: Caption[] = spec.captions ?? [];

  for (const item of proposed) {
    const parsed = operationSchema.safeParse(item.operation);
    if (!parsed.success) {
      const opName =
        typeof item.operation === 'object' && item.operation !== null
          ? String((item.operation as { op?: unknown }).op ?? 'unknown')
          : 'unknown';
      dropped.push({
        op: opName,
        reason: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'op'}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }

    const operation = parsed.data;
    const groundingEntry = item.grounding ?? {
      source: 'user_request' as const,
      field: 'chat.operations',
      reason: 'Requested directly in chat.',
    };

    switch (operation.op) {
      case 'remove_ranges': {
        const limit = operation.timebase === 'source' ? ctx.sourceDurationSec : ctx.outputDurationSec;
        const ranges = operation.ranges
          .map((range) => clampRange(range, limit))
          .filter((range): range is { startSec: number; endSec: number } => range !== null);
        if (ranges.length === 0) {
          dropped.push({ op: operation.op, reason: 'All ranges fell outside the media.' });
          break;
        }
        const next =
          operation.timebase === 'source'
            ? removeSourceRanges(clips, ranges)
            : removeOutputRanges(clips, ranges);
        if (next.length === 0) {
          dropped.push({ op: operation.op, reason: 'That would remove everything on the timeline.' });
          break;
        }
        const before = clipsDuration(clips);
        clips = next;
        applied.push({
          op: operation.op,
          detail: `${ranges.length} range(s) removed, ${round3(before - clipsDuration(clips))}s cut (${operation.timebase} time)`,
        });
        grounding.push(groundingEntry);
        break;
      }

      case 'keep_ranges': {
        const limit = operation.timebase === 'source' ? ctx.sourceDurationSec : ctx.outputDurationSec;
        const ranges = operation.ranges
          .map((range) => clampRange(range, limit))
          .filter((range): range is { startSec: number; endSec: number } => range !== null)
          .sort((a, b) => a.startSec - b.startSec);
        if (ranges.length === 0) {
          dropped.push({ op: operation.op, reason: 'All ranges fell outside the media.' });
          break;
        }
        // Keeping ranges == trimming to each kept window, in order.
        let kept: Clip[] = [];
        for (const range of ranges) kept = kept.concat(trimTo(clips, range));
        if (kept.length === 0) {
          dropped.push({ op: operation.op, reason: 'Nothing left inside the kept ranges.' });
          break;
        }
        clips = kept;
        applied.push({ op: operation.op, detail: `kept ${ranges.length} range(s)` });
        grounding.push(groundingEntry);
        break;
      }

      case 'trim_to': {
        const range = clampRange(
          { startSec: operation.startSec, endSec: operation.endSec },
          ctx.outputDurationSec,
        );
        if (!range) {
          dropped.push({ op: operation.op, reason: 'Requested trim falls outside the timeline.' });
          break;
        }
        const next = trimTo(clips, range);
        if (next.length === 0) {
          dropped.push({ op: operation.op, reason: 'Trim left nothing behind.' });
          break;
        }
        clips = next;
        applied.push({ op: operation.op, detail: `trimmed to ${range.startSec}–${range.endSec}s` });
        grounding.push(groundingEntry);
        break;
      }

      case 'add_captions': {
        const limit = clipsDuration(clips);
        const next: Caption[] = [];
        for (const caption of operation.captions) {
          const range = clampRange({ startSec: caption.startSec, endSec: caption.endSec }, limit);
          const text = caption.text.replace(/\s+/g, ' ').trim();
          if (!range || text.length === 0) continue;
          next.push({
            id: `cap-${next.length}-${round3(range.startSec)}`,
            startSec: range.startSec,
            endSec: range.endSec,
            text: text.slice(0, 240),
            position: operation.position,
          });
        }
        if (next.length === 0) {
          dropped.push({ op: operation.op, reason: 'No caption fell inside the timeline.' });
          break;
        }
        captions = captions.concat(next);
        applied.push({ op: operation.op, detail: `${next.length} caption(s) at ${operation.position}` });
        grounding.push(groundingEntry);
        break;
      }

      case 'punch_in': {
        const limit = clipsDuration(clips);
        const next: PunchIn[] = [];
        for (const punch of operation.punchIns) {
          const range = clampRange({ startSec: punch.startSec, endSec: punch.endSec }, limit);
          if (!range) continue;
          next.push({
            id: `punch-${next.length}-${round3(range.startSec)}`,
            startSec: range.startSec,
            endSec: range.endSec,
            scale: round3(clamp(punch.scale, PUNCH_IN_LIMITS.min, PUNCH_IN_LIMITS.max)),
          });
        }
        if (next.length === 0) {
          dropped.push({ op: operation.op, reason: 'No punch-in fell inside the timeline.' });
          break;
        }
        punchIns = punchIns.concat(next);
        applied.push({ op: operation.op, detail: `${next.length} punch-in(s)` });
        grounding.push(groundingEntry);
        break;
      }

      case 'grade': {
        const next: Grade = { ...grade };
        const changes: string[] = [];
        for (const key of ['brightness', 'contrast', 'saturation', 'gamma'] as const) {
          const value = operation[key];
          if (value === undefined || !Number.isFinite(value)) continue;
          const limits = GRADE_LIMITS[key];
          const clamped = round3(clamp(value, limits.min, limits.max));
          next[key] = clamped;
          changes.push(`${key}=${clamped}`);
        }
        if (changes.length === 0) {
          dropped.push({ op: operation.op, reason: 'No usable grade parameters.' });
          break;
        }
        grade = next;
        applied.push({ op: operation.op, detail: changes.join(', ') });
        grounding.push(groundingEntry);
        break;
      }

      default: {
        dropped.push({ op: 'unknown', reason: 'Unrecognised operation.' });
      }
    }
  }

  return {
    spec: {
      version: 1,
      clips,
      ...(Object.keys(grade).length > 0 ? { grade } : {}),
      ...(punchIns.length > 0 ? { punchIns } : {}),
      ...(captions.length > 0 ? { captions } : {}),
    },
    applied,
    dropped,
    grounding,
  };
}
