import { existsSync } from 'node:fs';
import type { Clip, Grade, TimelineSpec } from '@/lib/timeline/spec';
import { clipDuration, totalDuration } from '@/lib/timeline/spec';

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * A render plan is fully resolved: every clip knows which input file feeds it
 * and how long it is. This is the last structure before ffmpeg arguments, and
 * it is pure — the same plan always produces the same command line.
 */
export type RenderSource = {
  assetId: string;
  filePath: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
};

export type PlannedClip = {
  clip: Clip;
  inputIndex: number;
  source: RenderSource;
  durationSec: number;
  /** True when this clip needs scaling/padding to match the output frame. */
  needsNormalize: boolean;
};

/** A punch-in resolved into clip-local time, ready for the filter graph. */
export type PlannedPunchIn = {
  /** Index of the clip this window belongs to. */
  clipIndex: number;
  localStartSec: number;
  localEndSec: number;
  scale: number;
};

/**
 * A clip cut into consecutive pieces at punch-in boundaries. Only the pieces
 * inside a punch window get a zoompan pass, so pixels outside the window are
 * never resampled (zoompan always resizes, even at zoom = 1, so applying it to
 * the whole clip would soften footage the user never asked to zoom).
 */
export type PlannedSegment = {
  clipIndex: number;
  clip: Clip;
  inputIndex: number;
  source: RenderSource;
  /** Absolute range in the source file, already offset by the clip's in-point. */
  sourceInSec: number;
  sourceOutSec: number;
  durationSec: number;
  needsNormalize: boolean;
  /** Zoom factor for this segment, or null when it is unzoomed. */
  punchScale: number | null;
};

export type PlannedCaption = {
  startSec: number;
  endSec: number;
  text: string;
  position: 'top' | 'center' | 'bottom';
};

export type RenderPlan = {
  inputs: RenderSource[];
  clips: PlannedClip[];
  width: number;
  height: number;
  fps: number;
  outputDurationSec: number;
  /** Clip count whose source has no audio track and needs generated silence. */
  silentClips: number;
  grade: Grade;
  punchIns: PlannedPunchIn[];
  segments: PlannedSegment[];
  captions: PlannedCaption[];
  /** Font actually available for drawtext, resolved once here (never re-guessed). */
  captionFont: string | null;
  /** Things the renderer could not do, reported back to the user honestly. */
  warnings: string[];
};

export type PlanOptions = {
  /**
   * Overrides font resolution. `undefined` looks on this host, `null` forces the
   * no-font path (captions are skipped with a warning).
   */
  captionFont?: string | null;
};

export const DEFAULT_FPS = 30;

/** Sum of clip durations, computed the way the renderer will. */
export function planDuration(plan: RenderPlan): number {
  return plan.clips.reduce((sum, planned) => sum + planned.durationSec, 0);
}

export class RenderPlanError extends Error {}

