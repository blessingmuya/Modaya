import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { mediaAssets, styleProfiles, type Job } from '@/lib/db/schema';
import { reportProgress } from '@/lib/jobs/queue';
import { localCopyOf } from '@/lib/media/scratch';
import { analyzeMedia } from '@/lib/style/analyze';

export type AnalyzeMediaPayload = { assetId: string; includeModel: boolean };

/**
 * Runs the measured layer (always) and the model-described layer (when a key is
 * configured). A model failure is recorded on the profile, not thrown: the
 * measurement is still worth keeping.
 */
export async function handleAnalyzeMedia(job: Job): Promise<Record<string, unknown>> {
  const payload = job.payload as AnalyzeMediaPayload;
  const db = getDb();

  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, payload.assetId))
    .limit(1);
  if (!asset) throw new Error(`media asset ${payload.assetId} no longer exists`);

  const localPath = await localCopyOf(asset);

  const stages = ['downloading', 'sampling', 'measuring', 'model', 'saving'];
  const outcome = await analyzeMedia({
    filePath: localPath,
    filename: asset.filename,
    includeModel: payload.includeModel,
    onProgress: (stage) => {
      const index = stages.indexOf(stage);
      if (index >= 0) void reportProgress(job.id, (index + 1) / stages.length).catch(() => {});
    },
  });

  const [profile] = await db
    .insert(styleProfiles)
    .values({
      projectId: asset.projectId,
      assetId: asset.id,
      measured: outcome.measured,
      model: outcome.model as unknown as Record<string, unknown> | null,
      modelStatus: outcome.modelStatus,
      modelError: outcome.modelError,
    })
    .returning();

  return {
    profileId: profile.id,
    assetId: asset.id,
    cutCount: outcome.measured.cuts.cutTimesSec.length,
    medianShotSec: outcome.measured.shots.medianSec,
    modelStatus: outcome.modelStatus,
  };
}
