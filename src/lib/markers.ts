import type { AppliedOp } from "./ops";
import type { Timeline } from "./timeline";
import { timelineDuration } from "./timeline";

export type Marker = {
  kind: "Hook" | "Cut" | "Zoom" | "Caption" | "Grade";
  /** Position in the FINAL timeline, seconds. Null for whole-timeline ops like grade. */
  atSec: number | null;
  endSec: number | null;
  label: string;
  /** The grounded reason, straight from the StyleProfile field that caused it. */
  reason: string;
  groundedIn: string | null;
};

/**
 * Turn applied operations into Edit Map markers positioned on the final timeline.
 * Nothing here is invented — each marker mirrors one applied op.
 */
export function buildMarkers(finalTimeline: Timeline, results: AppliedOp[]): Marker[] {
  const total = timelineDuration(finalTimeline);
  const markers: Marker[] = [];

  // Clip boundaries in the final timeline are the cuts the viewer will actually see.
  let cursor = 0;
  const boundaries: number[] = [];
  for (const c of finalTimeline.clips) {
    cursor += Math.max(0, c.end - c.start);
    if (cursor < total - 0.05) boundaries.push(Number(cursor.toFixed(3)));
  }

  for (const r of results) {
    if (!r.applied) continue;
    const reason = (r.op as { reason?: string }).reason ?? r.note;
    const groundedIn = r.groundedIn ?? null;

    if (r.op.op === "remove_ranges" || r.op.op === "keep_ranges" || r.op.op === "trim_to") {
      const isHook =
        (r.op.op === "remove_ranges" && r.op.ranges.some((x) => x.start < 0.3)) ||
        (r.op.op === "trim_to" && r.op.start < 0.3);
      if (isHook) {
        markers.push({ kind: "Hook", atSec: 0, endSec: null, label: "Hard open", reason, groundedIn });
      }
      for (const b of boundaries) {
        markers.push({ kind: "Cut", atSec: b, endSec: null, label: "Cut", reason, groundedIn });
      }
    } else if (r.op.op === "punch_in") {
      markers.push({
        kind: "Zoom",
        atSec: Math.min(r.op.at, total),
        endSec: Math.min(r.op.at + r.op.durationSec, total),
        label: `Punch-in ${r.op.zoom.toFixed(2)}×`,
        reason,
        groundedIn,
      });
    } else if (r.op.op === "add_captions") {
      for (const c of r.op.captions) {
        markers.push({
          kind: "Caption",
          atSec: Math.min(c.start, total),
          endSec: Math.min(c.end, total),
          label: c.text.slice(0, 40),
          reason,
          groundedIn,
        });
      }
    } else if (r.op.op === "grade") {
      markers.push({ kind: "Grade", atSec: null, endSec: null, label: r.note, reason, groundedIn });
    }
  }

  // Deduplicate identical cut markers (several ops can produce the same boundary).
  const seen = new Set<string>();
  return markers.filter((m) => {
    const k = `${m.kind}:${m.atSec}:${m.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
