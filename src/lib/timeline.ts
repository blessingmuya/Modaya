import { z } from "zod";

/**
 * The timeline is an ordered list of clips, each referencing a half-open
 * [start, end) time range of a source asset. This is the ONLY thing the
 * ffmpeg worker consumes, so the same clip list always yields the same file.
 */
export const clipSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  /** Optional per-clip render effects, all deterministic. */
  grade: z
    .object({
      exposure: z.number().min(-1).max(1).optional(),
      contrast: z.number().min(0.5).max(2).optional(),
      saturation: z.number().min(0).max(3).optional(),
      temperature: z.number().min(-1).max(1).optional(),
    })
    .optional(),
  punchIn: z.number().min(1).max(2).optional(),
});
export type Clip = z.infer<typeof clipSchema>;

export const captionSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  text: z.string().min(1).max(200),
});
export type Caption = z.infer<typeof captionSchema>;

export const captionStyleSchema = z.object({
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  fontSizePct: z.number().min(2).max(14).default(6),
  uppercase: z.boolean().default(false),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const timelineSchema = z.object({
  clips: z.array(clipSchema).default([]),
  captions: z.array(captionSchema).default([]),
  captionStyle: captionStyleSchema.optional(),
});
export type Timeline = z.infer<typeof timelineSchema>;

export type Range = { start: number; end: number };

export function clipDuration(c: Clip) {
  return Math.max(0, c.end - c.start);
}
export function timelineDuration(t: Timeline) {
  return t.clips.reduce((s, c) => s + clipDuration(c), 0);
}

export function normalizeRanges(ranges: Range[], duration: number): Range[] {
  const clamped = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, duration)),
      end: Math.max(0, Math.min(r.end, duration)),
    }))
    .filter((r) => r.end - r.start > 0.02)
    .sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  for (const r of clamped) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

export function invertRanges(ranges: Range[], duration: number): Range[] {
  const keep: Range[] = [];
  let cursor = 0;
  for (const r of normalizeRanges(ranges, duration)) {
    if (r.start - cursor > 0.02) keep.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (duration - cursor > 0.02) keep.push({ start: cursor, end: duration });
  return keep;
}

let seq = 0;
export function clipId() {
  seq = (seq + 1) % 1e6;
  return `c${Date.now().toString(36)}${seq.toString(36)}`;
}

/** Remove time ranges expressed in *timeline* time, re-slicing clips accordingly. */
export function removeTimelineRanges(timeline: Timeline, ranges: Range[]): Timeline {
  const total = timelineDuration(timeline);
  const cut = normalizeRanges(ranges, total);
  if (!cut.length) return timeline;

  const out: Clip[] = [];
  let cursor = 0; // position in timeline time
  for (const clip of timeline.clips) {
    const len = clipDuration(clip);
    const clipStartT = cursor;
    const clipEndT = cursor + len;
    // Keep segments of this clip not covered by any cut range.
    const localCuts = cut
      .filter((r) => r.end > clipStartT && r.start < clipEndT)
      .map((r) => ({
        start: Math.max(0, r.start - clipStartT),
        end: Math.min(len, r.end - clipStartT),
      }));
    for (const keep of invertRanges(localCuts, len)) {
      out.push({
        ...clip,
        id: clipId(),
        start: clip.start + keep.start,
        end: clip.start + keep.end,
      });
    }
    cursor = clipEndT;
  }
  return { ...timeline, clips: out };
}

/** Keep only these timeline-time ranges, in the order given. */
export function keepTimelineRanges(timeline: Timeline, ranges: Range[]): Timeline {
  const total = timelineDuration(timeline);
  const keep = normalizeRanges(ranges, total);
  const inverse = invertRanges(keep, total);
  return removeTimelineRanges(timeline, inverse);
}

/** Map a timeline-time instant back to (clipIndex, sourceTime) for UI/debug. */
export function resolveTimelineTime(timeline: Timeline, t: number) {
  let cursor = 0;
  for (let i = 0; i < timeline.clips.length; i++) {
    const len = clipDuration(timeline.clips[i]);
    if (t < cursor + len) {
      return { clipIndex: i, sourceTime: timeline.clips[i].start + (t - cursor) };
    }
    cursor += len;
  }
  return null;
}
