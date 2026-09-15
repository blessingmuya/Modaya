import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { jobs, mediaAssets, projects } from '@/lib/db/schema';
import { jsonError, jsonOk } from '@/lib/http';
import { presignGet, requestContextFrom } from '@/lib/storage/s3';

export const runtime = 'nodejs';

/** Poll target for the export UI: status, encoder progress, and the file. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id } = await ctx.params;
  const rows = await getDb()
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(and(eq(jobs.id, id), eq(projects.userId, user.id)))
    .limit(1);

  const job = rows[0]?.job;
  if (!job) return jsonError(404, 'Job not found.');

  const assetId = (job.result as { assetId?: string } | null)?.assetId;
  let asset = null;
  if (assetId) {
    const [row] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
    if (row) {
      const requestCtx = requestContextFrom(req.headers);
      asset = {
        id: row.id,
        filename: row.filename,
        sizeBytes: row.sizeBytes,
        durationSec: row.durationSec,
        width: row.width,
        height: row.height,
        downloadUrl: await presignGet(requestCtx, {
          key: row.bucketKey,
          filename: row.filename,
          expiresIn: 60 * 60 * 6,
        }),
        streamUrl: await presignGet(requestCtx, { key: row.bucketKey, expiresIn: 60 * 60 * 6 }),
      };
    }
  }

  return jsonOk({
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      error: job.error,
      attempts: job.attempts,
      result: job.result,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    },
    asset,
  });
}
