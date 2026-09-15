import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { renderJobs } from "@/db/schema";
import { assertProjectAccess } from "@/lib/project";
import { signedDownload } from "@/lib/storage";
import { tick } from "@/lib/queue";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [job] = await db.select().from(renderJobs).where(eq(renderJobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await assertProjectAccess(job.projectId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Nudge the worker in case the process restarted with jobs still queued.
  if (job.status === "queued") void tick();

  const downloadUrl =
    job.status === "done" && job.outputKey
      ? await signedDownload(job.outputKey, 3600, `modaya-${job.id.slice(0, 8)}.mp4`)
      : null;

  return NextResponse.json({ job, downloadUrl });
}
