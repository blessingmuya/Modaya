/**
 * The measured layer.
 *
 * Pure math over sampled frames and decoded audio. No model, no network, no
 * randomness: the same media produces the same numbers every time. Everything
 * here is a *measurement*, and the UI is only allowed to present it as such.
 */

export type Range = { startSec: number; endSec: number };

export type ShotStats = {
  count: number;
  meanSec: number;
  medianSec: number;
  minSec: number;
  maxSec: number;
  stdevSec: number;
};

export type CutDetection = {
  cutTimesSec: number[];
  /** Resolution of the detection: cuts cannot be placed more precisely than this. */
  resolutionSec: number;
  threshold: number;
  /** Median absolute frame-to-frame difference: the "motion floor" of the clip. */
  medianFrameDiff: number;
  meanFrameDiff: number;
  p95FrameDiff: number;
  /** Robust spread (median absolute deviation, scaled) used for the threshold. */
  robustSigma: number;
};

export type AudioStats = {
  /**
   * Mean of every window, silence included. Loudness in dB is logarithmic, so
   * this number is dragged down by digital silence and flatters nothing — read
   * it together with activeMeanRmsDb and silenceRatio.
   */
  meanRmsDb: number;
  /** Mean over windows that are above the silence threshold: the "how loud is it when it is loud" number. */
  activeMeanRmsDb: number;
  /** Share of windows above the silence threshold. */
  activeRatio: number;
  peakRmsDb: number;
  /** Windows quieter than the silence threshold, merged. */
  silenceRanges: Range[];
  silenceRatio: number;
  onsetsSec: number[];
  onsetsPerMinute: number;
  windowSec: number;
  hopSec: number;
  silenceThresholdDb: number;
};

export type GradeStats = {
  meanR: number;
  meanG: number;
  meanB: number;
  meanLuma: number;
  /** Standard deviation of luma — the honest definition of "contrast" here. */
  contrast: number;
  /** Mean HSV saturation, 0-1. */
  saturation: number;
  /** Mean red minus mean blue: a crude warm/cool indicator, not a white balance. */
  warmth: number;
};

export const FRAME_WIDTH = 64;
export const FRAME_HEIGHT = 36;
export const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 3;
export const SAMPLE_FPS = 8;
export const AUDIO_SAMPLE_RATE = 16_000;

export function frameCountFor(durationSec: number, fps = SAMPLE_FPS): number {
  return Math.max(0, Math.floor(durationSec * fps));
}

export function timeForFrame(index: number, fps = SAMPLE_FPS): number {
  return index / fps;
}

/**
 * Mean absolute difference between two RGB frames, normalised to 0-255.
 * A hard cut produces a large value; camera motion produces small ones.
 */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let total = 0;
  for (let i = 0; i < length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / length;
}

export function frameDifferences(frames: Uint8Array[]): number[] {
  const diffs: number[] = [];
  for (let i = 1; i < frames.length; i += 1) diffs.push(frameDifference(frames[i - 1], frames[i]));
  return diffs;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((p / 100) * (sortedValues.length - 1))));
  return sortedValues[index];
}

/**
 * Cut detection.
 *
 * A cut is a frame pair whose difference clears an adaptive threshold and is a
 * local maximum inside a small window, with a refractory period so one
 * transition cannot register twice.
 *
 * The threshold uses the median and the median absolute deviation rather than
 * the mean and standard deviation. With a mean/stdev threshold the handful of
 * real cuts inflate the spread so much that they push the threshold above
 * themselves — a clip with two hard cuts and nothing else would report zero
 * cuts. Median/MAD is immune to that, because a few outliers barely move it.
 */
