import { and, desc, eq, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { jobs, mediaAssets } from '@/lib/db/schema';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { projectForUser } from '@/lib/media/access';
import type { TimelineSpec } from '@/lib/timeline/spec';
import { invalidSpecReason } from '@/lib/timeline/validate';
import { latestSpec, saveVersion } from '@/lib/timeline/store';
import { presignGet, requestContextFrom } from '@/lib/storage/s3';

export const runtime = 'nodejs';

/** Renders that have finished, newest first, each with a signed download URL. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id: projectId } = await ctx.params;
  const project = await projectForUser(projectId, user.id);
  if (!project) return jsonError(404, 'Project not found.');

  const renders = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.type, 'render_export')))
    .orderBy(desc(jobs.createdAt))
    .limit(25);

  const assetIds = renders
    .map((job) => (job.result as { assetId?: string } | null)?.assetId)
    .filter((id): id is string => Boolean(id));

  const assets = assetIds.length
    ? await getDb().select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds))
    : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const requestCtx = requestContextFrom(req.headers);

  const exports = await Promise.all(
    renders.map(async (job) => {
      const assetId = (job.result as { assetId?: string } | null)?.assetId;
      const asset = assetId ? assetById.get(assetId) : undefined;
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        createdAt: job.createdAt,
        result: job.result,
        assetId: asset?.id ?? null,
        filename: asset?.filename ?? null,
        sizeBytes: asset?.sizeBytes ?? null,
        durationSec: asset?.durationSec ?? null,
        downloadUrl: asset
          ? await presignGet(requestCtx, {
              key: asset.bucketKey,
              filename: asset.filename,
              expiresIn: 60 * 60 * 6,
            })
          : null,
        streamUrl: asset
          ? await presignGet(requestCtx, { key: asset.bucketKey, expiresIn: 60 * 60 * 6 })
          : null,
      };
    }),
  );

  return jsonOk({ exports });
}

/**
 * Queue a render. The spec is validated here, frozen into the job row, and
 * versioned — so the export always matches a spec you can inspect.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id: projectId } = await ctx.params;
  const project = await projectForUser(projectId, user.id);
  if (!project) return jsonError(404, 'Project not found.');

  const body = (await readJson<{ spec?: unknown }>(req)) ?? {};
  let spec = body.spec as TimelineSpec | undefined;
  let versionId: string | null = null;

  if (spec) {
    const reason = invalidSpecReason(spec);
    if (reason) return jsonError(400, `Invalid timeline spec — ${reason}`);
    const version = await saveVersion(projectId, spec, 'manual', 'saved by render request');
    versionId = version.id;
  } else {
    const stored = await latestSpec(projectId);
    if (!stored) return jsonError(400, 'There is no timeline to render yet.');
    spec = stored;
  }

  const job = await enqueueJob(projectId, 'render_export', {
    spec,
    timelineVersionId: versionId,
  });

  return jsonOk({ jobId: job.id, status: job.status }, 202);
}
