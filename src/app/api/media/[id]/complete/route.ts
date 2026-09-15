import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { mediaAssets } from '@/lib/db/schema';
import { jsonError, jsonOk } from '@/lib/http';
import { assetForUser } from '@/lib/media/access';
import { headObject } from '@/lib/storage/s3';

export const runtime = 'nodejs';

/**
 * Step 2 of the upload flow: the browser says "done". We do not take its word
 * for it — we HEAD the object in storage and record what is actually there.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id } = await ctx.params;
  const found = await assetForUser(id, user.id);
  if (!found) return jsonError(404, 'Media not found.');

  const { asset } = found;
  let size = 0;
  let contentType = asset.contentType;

  try {
    const head = await headObject(asset.bucketKey);
    size = Number(head.ContentLength ?? 0);
    contentType = head.ContentType ?? asset.contentType;
  } catch {
    return jsonError(409, 'No object was found in storage for this upload.');
  }

  if (size <= 0) return jsonError(409, 'The uploaded object is empty.');

  const [updated] = await getDb()
    .update(mediaAssets)
    .set({ sizeBytes: size, contentType, status: 'ready' })
    .where(eq(mediaAssets.id, asset.id))
    .returning();

  return jsonOk({ asset: updated });
}
