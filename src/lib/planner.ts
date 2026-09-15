import "server-only";
import type { StyleProfile } from "./styleProfile";
import type { Measured } from "./styleProfile";
import type { Op } from "./ops";
import { parseOps } from "./ops";
import type { Timeline } from "./timeline";
import { timelineDuration } from "./timeline";

export type GroundedOp = Op & { groundedIn?: string };

/**
 * Deterministic reference-matching planner.
 *
 * Only the MEASURED layer of the StyleProfile drives cut placement and grading —
 * the model-described layer can influence caption style, never timing. Every op
 * carries `groundedIn`: the exact StyleProfile field it came from.
 */
export function planFromStyleProfile(
  timeline: Timeline,
  footage: Measured,
  profile: StyleProfile,
): GroundedOp[] {
  const ops: GroundedOp[] = [];
  const ref = profile.measured;
  const total = timelineDuration(timeline);
  if (total < 0.2) return ops;

  // 1) Pacing: cut the footage into shots matching the reference's median shot length.
  // Prefer the footage's own measured cut/onset points; fall back to a regular grid.
  const targetShot = Math.max(0.4, ref.shotLengthMedian || ref.durationSec / Math.max(1, ref.cutCount + 1));
  const candidates = [
    ...footage.cutTimes,
    ...footage.audio.onsetTimes,
  ]
    .filter((t) => t > 0.2 && t < total - 0.2)
    .sort((a, b) => a - b);

  const keep: { start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < total - 0.2) {
    const idealEnd = cursor + targetShot;
    // Snap to the nearest real measured event within ±40% of the target shot length.
    const window = targetShot * 0.4;
    const snap = candidates
      .filter((t) => t > cursor + 0.2 && Math.abs(t - idealEnd) <= window)
      .sort((a, b) => Math.abs(a - idealEnd) - Math.abs(b - idealEnd))[0];
    const end = Math.min(total, snap ?? idealEnd);
    if (end - cursor > 0.2) keep.push({ start: cursor, end });
    cursor = end;
  }

  // 2) Tighten: drop the measured silent stretches in the footage — this is what
  // actually makes the pacing read as fast, and it's pure measurement.
  const silences = footage.audio.silentRanges.filter((r) => r.end - r.start > 0.4);
  if (silences.length && ref.cutsPerMinute > (footage.cutTimes.length / Math.max(footage.durationSec, 1)) * 60) {
    ops.push({
      op: "remove_ranges",
      ranges: silences,
      reason: `Reference cuts ${ref.cutsPerMinute.toFixed(1)}×/min; removing ${silences.length} measured silent stretch(es) to raise your footage's cut rate to match.`,
      groundedIn: "measured.cutsPerMinute + footage measured.audio.silentRanges",
    } as GroundedOp);
  }

  // 3) Hook: if the reference opens with shots shorter than its own median,
  //    trim dead air off the very front of the footage.
  const firstShot = ref.shotLengths[0];
  if (firstShot && firstShot < ref.shotLengthMedian * 0.8) {
    const lead = footage.audio.silentRanges.find((r) => r.start < 0.3);
    if (lead && lead.end > 0.3) {
      ops.push({
        op: "remove_ranges",
        ranges: [{ start: 0, end: Math.min(lead.end, total * 0.25) }],
        reason: `Reference's opening shot is ${firstShot.toFixed(2)}s vs its ${ref.shotLengthMedian.toFixed(2)}s median — cutting your ${lead.end.toFixed(2)}s of measured lead-in silence to open as abruptly.`,
        groundedIn: "measured.shotLengths[0] vs measured.shotLengthMedian",
      } as GroundedOp);
    }
  }

  // 4) Grade: shift the footage toward the reference's measured colour statistics.
  const dBright = ref.grade.brightness - footage.grade.brightness;
  const dContrast =
    footage.grade.contrast > 0.01 ? ref.grade.contrast / footage.grade.contrast : 1;
  const dSat = footage.grade.saturation > 0.01 ? ref.grade.saturation / footage.grade.saturation : 1;
  const dTemp = ref.grade.temperature - footage.grade.temperature;

  const grade: GroundedOp = {
    op: "grade",
    exposure: Number(dBright.toFixed(4)),
    contrast: Number(Math.max(0.5, Math.min(2, dContrast)).toFixed(4)),
    saturation: Number(Math.max(0, Math.min(3, dSat)).toFixed(4)),
    temperature: Number(Math.max(-1, Math.min(1, dTemp * 2)).toFixed(4)),
    reason: `Matching the reference's measured grade (brightness ${ref.grade.brightness.toFixed(3)}, contrast ${ref.grade.contrast.toFixed(3)}, saturation ${ref.grade.saturation.toFixed(3)}, temperature ${ref.grade.temperature.toFixed(3)}) from your footage's (${footage.grade.brightness.toFixed(3)}, ${footage.grade.contrast.toFixed(3)}, ${footage.grade.saturation.toFixed(3)}, ${footage.grade.temperature.toFixed(3)}).`,
    groundedIn: "measured.grade.{brightness,contrast,saturation,temperature}",
  };
  if (
    Math.abs(dBright) > 0.02 ||
    Math.abs(dContrast - 1) > 0.05 ||
    Math.abs(dSat - 1) > 0.05 ||
    Math.abs(dTemp) > 0.01
  ) {
    ops.push(grade);
  }

  // 5) Punch-ins on measured audio onsets, at the reference's own onset density.
  const onsetRate = ref.audio.onsetsPerMinute;
  if (onsetRate > 6 && footage.audio.onsetTimes.length) {
    const wanted = Math.min(3, Math.floor((onsetRate / 60) * total * 0.15));
    const picks = footage.audio.onsetTimes
      .filter((t) => t > 0.5 && t < total - 0.8)
      .slice(0, Math.max(0, wanted));
    for (const at of picks) {
      ops.push({
        op: "punch_in",
        at,
        durationSec: Math.min(targetShot, 1.2),
        zoom: 1.15,
        reason: `Reference emphasises ${onsetRate.toFixed(1)} audio onsets/min; punching in on your measured onset at ${at.toFixed(2)}s.`,
        groundedIn: "measured.audio.onsetsPerMinute + footage measured.audio.onsetTimes",
      } as GroundedOp);
    }
  }

  void keep; // shot-grid retained for future explicit re-cutting; silences+punch-ins drive pacing today
  return ops;
}