export function detectCuts(
  diffs: number[],
  opts: {
    fps?: number;
    k?: number;
    absoluteFloor?: number;
    minGapSec?: number;
    windowRadius?: number;
  } = {},
): CutDetection {
  const fps = opts.fps ?? SAMPLE_FPS;
  const k = opts.k ?? 4;
  const absoluteFloor = opts.absoluteFloor ?? 6;
  const minGapSec = opts.minGapSec ?? 0.25;
  const windowRadius = opts.windowRadius ?? 2;

  if (diffs.length === 0) {
    return {
      cutTimesSec: [],
      resolutionSec: 1 / fps,
      threshold: absoluteFloor,
      medianFrameDiff: 0,
      meanFrameDiff: 0,
      p95FrameDiff: 0,
      robustSigma: 0,
    };
  }

  const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const deviations = diffs.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = percentile(deviations, 50);
  const robustSigma = mad * 1.4826; // scaled MAD ≈ standard deviation for normal noise
  const threshold = Math.max(absoluteFloor, median + k * robustSigma);
  const cutFrames: number[] = [];
  const minGapFrames = Math.max(1, Math.round(minGapSec * fps));

  for (let i = 0; i < diffs.length; i += 1) {
    if (diffs[i] < threshold) continue;

    let isLocalMax = true;
    for (let j = Math.max(0, i - windowRadius); j <= Math.min(diffs.length - 1, i + windowRadius); j += 1) {
      if (j !== i && diffs[j] > diffs[i]) {
        isLocalMax = false;
        break;
      }
    }
    if (!isLocalMax) continue;

    const last = cutFrames[cutFrames.length - 1];
    if (last !== undefined && i - last < minGapFrames) {
      // Keep the stronger of the two rather than registering both.
      if (diffs[i] > diffs[last]) cutFrames[cutFrames.length - 1] = i;
      continue;
    }
    cutFrames.push(i);
  }

  return {
    // diff[i] compares frame i and i+1, so the transition lands between them.
    cutTimesSec: cutFrames.map((index) => Number(((index + 1) / fps).toFixed(3))),
    resolutionSec: 1 / fps,
    threshold: Number(threshold.toFixed(3)),
    medianFrameDiff: Number(median.toFixed(3)),
    meanFrameDiff: Number(mean.toFixed(3)),
    p95FrameDiff: Number(percentile(sorted, 95).toFixed(3)),
    robustSigma: Number(robustSigma.toFixed(3)),
  };
}

export function shotStats(cutTimesSec: number[], durationSec: number): ShotStats {
  const boundaries = [0, ...cutTimesSec.filter((t) => t > 0 && t < durationSec), durationSec];
  const lengths: number[] = [];
  for (let i = 1; i < boundaries.length; i += 1) {
    const length = boundaries[i] - boundaries[i - 1];
    if (length > 0.01) lengths.push(length);
  }
  if (lengths.length === 0) {
    return { count: 0, meanSec: 0, medianSec: 0, minSec: 0, maxSec: 0, stdevSec: 0 };
  }
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  const sorted = [...lengths].sort((a, b) => a - b);
  return {
    count: lengths.length,
    meanSec: Number(mean.toFixed(3)),
    medianSec: Number(percentile(sorted, 50).toFixed(3)),
    minSec: Number(sorted[0].toFixed(3)),
    maxSec: Number(sorted[sorted.length - 1].toFixed(3)),
    stdevSec: Number(Math.sqrt(variance).toFixed(3)),
  };
}

export function rmsWindows(samples: Float32Array, sampleRate: number, windowSec = 0.025, hopSec = 0.01) {
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  const hopSize = Math.max(1, Math.round(hopSec * sampleRate));
  const windows: { startSec: number; rms: number }[] = [];

  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    let sum = 0;
    for (let i = start; i < start + windowSize; i += 1) sum += samples[i] * samples[i];
    windows.push({ startSec: start / sampleRate, rms: Math.sqrt(sum / windowSize) });
  }
  return windows;
}

export function toDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-8));
}

/**
 * Onsets, silences and loudness from the RMS envelope.
 *
 * "Silence" is defined explicitly as windows more than `dropDb` below the peak,
 * below an absolute floor — a threshold you can read, not a vibe.
 */
