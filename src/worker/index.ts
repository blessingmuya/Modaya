/**
 * The Modaya worker.
 *
 * Claims jobs from the `jobs` table (SELECT … FOR UPDATE SKIP LOCKED), runs
 * ffmpeg locally, writes results back to Postgres and puts rendered files into
 * object storage. Run as many of these as you like against the same database.
 */
import { getPool } from '@/lib/db/client';
import { workerPollMs } from '@/lib/env';
import { ensureBucket } from '@/lib/storage/s3';
import {
  claimJob,
  completeJob,
  failJob,
  requeueStuckJobs,
  type JobType,
} from '@/lib/jobs/queue';
import { handleAnalyzeMedia } from './handlers/analyze-media';
import { handleProbeMedia } from './handlers/probe-media';
import { handleRenderExport } from './handlers/render-export';

const HANDLERS: Record<JobType, (job: never) => Promise<Record<string, unknown>>> = {
  probe_media: handleProbeMedia as never,
  render_export: handleRenderExport as never,
  analyze_media: handleAnalyzeMedia as never,
};

let running = true;
let active = false;

export async function tick(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;

  active = true;
  const started = Date.now();
  console.log(`[worker] ${job.type} ${job.id} attempt ${job.attempts}`);
  try {
    const handler = HANDLERS[job.type as JobType];
    if (!handler) throw new Error(`no handler for job type "${job.type}"`);
    const result = await handler(job as never);
    await completeJob(job.id, result);
    console.log(`[worker] ${job.type} ${job.id} ok in ${Date.now() - started}ms`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const next = await failJob(job.id, message);
    console.error(`[worker] ${job.type} ${job.id} ${next}: ${message}`);
    if ((err as { stderr?: string }).stderr) {
      console.error(`[worker] ffmpeg said: ${(err as { stderr?: string }).stderr?.slice(-800)}`);
    }
  } finally {
    active = false;
  }
  return true;
}

async function main() {
  await ensureBucket().catch(() => {});
  const recovered = await requeueStuckJobs().catch(() => 0);
  if (recovered > 0) console.log(`[worker] requeued ${recovered} stuck job(s)`);

  console.log(`[worker] ready, polling every ${workerPollMs()}ms`);

  while (running) {
    const didWork = await tick().catch((err) => {
      console.error('[worker] loop error', (err as Error).message);
      return false;
    });
    if (!didWork) await sleep(workerPollMs());
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    running = false;
    console.log(`[worker] ${signal} received, finishing current job then exiting`);
    // Give an in-flight render a moment to land before we drop the socket.
    for (let i = 0; i < 60 && active; i += 1) await sleep(500);
    await getPool().end().catch(() => {});
    process.exit(0);
  });
}

main().catch(async (err) => {
  console.error('[worker] fatal', err);
  await getPool().end().catch(() => {});
  process.exit(1);
});
