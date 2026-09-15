import type { Clip, TimelineSpec } from '@/lib/timeline/spec';
import { clipDuration, totalDuration } from '@/lib/timeline/spec';

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

export type RenderPlan = {
  inputs: RenderSource[];
  clips: PlannedClip[];
  width: number;
  height: number;
  fps: number;
  outputDurationSec: number;
  /** Clip count whose source has no audio track and needs generated silence. */
  silentClips: number;
};

export const DEFAULT_FPS = 30;

/** Sum of clip durations, computed the way the renderer will. */
export function planDuration(plan: RenderPlan): number {
  return plan.clips.reduce((sum, planned) => sum + planned.durationSec, 0);
}

export class RenderPlanError extends Error {}

export function planRender(spec: TimelineSpec, sources: RenderSource[]): RenderPlan {
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

  return {
    inputs,
    clips,
    width,
    height,
    fps,
    outputDurationSec: totalDuration(spec.clips),
    silentClips: clips.filter((planned) => !planned.source.hasAudio).length,
  };
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
