import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { mediaAssets, type Job } from '@/lib/db/schema';
import { probeFile } from '@/lib/ffmpeg/probe';
import { reportProgress, type RenderExportPayload } from '@/lib/jobs/queue';
import { localCopyOf, scratchDirs } from '@/lib/media/scratch';
import { renderTimeline, type RenderSource } from '@/lib/render/run';
import { exportKey } from '@/lib/storage/keys';
import { putFile } from '@/lib/storage/s3';
import type { TimelineSpec } from '@/lib/timeline/spec';
import { timelineSpecSchema } from '@/lib/timeline/validate';

export async function handleRenderExport(job: Job): Promise<Record<string, unknown>> {
  const payload = job.payload as RenderExportPayload;
  const db = getDb();

  // The spec is frozen into the job payload. Re-validated here because nothing
  // reaches ffmpeg without passing the same schema the API uses.
  const parsed = timelineSpecSchema.safeParse(payload.spec);
  if (!parsed.success) {
    throw new Error(
      `job carries an invalid timeline spec: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const spec: TimelineSpec = parsed.data;

  const assetIds = [...new Set(spec.clips.map((clip) => clip.assetId))];
  const assets = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, job.projectId), inArray(mediaAssets.id, assetIds)));

  if (assets.length !== assetIds.length) {
    throw new Error('timeline references media that is not part of this project');
  }

  const sources: RenderSource[] = [];
  for (const asset of assets) {
    const localPath = await localCopyOf(asset);
    sources.push({
      assetId: asset.id,
      filePath: localPath,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      hasAudio: hasAudioTrack(asset.probeJson),
    });
  }

  const { exports } = await scratchDirs();
  const outputPath = join(exports, `${job.id}.mp4`);

  const render = await renderTimeline({
    spec,
    sources,
    outputPath,
    onProgress: (fraction) => {
      void reportProgress(job.id, fraction).catch(() => {});
    },
  });

  const probe = await probeFile(outputPath);
  const key = exportKey(job.projectId, job.id);
  const filename = `modaya-export-${job.id.slice(0, 8)}.mp4`;
  const sizeBytes = await putFile(key, outputPath, 'video/mp4');

  const [exportAsset] = await db
    .insert(mediaAssets)
    .values({
      projectId: job.projectId,
      role: 'export',
      kind: 'video',
      bucketKey: key,
      filename,
      contentType: 'video/mp4',
      sizeBytes,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      status: 'ready',
      probeJson: probe.raw as Record<string, unknown>,
    })
    .returning();

  await unlink(outputPath).catch(() => {});

  return {
    assetId: exportAsset.id,
    filename,
    sizeBytes,
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    clips: spec.clips.length,
    inputs: sources.length,
    renderWallMs: render.wallMs,
    realtimeFactor:
      render.wallMs > 0 && render.durationSec > 0
        ? Number((render.durationSec / (render.wallMs / 1000)).toFixed(2))
        : null,
  };
}

function hasAudioTrack(probeJson: unknown): boolean {
  const streams = (probeJson as { streams?: { codec_type?: string }[] } | null)?.streams;
  if (!Array.isArray(streams)) return false;
  return streams.some((stream) => stream.codec_type === 'audio');
}
