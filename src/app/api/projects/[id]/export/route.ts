import { NextResponse } from "next/server";
import { assertProjectAccess, getJobs, getTimeline, sourceMap } from "@/lib/project";
import { timelineDuration } from "@/lib/timeline";
import { timelineToSpec } from "@/lib/render";
import { enqueueRender, tick } from "@/lib/queue";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ jobs: await getJobs(id) });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const timeline = await getTimeline(id);
  if (timelineDuration(timeline) < 0.05)
    return NextResponse.json({ error: "empty_timeline" }, { status: 400 });

  // Only include sources the timeline actually references — keeps the hash tight.
  const all = await sourceMap(id);
  const used = new Set(timeline.clips.map((c) => c.assetId));
  const sources = Object.fromEntries(Object.entries(all).filter(([k]) => used.has(k)));
  const missing = [...used].filter((a) => !sources[a]);
  if (missing.length)
    return NextResponse.json({ error: "missing_assets", missing }, { status: 400 });

  const job = await enqueueRender(id, timelineToSpec(timeline, sources));
  void tick();
  return NextResponse.json({ job });
}
