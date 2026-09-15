import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { mediaAssets } from '@/lib/db/schema';
import { probeFile } from '@/lib/ffmpeg/probe';
import { localCopyOf } from '@/lib/media/scratch';
import type { Job } from '@/lib/db/schema';
import type { ProbeMediaPayload } from '@/lib/jobs/queue';

export async function handleProbeMedia(job: Job): Promise<Record<string, unknown>> {
  const payload = job.payload as ProbeMediaPayload;
  const db = getDb();

  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, payload.assetId))
    .limit(1);
  if (!asset) throw new Error(`media asset ${payload.assetId} no longer exists`);

  const localPath = await localCopyOf(asset);
  const probe = await probeFile(localPath);

  await db
    .update(mediaAssets)
    .set({
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      probeJson: probe.raw as Record<string, unknown>,
      status: 'ready',
    })
    .where(eq(mediaAssets.id, asset.id));

  return {
    assetId: asset.id,
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
    hasVideo: probe.hasVideo,
  };
}
