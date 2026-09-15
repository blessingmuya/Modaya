import { z } from 'zod';
import type { AudioStats, CutDetection, GradeStats, Range, ShotStats } from './measure';

/**
 * A StyleProfile has exactly two layers, and every field is labelled with the
 * layer it came from. The UI renders them side by side and never mixes them.
 */

/**
 * Bumped whenever a measured field is added or its definition changes. Stored
 * profiles are read defensively: a field this build expects but the stored blob
 * does not have is reported as missing rather than defaulted to a plausible
 * number, because inventing a measurement is worse than admitting a gap.
 */
export const MEASURED_SCHEMA_VERSION = 2;

export type MeasuredLayer = {
  source: 'measured';
  /** Absent on profiles recorded before versioning; treated as version 1. */
  schemaVersion?: number;
  durationSec: number;
  sampledFps: number;
  /** Cut detection resolution: cuts are only as precise as the sampling rate. */
  cutResolutionSec: number;
  cuts: CutDetection;
  shots: ShotStats;
  audio: AudioStats;
  grade: GradeStats;
  /** Structural facts about the media, also measured. */
  media: {
    width: number | null;
    height: number | null;
    fps: number | null;
    hasAudio: boolean;
    videoCodec: string | null;
    audioCodec: string | null;
  };
};

export const modelLayerSchema = z.object({
  shotTypes: z.array(z.string().min(1).max(80)).max(12).default([]),
  transitionStyle: z.string().max(400).default(''),
  captionPosition: z.enum(['none', 'top', 'center', 'bottom', 'unknown']).default('unknown'),
  captionStyle: z.string().max(400).default(''),
  pacingDescription: z.string().max(600).default(''),
  hookStructure: z.string().max(600).default(''),
  notes: z.array(z.string().max(300)).max(10).default([]),
});

export type ModelLayerOutput = z.infer<typeof modelLayerSchema>;

export type ModelDescribedLayer = ModelLayerOutput & {
  source: 'model_described';
  provider: 'openai' | 'anthropic';
  model: string;
  /** Frames the model actually saw, and when they were taken (from the measured layer). */
  frameTimesSec: number[];
  frameCount: number;
  transcriptProvided: boolean;
  /**
   * Stated limitations, surfaced verbatim in the UI. This layer describes what a
   * model said about still frames; it is not a measurement of the video.
   */
  caveats: string[];
};

export type ModelStatus = 'ok' | 'skipped_no_key' | 'failed';

export type StyleProfile = {
  id: string;
  projectId: string;
  assetId: string;
  measured: MeasuredLayer;
  model: ModelDescribedLayer | null;
  modelStatus: ModelStatus;
  modelError: string | null;
  createdAt: string;
};

export type AnalyzeProgress = {
  stage: 'downloading' | 'sampling' | 'measuring' | 'model' | 'saving';
  detail?: string;
};

/** Ranges suitable for a "cut the silences" operation, in source time. */
export function silenceRanges(profile: MeasuredLayer): Range[] {
  return profile.audio?.silenceRanges ?? [];
}

export type MeasuredReadResult = {
  measured: MeasuredLayer;
  /** True when the stored blob predates the current schema version. */
  stale: boolean;
  /** Field paths this build expects but the stored profile does not contain. */
  missingFields: string[];
};

/**
 * Reads a measured layer out of jsonb, tolerating profiles written by older
 * builds. Never fills a gap with a number: a missing measurement is reported as
 * missing, because inventing one is worse than admitting the hole.
 */
export function readMeasured(value: unknown): MeasuredReadResult {
  const measured = (value ?? {}) as MeasuredLayer;
  const missingFields: string[] = [];
  const require = (path: string, present: unknown) => {
    if (present === undefined || present === null) missingFields.push(path);
  };

  require('durationSec', measured.durationSec);
  require('cuts.cutTimesSec', measured.cuts?.cutTimesSec);
  require('shots.medianSec', measured.shots?.medianSec);
  require('audio.silenceRanges', measured.audio?.silenceRanges);
  require('audio.activeMeanRmsDb', measured.audio?.activeMeanRmsDb);
  require('audio.activeRatio', measured.audio?.activeRatio);
  require('grade.contrast', measured.grade?.contrast);
  require('cuts.medianFrameDiff', measured.cuts?.medianFrameDiff);

  const schemaVersion = measured.schemaVersion ?? 1;
  return {
    measured,
    stale: schemaVersion < MEASURED_SCHEMA_VERSION || missingFields.length > 0,
    missingFields,
  };
}