export function planRender(
  spec: TimelineSpec,
  sources: RenderSource[],
  options: PlanOptions = {},
): RenderPlan {
  if (spec.clips.length === 0) throw new RenderPlanError('Timeline has no clips to render.');

  const byId = new Map(sources.map((source) => [source.assetId, source]));

  // Input order is derived from first appearance in the timeline, so the plan is
  // a function of the spec plus the source metadata only.
  const inputs: RenderSource[] = [];
  const inputIndexByAsset = new Map<string, number>();

  for (const clip of spec.clips) {
    const source = byId.get(clip.assetId);
    if (!source) {
      throw new RenderPlanError(`Timeline references media ${clip.assetId} that is not available.`);
    }
    if (!inputIndexByAsset.has(clip.assetId)) {
      inputIndexByAsset.set(clip.assetId, inputs.length);
      inputs.push(source);
    }
  }

  // Output frame: largest source, preferring 16:9-friendly even dimensions.
  const width = even(Math.max(...inputs.map((s) => s.width ?? 0), 0)) || 1280;
  const height = even(Math.max(...inputs.map((s) => s.height ?? 0), 0)) || 720;
  const fps = pickFps(inputs);

  const clips: PlannedClip[] = spec.clips.map((clip) => {
    const source = byId.get(clip.assetId)!;
    const needsNormalize =
      (source.width ?? width) !== width ||
      (source.height ?? height) !== height ||
      (source.fps ?? fps) !== fps;
    return {
      clip,
      inputIndex: inputIndexByAsset.get(clip.assetId)!,
      source,
      durationSec: clipDuration(clip),
      needsNormalize,
    };
  });

  const warnings: string[] = [];
  const punchIns = planPunches(spec, clips, warnings);
  const captionFont = resolveFont(options.captionFont, warnings);
  const captions = planCaptions(spec, clips, captionFont, warnings);
  const segments = planSegments(clips, punchIns);

  return {
    inputs,
    clips,
    width,
    height,
    fps,
    outputDurationSec: totalDuration(spec.clips),
    silentClips: clips.filter((planned) => !planned.source.hasAudio).length,
    grade: spec.grade ?? {},
    punchIns,
    segments,
    captions,
    captionFont,
    warnings,
  };
}

/**
 * Punch-ins are expressed in output (timeline) time but applied per clip, where
 * the stream's clock restarts at zero — so each one is mapped into the clip that
 * contains it.
 */
function planPunches(
  spec: TimelineSpec,
  clips: PlannedClip[],
  warnings: string[],
): PlannedPunchIn[] {
  const punchIns = spec.punchIns ?? [];
  if (punchIns.length === 0) return [];

  const placed = placeClipsLocal(clips);
  const planned: PlannedPunchIn[] = [];

  for (const punch of punchIns) {
    let matched = false;
    placed.forEach((entry, clipIndex) => {
      const from = Math.max(entry.outStart, punch.startSec);
      const to = Math.min(entry.outEnd, punch.endSec);
      if (to - from < 0.05) return;
      matched = true;
      planned.push({
        clipIndex,
        localStartSec: round3(from - entry.outStart),
        localEndSec: round3(to - entry.outStart),
        scale: punch.scale,
      });
    });
    if (!matched) warnings.push(`Punch-in at ${punch.startSec}s fell outside the timeline and was skipped.`);
  }

  return planned;
}

/** Punch windows shorter than this are not worth their own segment. */
export const MIN_SEGMENT_SEC = 0.05;

/**
 * Splits every clip at its punch-in boundaries so a zoom is applied to exactly the
 * frames the window covers. Pure: same clips + same punch-ins => same segments.
 */
export function planSegments(clips: PlannedClip[], punchIns: PlannedPunchIn[]): PlannedSegment[] {
  const segments: PlannedSegment[] = [];

  clips.forEach((planned, clipIndex) => {
    const duration = planned.durationSec;

    const windows = punchIns
      .filter((punch) => punch.clipIndex === clipIndex)
      .map((punch) => ({
        startSec: Math.max(0, Math.min(punch.localStartSec, duration)),
        endSec: Math.max(0, Math.min(punch.localEndSec, duration)),
        scale: punch.scale,
      }))
      .filter((window) => window.endSec - window.startSec >= MIN_SEGMENT_SEC)
      .sort((a, b) => a.startSec - b.startSec);

    // Overlapping windows collapse into one segment, keeping the strongest zoom.
    const merged: { startSec: number; endSec: number; scale: number }[] = [];
    for (const window of windows) {
      const last = merged[merged.length - 1];
      if (last && window.startSec < last.endSec) {
        last.endSec = Math.max(last.endSec, window.endSec);
        last.scale = Math.max(last.scale, window.scale);
      } else {
        merged.push({ ...window });
      }
    }

    const push = (localStart: number, localEnd: number, scale: number | null) => {
      if (localEnd - localStart < 0.001) return;
      segments.push({
        clipIndex,
        clip: planned.clip,
        inputIndex: planned.inputIndex,
        source: planned.source,
        sourceInSec: round3(planned.clip.inSec + localStart),
        sourceOutSec: round3(planned.clip.inSec + localEnd),
        durationSec: localEnd - localStart,
        needsNormalize: planned.needsNormalize,
        punchScale: scale,
      });
    };

    let cursor = 0;
    for (const window of merged) {
      if (window.startSec - cursor > 0) push(cursor, window.startSec, null);
      push(window.startSec, window.endSec, window.scale);
      cursor = window.endSec;
    }
    if (duration - cursor > 0) push(cursor, duration, null);
  });

  return segments;
}

