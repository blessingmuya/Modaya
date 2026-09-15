import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { jobs, type Job } from '@/lib/db/schema';

export type JobType = 'probe_media' | 'render_export';

export type ProbeMediaPayload = { assetId: string };
export type RenderExportPayload = {
  /** The exact spec to render — frozen at enqueue time, never re-read later. */
  spec: unknown;
  timelineVersionId: string | null;
  label?: string;
};

export const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 10 * 60 * 1000;

export async function enqueueJob(
  projectId: string,
  type: JobType,
  payload: ProbeMediaPayload | RenderExportPayload,
): Promise<Job> {
  const [job] = await getDb()
    .insert(jobs)
    .values({ projectId, type, payload, status: 'queued' })
    .returning();
  return job;
}

/**
 * Claim the oldest queued job. SKIP LOCKED means N workers can poll the same
 * table without ever claiming the same row.
 */
export async function claimJob(): Promise<Job | null> {
  // Columns are aliased back to camelCase: raw SQL results are not run through
  // Drizzle's column mapping, and the rest of the worker expects typed rows.
  const result = await getDb().execute(sql`
    update jobs
       set status = 'running',
           attempts = attempts + 1,
           locked_at = now(),
           started_at = coalesce(started_at, now()),
           progress = 0
     where id = (
       select id from jobs
        where status = 'queued'
        order by created_at asc
        limit 1
        for update skip locked
     )
    returning
      id,
      project_id   as "projectId",
      type,
      status,
      payload,
      result,
      error,
      progress,
      attempts,
      locked_at    as "lockedAt",
      started_at   as "startedAt",
      finished_at  as "finishedAt",
      created_at   as "createdAt"
  `);
  const row = (result.rows as Job[])[0];
  return row ?? null;
}

export async function reportProgress(jobId: string, fraction: number): Promise<void> {
  const progress = Math.max(0, Math.min(99, Math.round(fraction * 100)));
  await getDb()
    .update(jobs)
    .set({ progress, lockedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export async function completeJob(jobId: string, result: Record<string, unknown>): Promise<void> {
  await getDb()
    .update(jobs)
    .set({
      status: 'succeeded',
      result,
      progress: 100,
      error: null,
      finishedAt: new Date(),
      lockedAt: null,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * A failed attempt is requeued while attempts remain, so a transient ffmpeg or
 * network problem does not lose the user's export.
 */
export async function failJob(jobId: string, message: string): Promise<'queued' | 'failed'> {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const canRetry = (job?.attempts ?? MAX_ATTEMPTS) < MAX_ATTEMPTS;

  await db
    .update(jobs)
    .set({
      status: canRetry ? 'queued' : 'failed',
      error: message.slice(0, 2000),
      finishedAt: canRetry ? null : new Date(),
      lockedAt: null,
    })
    .where(eq(jobs.id, jobId));

  return canRetry ? 'queued' : 'failed';
}

/** Recover jobs whose worker died mid-render. */
export async function requeueStuckJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const rows = await getDb()
    .update(jobs)
    .set({ status: 'queued', lockedAt: null, error: 'requeued after worker timeout' })
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}

export async function getJob(jobId: string): Promise<Job | null> {
  const [job] = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job ?? null;
}

export async function latestJobForProject(
  projectId: string,
  type: JobType,
): Promise<Job | null> {
  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.type, type)))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return job ?? null;
}

export function jobPayload<T>(job: Job): T {
  return job.payload as T;
}
