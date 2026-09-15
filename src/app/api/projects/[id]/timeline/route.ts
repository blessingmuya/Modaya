import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectAccess, getAssets, getTimeline, saveTimeline } from "@/lib/project";
import {
  clipId,
  normalizeRanges,
  removeTimelineRanges,
  timelineDuration,
  timelineSchema,
  type Timeline,
} from "@/lib/timeline";

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ action: z.literal("set"), timeline: timelineSchema }),
  z.object({
    action: z.literal("remove_ranges"),
    ranges: z.array(z.object({ start: z.number(), end: z.number() })).min(1),
  }),
  z.object({ action: z.literal("reset") }),
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const timeline = await getTimeline(id);
  return NextResponse.json({ timeline, duration: timelineDuration(timeline) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "bad_request", detail: parsed.error.issues }, { status: 400 });

  const current = await getTimeline(id);
  let next: Timeline;

  if (parsed.data.action === "set") {
    next = parsed.data.timeline;
  } else if (parsed.data.action === "reset") {
    // Rebuild a full-length timeline from the project's source assets.
    const sources = (await getAssets(id, "source")).slice().reverse();
    next = {
      clips: sources
        .filter((a) => (a.durationSec ?? 0) > 0.05)
        .map((a) => ({ id: clipId(), assetId: a.id, start: 0, end: a.durationSec as number })),
      captions: [],
    };
  } else {
    const total = timelineDuration(current);
    const ranges = normalizeRanges(parsed.data.ranges, total);
    if (!ranges.length)
      return NextResponse.json({ error: "no_valid_ranges", duration: total }, { status: 400 });
    next = removeTimelineRanges(current, ranges);
  }

  const saved = await saveTimeline(id, next);
  return NextResponse.json({ timeline: saved, duration: timelineDuration(saved) });
}
