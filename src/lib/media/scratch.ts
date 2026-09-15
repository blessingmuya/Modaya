import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaAsset } from '@/lib/db/schema';
import { mediaRootDir } from '@/lib/env';
import { getFileTo } from '@/lib/storage/s3';
import { sanitize } from '@/lib/storage/keys';

/**
 * Workers pull media out of object storage into a scratch directory, keyed by
 * asset id + size so a re-render of the same source reuses the local copy.
 */
export async function scratchDirs(): Promise<{ sources: string; exports: string; work: string }> {
  const root = mediaRootDir();
  const dirs = {
    work: root,
    sources: join(root, 'sources'),
    exports: join(root, 'exports'),
  };
  await Promise.all([
    mkdir(dirs.sources, { recursive: true }),
    mkdir(dirs.exports, { recursive: true }),
  ]);
  return dirs;
}

export async function localCopyOf(asset: MediaAsset): Promise<string> {
  const { sources } = await scratchDirs();
  const target = join(sources, `${asset.id}-${asset.sizeBytes}-${sanitize(asset.filename)}`);

  try {
    const info = await stat(target);
    if (asset.sizeBytes > 0 && info.size === asset.sizeBytes) return target;
  } catch {
    // not cached yet
  }

  await getFileTo(asset.bucketKey, target);
  return target;
}
