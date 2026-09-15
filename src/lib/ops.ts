import { z } from "zod";
import {
  clipId,
  keepTimelineRanges,
  normalizeRanges,
  removeTimelineRanges,
  timelineDuration,
  type Timeline,
} from "./timeline";

/**
 * The operation vocabulary. The LLM may ONLY emit these — it never touches the
 * timeline object. Every op is validated and clamped server-side before it can
 * reach the ffmpeg queue.
 */
const range = z.object({ start: z.number(), end: z.number() });

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("remove_ranges"), ranges: z.array(range).min(1), reason: z.string().max(300).optional() }),
  z.object({ op: z.literal("keep_ranges"), ranges: z.array(range).min(1), reason: z.string().max(300).optional() }),
  z.object({ op: z.literal("trim_to"), start: z.number(), end: z.number(), reason: z.string().max(300).optional() }),
  z.object({
    op: z.literal("add_captions"),
    captions: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().min(1).max(200) })).min(1),
    style: z
      .object({
        position: z.enum(["top", "center", "bottom"]).optional(),
        fontSizePct: z.number().optional(),
        uppercase: z.boolean().optional(),
      })
      .optional(),
    reason: z.string().max(300).optional(),
  }),
  z.object({ op: z.literal("punch_in"), at: z.number(), durationSec: z.number(), zoom: z.number(), reason: z.string().max(300).optional() }),
  z.object({
    op: z.literal("grade"),
    exposure: z.number().optional(),
    contrast: z.number().optional(),
    saturation: z.number().optional(),
    temperature: z.number().optional(),
    reason: z.string().max(300).optional(),
  }),
]);
export type Op = z.infer<typeof opSchema>;

