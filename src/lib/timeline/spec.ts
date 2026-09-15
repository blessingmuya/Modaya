/**
 * A timeline spec is a deterministic list of source ranges played in order.
 * It is the *only* thing the renderer consumes — no UI state, no model output
 * goes straight to ffmpeg.
 */
export type Clip = {
  /** Local label only; the server assigns nothing semantic to it. */
  id: string;
  /** Media asset id (uuid) this range is cut from. */
  assetId: string;
  inSec: number;
  outSec: number;
};

export type TimelineSpec = {
  version: 1;
  clips: Clip[];
};

export const MIN_CLIP_SEC = 0.05;

export function clipDuration(clip: Clip): number {
  return Math.max(0, clip.outSec - clip.inSec);
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
}

/** Round to milliseconds: keeps specs stable, readable and reproducible. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function normalizeClips(clips: Clip[]): Clip[] {
  return clips
    .map((clip) => ({
      ...clip,
      inSec: round3(Math.max(0, clip.inSec)),
      outSec: round3(Math.max(0, clip.outSec)),
    }))
    .filter((clip) => clipDuration(clip) >= MIN_CLIP_SEC);
}

export function createSpec(clips: Clip[]): TimelineSpec {
  return { version: 1, clips: normalizeClips(clips) };
}

/**
 * Every clip in output order, with the output-time interval each one occupies.
 * The renderer and the UI both derive from this, so they cannot disagree.
 */
export type PlacedClip = {
  clip: Clip;
  index: number;
  outStart: number;
  outEnd: number;
};

export function placeClips(clips: Clip[]): PlacedClip[] {
  let cursor = 0;
  return clips.map((clip, index) => {
    const duration = clipDuration(clip);
    const placed: PlacedClip = {
      clip,
      index,
      outStart: round3(cursor),
      outEnd: round3(cursor + duration),
    };
    cursor += duration;
    return placed;
  });
}

export function isTimelineSpec(value: unknown): value is TimelineSpec {
  if (!value || typeof value !== 'object') return false;
  const spec = value as { version?: unknown; clips?: unknown };
  if (spec.version !== 1 || !Array.isArray(spec.clips)) return false;
  return spec.clips.every(
    (clip) =>
      Boolean(clip) &&
      typeof (clip as Clip).id === 'string' &&
      typeof (clip as Clip).assetId === 'string' &&
      Number.isFinite((clip as Clip).inSec) &&
      Number.isFinite((clip as Clip).outSec),
  );
}