/* ------------------------- chat → ops ------------------------- */

const OP_SYSTEM = `You are Modaya's edit planner. You NEVER edit a timeline directly.
You return ONLY JSON: {"ops":[...],"reply":"one short sentence to the user"}.

Allowed ops (anything else is discarded):
- {"op":"remove_ranges","ranges":[{"start":s,"end":s}],"reason":"..."}
- {"op":"keep_ranges","ranges":[{"start":s,"end":s}],"reason":"..."}
- {"op":"trim_to","start":s,"end":s,"reason":"..."}
- {"op":"add_captions","captions":[{"start":s,"end":s,"text":"..."}],"style":{"position":"top|center|bottom","fontSizePct":n,"uppercase":bool},"reason":"..."}
- {"op":"punch_in","at":s,"durationSec":s,"zoom":1.0-2.0,"reason":"..."}
- {"op":"grade","exposure":-1..1,"contrast":0.5..2,"saturation":0..3,"temperature":-1..1,"reason":"..."}

All times are seconds in TIMELINE time and must fall inside the stated timeline duration.
Only use timestamps supplied to you in the measured data — never invent them.
If the request needs data you do not have, return an empty ops list and say so in "reply".`;

export type ChatPlan = { ops: Op[]; reply: string; dropped: { value: unknown; reason: string }[]; source: "llm" | "heuristic" };

