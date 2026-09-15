import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectAccess, getTimeline, saveTimeline } from "@/lib/project";
import { getFootageMeasured, getReferenceProfile } from "@/lib/footage";
import { planFromStyleProfile } from "@/lib/planner";
import { applyOps, parseOps } from "@/lib/ops";
import { timelineDuration } from "@/lib/timeline";

export const runtime = "nodejs";
export const maxDuration = 600;

const body = z
  .object({ apply: z.boolean().default(true), ops: z.unknown().optional() })
  .default({ apply: true });

/**
 * Build (and optionally apply) the reference-matched edit plan.
 * Cut placement and grading come only from the MEASURED layer; every op
 * reports the StyleProfile field it was grounded in.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const input = body.parse(await req.json().catch(() => ({})));
  const timeline = await getTimeline(id);
  if (timelineDuration(timeline) < 0.05)
    return NextResponse.json({ error: "empty_timeline" }, { status: 400 });

  // Externally supplied ops (e.g. replaying a plan) still go through validation.
  if (input.ops !== undefined) {
    const { ops, dropped } = parseOps(input.ops);
    const { timeline: next, results } = applyOps(timeline, ops);
    if (input.apply) await saveTimeline(id, next);
    return NextResponse.json({ results, dropped, timeline: next, duration: timelineDuration(next) });
  }

  const profile = await getReferenceProfile(id);
  if (!profile)
    return NextResponse.json({ error: "no_reference" }, { status: 400 });

  const footage = await getFootageMeasured(id);
  if (!footage) return NextResponse.json({ error: "no_footage" }, { status: 400 });

  const planned = planFromStyleProfile(timeline, footage.measured, profile);
  const { ops, dropped } = parseOps(planned);
  const { timeline: next, results } = applyOps(timeline, ops);

  // Re-attach grounding (parseOps strips unknown keys by design).
  const grounded = results.map((r, i) => ({ ...r, groundedIn: planned[i]?.groundedIn }));

  if (input.apply) await saveTimeline(id, next);

  return NextResponse.json({
    results: grounded,
    dropped,
    timeline: next,
    duration: timelineDuration(next),
    reference: {
      cutsPerMinute: profile.measured.cutsPerMinute,
      shotLengthMedian: profile.measured.shotLengthMedian,
      grade: profile.measured.grade,
    },
  });
}