function planCaptions(
  spec: TimelineSpec,
  clips: PlannedClip[],
  captionFont: string | null,
  warnings: string[],
): PlannedCaption[] {
  const captions = spec.captions ?? [];
  if (captions.length === 0) return [];

  const total = clips.reduce((sum, planned) => sum + planned.durationSec, 0);
  const planned: PlannedCaption[] = [];
  for (const caption of captions) {
    const start = Math.max(0, Math.min(caption.startSec, total));
    const end = Math.max(start + 0.2, Math.min(caption.endSec, total));
    if (end - start < 0.05) {
      warnings.push(`Caption "${caption.text.slice(0, 24)}" fell outside the timeline and was skipped.`);
      continue;
    }
    planned.push({
      startSec: round3(start),
      endSec: round3(end),
      text: caption.text,
      position: caption.position,
    });
  }

  if (captionFont === null) {
    if (planned.length > 0) {
      warnings.push(
        'Captions were requested but no usable font was found on this host, so none were drawn.',
      );
    }
    return [];
  }

  return planned;
}

export type PlacedClipLocal = { clip: Clip; outStart: number; outEnd: number; index: number };

export function placeClipsLocal(clips: PlannedClip[]): PlacedClipLocal[] {
  let cursor = 0;
  return clips.map((planned, index) => {
    const outStart = round3(cursor);
    cursor += planned.durationSec;
    return { clip: planned.clip, index, outStart, outEnd: round3(cursor) };
  });
}

export const CAPTION_FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];

/**
 * Captions need a font file. If the host has none, the plan says so instead of
 * silently rendering a caption-less export.
 */
export function resolveCaptionFont(): string | null {
  if (process.env.MODAYA_CAPTION_FONT) return process.env.MODAYA_CAPTION_FONT;
  for (const candidate of CAPTION_FONT_CANDIDATES) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * An explicit font (options or MODAYA_CAPTION_FONT) is honoured only when the file
 * is really there; a configured-but-missing font is called out rather than quietly
 * swapped for a different one.
 */
function resolveFont(override: string | null | undefined, warnings: string[]): string | null {
  if (override === null) return null;
  if (typeof override === 'string') {
    if (existsSync(override)) return override;
    warnings.push(`Configured caption font ${override} was not found, so captions were skipped.`);
    return null;
  }
  return resolveCaptionFont();
}

function even(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function pickFps(inputs: RenderSource[]): number {
  const rates = inputs.map((s) => s.fps).filter((fps): fps is number => Boolean(fps));
  if (rates.length === 0) return DEFAULT_FPS;
  // Common rates snap to their exact rational value; otherwise fall back to a
  // conservative 30fps so VFR phone footage renders cleanly.
  const candidate = Math.max(...rates);
  const known = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const closest = known.reduce((best, rate) =>
    Math.abs(rate - candidate) < Math.abs(best - candidate) ? rate : best,
  );
  return Math.abs(closest - candidate) < 0.02 ? closest : DEFAULT_FPS;
}

/** Formats seconds with fixed precision so commands are byte-for-byte stable. */
export function sec(value: number): string {
  return value.toFixed(6);
}
