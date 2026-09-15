import { getCurrentUser } from '@/lib/auth/session';
import { jsonError, jsonOk } from '@/lib/http';
import { assetForUser } from '@/lib/media/access';
import { presignGet, requestContextFrom } from '@/lib/storage/s3';

export const runtime = 'nodejs';

/** Signed download/stream URL. The browser reads the object directly. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id } = await ctx.params;
  const found = await assetForUser(id, user.id);
  if (!found) return jsonError(404, 'Media not found.');

  const download = new URL(req.url).searchParams.get('download') === '1';
  const url = await presignGet(requestContextFrom(req.headers), {
    key: found.asset.bucketKey,
    filename: download ? found.asset.filename : undefined,
    expiresIn: 60 * 60,
  });

  return jsonOk({ url, filename: found.asset.filename, contentType: found.asset.contentType });
}
