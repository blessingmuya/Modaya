import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, renderJobs } from "@/db/schema";
import { getObjectBuffer, putObject } from "./storage";
import { renderTimeline, specHash, type RenderSpec } from "./render";

/**
 * Job queue backed by the render_jobs table. Claiming uses
 * SELECT ... FOR UPDATE SKIP LOCKED so multiple workers are safe.
 */
export async function enqueueRender(projectId: string, spec: RenderSpec) {
  const hash = specHash(spec);

  // Deterministic pipeline: an identical spec that already rendered is reused.
  const [done] = await db
    .select()
    .from(renderJobs)
    .where(and(eq(renderJobs.projectId, projectId), eq(renderJobs.specHash, hash), eq(renderJobs.status, "done")))
    .limit(1);
  if (done) return done;

  const [job] = await db
    .insert(renderJobs)
    .values({ projectId, spec, specHash: hash, status: "queued" })
    .returning();
  void tick();
  return job;
}

async function claimJob() {
  const { rows } = await db.execute(sql`
    update render_jobs set status='running', started_at=now()
    where id = (
      select id from render_jobs where status='queued'
      order by created_at asc for update skip locked limit 1
    )
    returning id, project_id, spec
  `);
  return (rows?.[0] as { id: string; project_id: string; spec: RenderSpec } | undefined) ?? null;
}

async function processJob(job: { id: string; project_id: string; spec: RenderSpec }) {
  const log: string[] = [];
  const tmpFiles: string[] = [];
  let tmpDir: string | null = null;
  try {
    // Pull every referenced source out of object storage to local scratch.
    const local: Record<string, string> = {};
    for (const [assetId, key] of Object.entries(job.spec.sources ?? {})) {
      const buf = await getObjectBuffer(key);
      const p = path.join("/tmp", `modaya-src-${assetId}-${path.basename(key)}`);
      await fs.writeFile(p, buf);
      tmpFiles.push(p);
      local[assetId] = p;
      log.push(`fetched source ${assetId} (${(buf.length / 1e6).toFixed(1)} MB)`);
    }

    const res = await renderTimeline(job.spec, local, (l) => log.push(l));
    tmpDir = res.tmpDir;

    const outKey = `projects/${job.project_id}/exports/${job.id}.mp4`;
    const bytes = await fs.readFile(res.outPath);
    await putObject(outKey, bytes, "video/mp4");
    log.push(`uploaded export (${(bytes.length / 1e6).toFixed(1)} MB, ${res.durationSec.toFixed(2)}s)`);

    await db.insert(mediaAssets).values({
      projectId: job.project_id,
      role: "export",
      storageKey: outKey,
      filename: `modaya-export-${job.id.slice(0, 8)}.mp4`,
      contentType: "video/mp4",
      bytes: bytes.length,
      durationSec: res.durationSec,
    });

    await db
      .update(renderJobs)
      .set({ status: "done", outputKey: outKey, finishedAt: new Date(), log: log.join("\n") })
      .where(eq(renderJobs.id, job.id));
  } catch (e) {
    await db
      .update(renderJobs)
      .set({
        status: "error",
        error: e instanceof Error ? e.message.slice(0, 4000) : String(e),
        finishedAt: new Date(),
        log: log.join("\n"),
      })
      .where(eq(renderJobs.id, job.id));
  } finally {
    for (const f of tmpFiles) await fs.rm(f, { force: true }).catch(() => {});
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

const g = globalThis as unknown as { __modayaWorking?: boolean };

/** Drain the queue. Safe to call repeatedly; only one drain runs per process. */
export async function tick() {
  if (g.__modayaWorking) return;
  g.__modayaWorking = true;
  try {
    for (;;) {
      const job = await claimJob();
      if (!job) break;
      await processJob(job);
    }
  } finally {
    g.__modayaWorking = false;
  }
}
