import { getCurrentUser } from '@/lib/auth/session';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { assetForUser } from '@/lib/media/access';
import { visionAvailable } from '@/lib/style/llm';

export const runtime = 'nodejs';

/**
 * Queue an analysis of this media. The measured layer always runs; the model
 * layer runs only when a provider is configured, and the response says which.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id } = await ctx.params;
  const found = await assetForUser(id, user.id);
  if (!found) return jsonError(404, 'Media not found.');
  if (found.asset.status !== 'ready') {
    return jsonError(409, 'Media must finish uploading and probing before it can be analyzed.');
  }

  const body = (await readJson<{ includeModel?: boolean }>(req)) ?? {};
  const includeModel = body.includeModel !== false && visionAvailable();

  const job = await enqueueJob(found.asset.projectId, 'analyze_media', {
    assetId: found.asset.id,
    includeModel,
  });

  return jsonOk(
    {
      jobId: job.id,
      includeModel,
      modelStatus: visionAvailable() ? 'requested' : 'skipped_no_key',
    },
    202,
  );
}
