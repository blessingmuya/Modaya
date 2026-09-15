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

/**
 * Colour correction, expressed with the parameters ffmpeg's `eq` filter takes,
 * so what the UI shows is what the renderer applies.
 */
export type Grade = {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
};

export type PunchIn = {
  id: string;
  /** Output-time window the zoom applies to. */
  startSec: number;
  endSec: number;
  /** 1 = unchanged, 1.3 = 30% tighter framing. */
  scale: number;
};

export type Caption = {
  id: string;
  /** Output-time window the caption is visible for. */
  startSec: number;
  endSec: number;
  text: string;
  position: 'top' | 'center' | 'bottom';
};

export type TimelineSpec = {
  version: 1;
  clips: Clip[];
  grade?: Grade;
  punchIns?: PunchIn[];
  captions?: Caption[];
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

export function createSpec(clips: Clip[], extra: Partial<TimelineSpec> = {}): TimelineSpec {
  return {
    version: 1,
    clips: normalizeClips(clips),
    ...(extra.grade ? { grade: extra.grade } : {}),
    ...(extra.punchIns?.length ? { punchIns: extra.punchIns } : {}),
    ...(extra.captions?.length ? { captions: extra.captions } : {}),
  };
}

export const DEFAULT_POSITION: Caption['position'] = 'bottom';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
