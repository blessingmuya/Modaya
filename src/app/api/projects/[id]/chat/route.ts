import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectAccess, getTimeline, saveTimeline } from "@/lib/project";
import { getFootageMeasured, getReferenceProfile } from "@/lib/footage";
import { planFromChat } from "@/lib/planner";
import { applyOps, parseOps } from "@/lib/ops";
import { timelineDuration } from "@/lib/timeline";

export const runtime = "nodejs";
export const maxDuration = 600;

const body = z.object({ message: z.string().min(1).max(2000), apply: z.boolean().default(true) });

/**
 * Chat-driven editing. The model returns ONLY an op list; every op is parsed,
 * unknown types dropped, and all timestamps clamped to the real timeline before
 * anything can reach the ffmpeg queue.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const timeline = await getTimeline(id);
  const footage = await getFootageMeasured(id);
  const profile = await getReferenceProfile(id);

  const plan = await planFromChat(parsed.data.message, timeline, footage?.measured ?? null, profile);
  const { ops, dropped } = parseOps(plan.ops);
  const { timeline: next, results } = applyOps(timeline, ops);

  const changed = timelineDuration(next) !== timelineDuration(timeline) || next.clips.length !== timeline.clips.length;
  if (parsed.data.apply && (changed || results.some((r) => r.applied))) await saveTimeline(id, next);

  return NextResponse.json({
    reply: plan.reply,
    planSource: plan.source,
    results,
    dropped: [...dropped, ...plan.dropped],
    timeline: next,
    duration: timelineDuration(next),
  });
}