/** Deterministic fallback so chat works with no API key for the common requests. */
export function heuristicPlan(message: string, timeline: Timeline, footage: Measured | null): ChatPlan {
  const msg = message.toLowerCase();
  const total = timelineDuration(timeline);
  const ops: GroundedOp[] = [];
  let reply = "";

  if (/silen|dead air|pause|gap|tighten/.test(msg)) {
    const sil = footage?.audio.silentRanges.filter((r) => r.end - r.start > 0.35) ?? [];
    if (sil.length) {
      ops.push({
        op: "remove_ranges",
        ranges: sil,
        reason: `Removing ${sil.length} silent stretch(es) detected by silencedetect at -32dB.`,
        groundedIn: "footage measured.audio.silentRanges",
      } as GroundedOp);
      reply = `Cutting ${sil.length} measured silent stretch(es).`;
    } else {
      reply = "No silences over 0.35s were measured in this footage, so there is nothing to cut.";
    }
  } else if (/first (\d+)|trim to|keep the first/.test(msg)) {
    const n = Number(/(\d+(?:\.\d+)?)\s*(?:s|sec|second)/.exec(msg)?.[1] ?? 0);
    if (n > 0) {
      ops.push({ op: "trim_to", start: 0, end: Math.min(n, total), reason: `Trimming to the first ${n}s.` });
      reply = `Trimmed to the first ${Math.min(n, total).toFixed(2)}s.`;
    } else reply = "Tell me how many seconds to keep.";
  } else if (/brighter|darker|warm|cool|saturat|contrast|grade/.test(msg)) {
    const op: GroundedOp = { op: "grade", reason: "Grade adjustment from your request." };
    if (/brighter/.test(msg)) op.exposure = 0.08;
    if (/darker/.test(msg)) op.exposure = -0.08;
    if (/warm/.test(msg)) op.temperature = 0.3;
    if (/cool/.test(msg)) op.temperature = -0.3;
    if (/more saturat|punchy|vivid/.test(msg)) op.saturation = 1.2;
    if (/desaturat|muted|flat/.test(msg)) op.saturation = 0.8;
    if (/more contrast/.test(msg)) op.contrast = 1.2;
    if (/less contrast/.test(msg)) op.contrast = 0.85;
    ops.push(op);
    reply = "Applied that grade adjustment to every clip.";
  } else {
    reply =
      "Without a vision/LLM key I can only handle measured requests: cutting silences, trimming to a duration, or grade tweaks. Attach a reference to auto-build a full edit plan.";
  }

  return { ops: ops as Op[], reply, dropped: [], source: "heuristic" };
}

export async function planFromChat(
  message: string,
  timeline: Timeline,
  footage: Measured | null,
  profile: StyleProfile | null,
): Promise<ChatPlan> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return heuristicPlan(message, timeline, footage);

  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.MODAYA_CHAT_MODEL || "gpt-4o-mini";
  const total = timelineDuration(timeline);

  const context = {
    timelineDurationSec: Number(total.toFixed(3)),
    clipCount: timeline.clips.length,
    existingCaptions: (timeline.captions ?? []).length,
    footageMeasured: footage
      ? {
          cutTimes: footage.cutTimes.slice(0, 80),
          silentRanges: footage.audio.silentRanges.slice(0, 60),
          onsetTimes: footage.audio.onsetTimes.slice(0, 80),
          grade: footage.grade,
        }
      : null,
    referenceMeasured: profile
      ? {
          cutsPerMinute: profile.measured.cutsPerMinute,
          shotLengthMedian: profile.measured.shotLengthMedian,
          grade: profile.measured.grade,
        }
      : null,
    referenceDescribed: profile?.modelDescribed ?? null,
  };

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OP_SYSTEM },
          { role: "user", content: `Context:\n${JSON.stringify(context)}\n\nRequest: ${message}` },
        ],
      }),
    });
    if (!res.ok) return heuristicPlan(message, timeline, footage);
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    const obj = typeof raw === "string" ? JSON.parse(raw) : null;
    const { ops, dropped } = parseOps(obj?.ops);
    return {
      ops,
      dropped,
      reply: typeof obj?.reply === "string" ? obj.reply.slice(0, 500) : "Done.",
      source: "llm",
    };
  } catch {
    return heuristicPlan(message, timeline, footage);
  }
}
