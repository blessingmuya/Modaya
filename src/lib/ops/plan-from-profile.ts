import type { MeasuredLayer, ModelDescribedLayer } from '@/lib/style/types';
import { clipDuration, placeClips, round3, type Clip, type Grade } from '@/lib/timeline/spec';
import type { ProposedOperation } from './operations';

export type ProfileRef = {
  assetId: string;
  measured: MeasuredLayer;
  model: ModelDescribedLayer | null;
};

export type SourceGrade = {
  meanLuma: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

export type ReferencePlan = {
  operations: ProposedOperation[];
  /** Plain-English explanation, one line per operation, shown in the UI. */
  summary: string[];
  /** StyleProfile fields the plan actually used. */
  usedFields: string[];
};

/**
 * Build an edit plan from a measured style profile.
 *
 * This is the deterministic half of "edit my footage like this reference" and it
 * needs no model at all: cut placement comes from the reference's measured
 * rhythm, framing from its measured shot-length spread, and colour from
 * arithmetic on its measured colour statistics. Every operation carries the
 * profile field it came from, so each edit can be pointed at.
 */
export function planFromProfile(options: {
  reference: ProfileRef;
  clips: Clip[];
  source: { assetId: string; durationSec: number; grade: SourceGrade | null };
  /** 0 disables punch-ins; 1 is the default intensity. */
  punchInStrength?: number;
}): ReferencePlan {
  const { reference, clips } = options;
  const measured = reference.measured;
  const operations: ProposedOperation[] = [];
  const summary: string[] = [];
  const usedFields = new Set<string>();

  // ------------------------------------------------------------------ pacing
  const targetShotSec = pickTargetShot(measured);
  if (targetShotSec !== null) {
    const ranges = buildCutRanges(clips, targetShotSec);
    if (ranges.length > 0) {
      operations.push({
        operation: { op: 'remove_ranges', ranges, timebase: 'output' },
        grounding: {
          source: 'style_profile',
          field: 'measured.shots.medianSec',
          value: `${measured.shots.medianSec.toFixed(2)}s median shot (σ ${measured.shots.stdevSec.toFixed(2)}s)`,
          reason:
            'Cut points are placed one measured-median-shot apart, so the edit plays at the reference’s measured rhythm.',
        },
      });
      usedFields.add('measured.shots.medianSec');
      usedFields.add('measured.shots.stdevSec');
      summary.push(
        `Beat the edit at ~${targetShotSec.toFixed(2)}s (reference median shot ${measured.shots.medianSec.toFixed(2)}s, σ ${measured.shots.stdevSec.toFixed(2)}s) — ${ranges.length} cut(s).`,
      );
    }
  }

  // ----------------------------------------------------------------- framing
  const strength = options.punchInStrength ?? 1;
  if (strength > 0 && measured.shots.stdevSec > 0.35) {
    const punchIns = buildPunchIns(clips, measured, strength);
    if (punchIns.length > 0) {
      operations.push({
        operation: { op: 'punch_in', punchIns },
        grounding: {
          source: 'style_profile',
          field: 'measured.shots.stdevSec',
          value: `σ ${measured.shots.stdevSec.toFixed(2)}s`,
          reason:
            'The reference swings between short and long shots, so the short beats get tighter framing rather than only harder cuts.',
        },
      });
      usedFields.add('measured.shots.stdevSec');
      summary.push(
        `Tighten framing on ${punchIns.length} short beat(s) (reference shot-length spread σ ${measured.shots.stdevSec.toFixed(2)}s).`,
      );
    }
  }

  // ------------------------------------------------------------------ colour
  const grade = gradeFromMeasured(measured, options.source.grade);
  if (grade) {
    operations.push({
      operation: { op: 'grade', ...grade.values },
      grounding: {
        source: 'style_profile',
        field: grade.field,
        value: grade.valueLabel,
        reason: grade.reason,
      },
    });
    usedFields.add(grade.field);
    summary.push(grade.summary);
  }

  // ---------------------------------------------------------------- captions
  // The described layer can say where captions sit; it cannot invent their text.
  if (
    reference.model &&
    reference.model.captionPosition !== 'none' &&
    reference.model.captionPosition !== 'unknown'
  ) {
    usedFields.add('model.captionPosition');
    summary.push(
      `Reference places captions at the ${reference.model.captionPosition} (model-described). No caption text source is configured, so none were added.`,
    );
  }

  return { operations, summary, usedFields: [...usedFields] };
}

/** Median shot length, bounded so a pathological reference cannot shred footage. */
export function pickTargetShot(measured: MeasuredLayer): number | null {
  const median = measured.shots?.medianSec;
  if (!Number.isFinite(median) || median <= 0) return null;
  return round3(Math.min(12, Math.max(0.4, median)));
}

/**
 * Ranges to remove so the footage plays in ~targetShotSec beats.
 *
 * Each period removes a short chunk, producing a jump cut: the remaining
 * footage advances in beats the length of the reference's median shot. Pure and
 * stable — the same clips and profile always produce the same ranges.
 */
export function buildCutRanges(
  clips: Clip[],
  targetShotSec: number,
): { startSec: number; endSec: number }[] {
  const total = totalSec(clips);
  if (total <= 0) return [];

  const cutLength = round3(Math.max(0.1, targetShotSec * 0.18));
  const period = round3(targetShotSec + cutLength);
  const ranges: { startSec: number; endSec: number }[] = [];

  let at = period;
  for (let guard = 0; guard < 500 && at + cutLength < total - 0.05; guard += 1) {
    ranges.push({ startSec: round3(at), endSec: round3(at + cutLength) });
    at = round3(at + period);
  }

  return ranges.filter((range) => range.endSec - range.startSec >= 0.05);
}

/** Punch in on beats shorter than the reference's typical shot. */
export function buildPunchIns(
  clips: Clip[],
  measured: MeasuredLayer,
  strength: number,
): { startSec: number; endSec: number; scale: number }[] {
  const target = pickTargetShot(measured) ?? 2;
  const punchIns: { startSec: number; endSec: number; scale: number }[] = [];

  for (const placed of placeClips(clips)) {
    const length = placed.outEnd - placed.outStart;
    if (length > target * 1.5) continue;
    punchIns.push({
      startSec: round3(placed.outStart),
      endSec: round3(placed.outEnd),
      scale: round3(1 + Math.min(0.45, strength * 0.3)),
    });
  }
  return punchIns;
}

/**
 * Colour: express the reference's measured statistics as an ffmpeg `eq` grade
 * relative to the source's own measured statistics. Arithmetic on two
 * measurements, not a guess.
 */
export function gradeFromMeasured(
  reference: MeasuredLayer,
  sourceGrade: SourceGrade | null,
): {
  values: Grade;
  field: string;
  valueLabel: string;
  reason: string;
  summary: string;
} | null {
  if (!sourceGrade || !reference.grade) return null;

  const contrastDelta = reference.grade.contrast - sourceGrade.contrast;
  const saturationTarget = clamp(reference.grade.saturation, 0.05, 1);
  const saturationCurrent = clamp(sourceGrade.saturation, 0.05, 1);
  const lumaDelta = reference.grade.meanLuma - sourceGrade.meanLuma;

  const contrast = round3(
    clamp(1 + contrastDelta / Math.max(40, sourceGrade.contrast * 2 + 20), 0.5, 2),
  );
  const saturation = round3(clamp(saturationTarget / saturationCurrent, 0.4, 2.2));
  const brightness = round3(clamp(lumaDelta / 255, -0.3, 0.3));

  const values: Grade = {};
  if (Math.abs(contrast - 1) >= 0.02) values.contrast = contrast;
  if (Math.abs(saturation - 1) >= 0.02) values.saturation = saturation;
  if (Math.abs(brightness) >= 0.01) values.brightness = brightness;
  if (Object.keys(values).length === 0) return null;

  return {
    values,
    field: 'measured.grade',
    valueLabel: `contrast σ ${reference.grade.contrast} vs source σ ${sourceGrade.contrast}; saturation ${reference.grade.saturation} vs ${sourceGrade.saturation}`,
    reason:
      'Contrast, saturation and brightness are ratios of the reference’s measured colour statistics to the source’s own measured statistics.',
    summary: `Match the reference grade: ${Object.entries(values)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ')} (from measured colour statistics).`,
  };
}

export function totalSec(clips: Clip[]): number {
  return round3(clips.reduce((sum, clip) => sum + clipDuration(clip), 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