export type AppliedOp = {
  op: Op;
  applied: boolean;
  note: string;
  /** Which StyleProfile field justified this op, if any. */
  groundedIn?: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Parse a raw op list (from an LLM or a planner), dropping unknown op types
 * instead of failing the whole batch.
 */
export function parseOps(raw: unknown): { ops: Op[]; dropped: { value: unknown; reason: string }[] } {
  const ops: Op[] = [];
  const dropped: { value: unknown; reason: string }[] = [];
  const arr = Array.isArray(raw) ? raw : [];
  for (const item of arr) {
    const parsed = opSchema.safeParse(item);
    if (parsed.success) ops.push(parsed.data);
    else dropped.push({ value: item, reason: parsed.error.issues[0]?.message ?? "invalid op" });
  }
  return { ops, dropped };
}

/**
 * Apply ops to a timeline. Every timestamp is clamped to the timeline's real
 * duration; an op that clamps to nothing is recorded as not applied rather than
 * silently corrupting the edit.
 */
export function applyOps(timeline: Timeline, ops: Op[]): { timeline: Timeline; results: AppliedOp[] } {
  let t: Timeline = { ...timeline, clips: [...timeline.clips], captions: [...(timeline.captions ?? [])] };
  const results: AppliedOp[] = [];

  for (const op of ops) {
    const total = timelineDuration(t);
    const groundedIn = (op as { groundedIn?: string }).groundedIn;

    if (op.op === "remove_ranges" || op.op === "keep_ranges") {
      const ranges = normalizeRanges(op.ranges, total);
      if (!ranges.length) {
        results.push({ op, applied: false, note: `no range overlapped the ${total.toFixed(2)}s timeline`, groundedIn });
        continue;
      }
      const before = total;
      t = op.op === "remove_ranges" ? removeTimelineRanges(t, ranges) : keepTimelineRanges(t, ranges);
      const after = timelineDuration(t);
      if (after < 0.05) {
        // Refuse to produce an empty timeline.
        t = { ...t, clips: timeline.clips };
        results.push({ op, applied: false, note: "rejected: would empty the timeline", groundedIn });
        continue;
      }
      results.push({
        op,
        applied: true,
        note: `${op.op === "remove_ranges" ? "removed" : "kept"} ${ranges.length} range(s); ${before.toFixed(2)}s → ${after.toFixed(2)}s`,
        groundedIn,
      });
      continue;
    }

    if (op.op === "trim_to") {
      const start = clamp(Math.min(op.start, op.end), 0, total);
      const end = clamp(Math.max(op.start, op.end), 0, total);
      if (end - start < 0.05) {
        results.push({ op, applied: false, note: "clamped trim window was empty", groundedIn });
        continue;
      }
      t = keepTimelineRanges(t, [{ start, end }]);
      results.push({
        op,
        applied: true,
        note: `trimmed to ${start.toFixed(2)}–${end.toFixed(2)}s (${timelineDuration(t).toFixed(2)}s)`,
        groundedIn,
      });
      continue;
    }

    if (op.op === "add_captions") {
      const caps = op.captions
        .map((c) => ({
          start: clamp(Math.min(c.start, c.end), 0, total),
          end: clamp(Math.max(c.start, c.end), 0, total),
          text: c.text.slice(0, 200),
        }))
        .filter((c) => c.end - c.start > 0.05);
      if (!caps.length) {
        results.push({ op, applied: false, note: "no caption fell inside the timeline", groundedIn });
        continue;
      }
      t = {
        ...t,
        captions: [...(t.captions ?? []), ...caps].sort((a, b) => a.start - b.start),
        captionStyle: {
          position: op.style?.position ?? t.captionStyle?.position ?? "bottom",
          fontSizePct: clamp(op.style?.fontSizePct ?? t.captionStyle?.fontSizePct ?? 6, 2, 14),
          uppercase: op.style?.uppercase ?? t.captionStyle?.uppercase ?? false,
        },
      };
      results.push({ op, applied: true, note: `added ${caps.length} caption(s)`, groundedIn });
      continue;
    }

    if (op.op === "punch_in") {
      const at = clamp(op.at, 0, total);
      const dur = clamp(op.durationSec, 0.2, Math.max(0.2, total - at));
      const zoom = clamp(op.zoom, 1.01, 2);
      if (dur < 0.2) {
        results.push({ op, applied: false, note: "punch-in window outside the timeline", groundedIn });
        continue;
      }
      // Split the covered clips so the zoom applies to exactly that window.
      const clips = [];
      let cursor = 0;
      let touched = 0;
      for (const c of t.clips) {
        const len = Math.max(0, c.end - c.start);
        const s = cursor;
        const e = cursor + len;
        cursor = e;
        const ovStart = Math.max(s, at);
        const ovEnd = Math.min(e, at + dur);
        if (ovEnd <= ovStart) {
          clips.push(c);
          continue;
        }
        const head = { ...c, id: clipId(), start: c.start, end: c.start + (ovStart - s) };
        const mid = { ...c, id: clipId(), start: c.start + (ovStart - s), end: c.start + (ovEnd - s), punchIn: zoom };
        const tail = { ...c, id: clipId(), start: c.start + (ovEnd - s), end: c.end };
        for (const part of [head, mid, tail]) if (part.end - part.start > 0.02) clips.push(part);
        touched++;
      }
      if (!touched) {
        results.push({ op, applied: false, note: "punch-in matched no clip", groundedIn });
        continue;
      }
      t = { ...t, clips };
      results.push({
        op,
        applied: true,
        note: `punch-in ${zoom.toFixed(2)}× at ${at.toFixed(2)}s for ${dur.toFixed(2)}s`,
        groundedIn,
      });
      continue;
    }

    if (op.op === "grade") {
      const grade = {
        ...(op.exposure !== undefined ? { exposure: clamp(op.exposure, -1, 1) } : {}),
        ...(op.contrast !== undefined ? { contrast: clamp(op.contrast, 0.5, 2) } : {}),
        ...(op.saturation !== undefined ? { saturation: clamp(op.saturation, 0, 3) } : {}),
        ...(op.temperature !== undefined ? { temperature: clamp(op.temperature, -1, 1) } : {}),
      };
      if (!Object.keys(grade).length) {
        results.push({ op, applied: false, note: "grade op had no parameters", groundedIn });
        continue;
      }
      t = { ...t, clips: t.clips.map((c) => ({ ...c, grade: { ...c.grade, ...grade } })) };
      results.push({
        op,
        applied: true,
        note: `graded ${t.clips.length} clip(s): ${Object.entries(grade).map(([k, v]) => `${k}=${(v as number).toFixed(3)}`).join(", ")}`,
        groundedIn,
      });
    }
  }

  return { timeline: t, results };
}
