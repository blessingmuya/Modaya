import { clipDuration, normalizeClips, placeClips, round3, type Clip } from './spec';

export type Range = { startSec: number; endSec: number };

function normalizeRange(range: Range): Range {
  const startSec = Math.min(range.startSec, range.endSec);
  const endSec = Math.max(range.startSec, range.endSec);
  return { startSec, endSec };
}

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .map(normalizeRange)
    .filter((r) => r.endSec - r.startSec > 0.001)
    .sort((a, b) => a.startSec - b.startSec);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, range.endSec);
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

/** Window [start, end] with the given ranges removed. */
function subtractRanges(start: number, end: number, ranges: Range[]): Range[] {
  let windows: Range[] = [{ startSec: start, endSec: end }];
  for (const range of mergeRanges(ranges)) {
    const next: Range[] = [];
    for (const window of windows) {
      if (range.endSec <= window.startSec || range.startSec >= window.endSec) {
        next.push(window);
        continue;
      }
      if (range.startSec > window.startSec) {
        next.push({ startSec: window.startSec, endSec: Math.min(range.startSec, window.endSec) });
      }
      if (range.endSec < window.endSec) {
        next.push({ startSec: Math.max(range.endSec, window.startSec), endSec: window.endSec });
      }
    }
    windows = next;
  }
  return windows;
}

/** Keep only these ranges (the complement of removing them). */
export function keepRanges(ranges: Range[], bounds: Range): Range[] {
  return subtractRanges(bounds.startSec, bounds.endSec, ranges);
}

export function initialTimeline(assetId: string, durationSec: number): Clip[] {
  return [
    {
      id: shortId(),
      assetId,
      inSec: 0,
      outSec: round3(durationSec),
    },
  ];
}

/**
 * Clip ids are local labels. This runs in the browser (ops are applied as the
 * user edits) and on the server, so it uses the standard Web Crypto API that
 * both environments provide rather than node:crypto.
 */
export function shortId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Remove ranges expressed in *output* time (what the user sees on the timeline)
 * from the clip list.
 */
export function removeOutputRanges(clips: Clip[], ranges: Range[]): Clip[] {
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return clips;

  const result: Clip[] = [];
  for (const placed of placeClips(clips)) {
    const { clip } = placed;
    const kept = subtractRanges(placed.outStart, placed.outEnd, merged);
    for (const window of kept) {
      if (window.endSec - window.startSec < 0.02) continue;
      const offsetIn = window.startSec - placed.outStart;
      const offsetOut = window.endSec - placed.outStart;
      result.push({
        id: shortId(),
        assetId: clip.assetId,
        inSec: round3(clip.inSec + offsetIn),
        outSec: round3(clip.inSec + offsetOut),
      });
    }
  }
  return normalizeClips(result);
}

/**
 * Remove ranges expressed in *source* time (used by measured operations such as
 * "cut the silences", where the measurement is over the source file).
 */
export function removeSourceRanges(clips: Clip[], ranges: Range[]): Clip[] {
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return clips;

  const result: Clip[] = [];
  for (const clip of clips) {
    const kept = subtractRanges(clip.inSec, clip.outSec, merged);
    for (const window of kept) {
      if (window.endSec - window.startSec < 0.02) continue;
      result.push({ ...clip, id: shortId(), inSec: round3(window.startSec), outSec: round3(window.endSec) });
    }
  }
  return normalizeClips(result);
}

/** Trim the whole timeline to an output-time window. */
export function trimTo(clips: Clip[], range: Range): Clip[] {
  const { startSec, endSec } = normalizeRange(range);
  const kept: Clip[] = [];
  for (const placed of placeClips(clips)) {
    const from = Math.max(placed.outStart, startSec);
    const to = Math.min(placed.outEnd, endSec);
    if (to - from < 0.02) continue;
    kept.push({
      id: shortId(),
      assetId: placed.clip.assetId,
      inSec: round3(placed.clip.inSec + (from - placed.outStart)),
      outSec: round3(placed.clip.inSec + (to - placed.outStart)),
    });
  }
  return normalizeClips(kept);
}

/** Concatenate: append another clip list, keeping order. */
export function concat(clips: Clip[], other: Clip[]): Clip[] {
  return normalizeClips([...clips, ...other]);
}

export function clipsDuration(clips: Clip[]): number {
  return round3(clips.reduce((sum, clip) => sum + clipDuration(clip), 0));
}