export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
  opts: {
    windowSec?: number;
    hopSec?: number;
    dropDb?: number;
    absoluteFloorDb?: number;
    minSilenceSec?: number;
    onsetDeltaDb?: number;
  } = {},
): AudioStats {
  const windowSec = opts.windowSec ?? 0.025;
  const hopSec = opts.hopSec ?? 0.01;
  const dropDb = opts.dropDb ?? 32;
  const absoluteFloorDb = opts.absoluteFloorDb ?? -45;
  const minSilenceSec = opts.minSilenceSec ?? 0.35;
  const onsetDeltaDb = opts.onsetDeltaDb ?? 9;

  const windows = rmsWindows(samples, sampleRate, windowSec, hopSec);
  if (windows.length === 0) {
    return {
      meanRmsDb: -100,
      activeMeanRmsDb: -100,
      activeRatio: 0,
      peakRmsDb: -100,
      silenceRanges: [],
      silenceRatio: 0,
      onsetsSec: [],
      onsetsPerMinute: 0,
      windowSec,
      hopSec,
      silenceThresholdDb: absoluteFloorDb,
    };
  }

  const db = windows.map((w) => toDb(w.rms));
  const peak = Math.max(...db);
  const mean = db.reduce((sum, value) => sum + value, 0) / db.length;
  const threshold = Math.max(absoluteFloorDb, peak - dropDb);

  // Silence runs.
  const ranges: Range[] = [];
  let silenceStart: number | null = null;
  windows.forEach((window, index) => {
    const quiet = db[index] < threshold;
    if (quiet && silenceStart === null) silenceStart = window.startSec;
    if (!quiet && silenceStart !== null) {
      const end = window.startSec;
      if (end - silenceStart >= minSilenceSec) ranges.push({ startSec: round3(silenceStart), endSec: round3(end) });
      silenceStart = null;
    }
  });
  if (silenceStart !== null) {
    const end = windows[windows.length - 1].startSec + windowSec;
    if (end - silenceStart >= minSilenceSec) ranges.push({ startSec: round3(silenceStart), endSec: round3(end) });
  }

  // Onsets: a jump of at least onsetDeltaDb above the local preceding level.
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let i = 2; i < db.length; i += 1) {
    const rising = db[i] - db[i - 1] >= onsetDeltaDb;
    const aboveFloor = db[i] > threshold + 6;
    if (!rising || !aboveFloor) continue;
    if (windows[i].startSec - lastOnset < 0.15) continue;
    onsets.push(round3(windows[i].startSec));
    lastOnset = windows[i].startSec;
  }

  const active = db.filter((value) => value >= threshold);
  const activeMean = active.length > 0 ? active.reduce((sum, value) => sum + value, 0) / active.length : -100;

  const durationSec = windows[windows.length - 1].startSec + windowSec;
  const silenceSec = ranges.reduce((sum, range) => sum + (range.endSec - range.startSec), 0);

  return {
    meanRmsDb: Number(mean.toFixed(2)),
    activeMeanRmsDb: Number(activeMean.toFixed(2)),
    activeRatio: Number((active.length / db.length).toFixed(4)),
    peakRmsDb: Number(peak.toFixed(2)),
    silenceRanges: ranges,
    silenceRatio: Number((silenceSec / durationSec).toFixed(4)),
    onsetsSec: onsets,
    onsetsPerMinute: durationSec > 0 ? Number(((onsets.length / durationSec) * 60).toFixed(2)) : 0,
    windowSec,
    hopSec,
    silenceThresholdDb: Number(threshold.toFixed(2)),
  };
}

/** Colour statistics from sampled frames. */
export function gradeStats(frames: Uint8Array[]): GradeStats {
  if (frames.length === 0) {
    return { meanR: 0, meanG: 0, meanB: 0, meanLuma: 0, contrast: 0, saturation: 0, warmth: 0 };
  }

  const pixels = FRAME_WIDTH * FRAME_HEIGHT;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let sumSaturation = 0;

  for (const frame of frames) {
    for (let i = 0; i + 2 < frame.length; i += 3) {
      const r = frame[i];
      const g = frame[i + 1];
      const b = frame[i + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumLuma += luma;
      sumLumaSq += luma * luma;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      sumSaturation += max === 0 ? 0 : (max - min) / max;
    }
  }

  const count = frames.length * pixels;
  const meanLuma = sumLuma / count;
  const variance = Math.max(0, sumLumaSq / count - meanLuma * meanLuma);

  return {
    meanR: Number((sumR / count).toFixed(2)),
    meanG: Number((sumG / count).toFixed(2)),
    meanB: Number((sumB / count).toFixed(2)),
    meanLuma: Number(meanLuma.toFixed(2)),
    contrast: Number(Math.sqrt(variance).toFixed(2)),
    saturation: Number((sumSaturation / count).toFixed(4)),
    warmth: Number(((sumR - sumB) / count).toFixed(2)),
  };
}

/**
 * Representative frames for the optional vision layer: the midpoint of the
 * longest shots. Measurement drives the model's input, not the other way round.
 */
export function representativeTimes(
  cutTimesSec: number[],
  durationSec: number,
  limit = 8,
): number[] {
  const boundaries = [0, ...cutTimesSec.filter((t) => t > 0 && t < durationSec), durationSec];
  const shots: { start: number; end: number; length: number }[] = [];
  for (let i = 1; i < boundaries.length; i += 1) {
    const start = boundaries[i - 1];
    const end = boundaries[i];
    if (end - start > 0.01) shots.push({ start, end, length: end - start });
  }
  shots.sort((a, b) => b.length - a.length);
  const chosen = shots
    .slice(0, limit)
    .map((shot) => Number(((shot.start + shot.end) / 2).toFixed(3)))
    .sort((a, b) => a - b);
  return chosen.length > 0 ? chosen : [Number((durationSec / 2).toFixed(3))];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function mergeRanges(ranges: Range[], gapSec = 0.05): Range[] {
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.startSec - last.endSec <= gapSec) {
      last.endSec = Math.max(last.endSec, range.endSec);
    } else {
      out.push({ ...range });
    }
  }
  return out;
}
