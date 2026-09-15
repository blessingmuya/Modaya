import { randomUUID } from 'node:crypto';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { mediaAssets } from '@/lib/db/schema';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { kindFor, projectForUser, validateUpload } from '@/lib/media/access';
import { sourceKey } from '@/lib/storage/keys';
import { presignPut, requestContextFrom } from '@/lib/storage/s3';

export const runtime = 'nodejs';

type Body = {
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  role?: 'source' | 'reference';
};

/**
 * Step 1 of the upload flow: validate the intent, create the pointer row, and
 * hand back a signed URL. The bytes never pass through this server.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id: projectId } = await ctx.params;
  const project = await projectForUser(projectId, user.id);
  if (!project) return jsonError(404, 'Project not found.');

  const body = await readJson<Body>(req);
  if (!body) return jsonError(400, 'Invalid JSON body.');

  const check = validateUpload(body);
  if (!check.ok) return jsonError(400, check.error);

  const contentType = body.contentType!;
  const filename = body.filename!;
  const assetId = randomUUID();
  const key = sourceKey(projectId, assetId, filename);

  await getDb().insert(mediaAssets).values({
    id: assetId,
    projectId,
    role: check.role,
    kind: kindFor(contentType),
    bucketKey: key,
    filename,
    contentType,
    sizeBytes: body.sizeBytes ?? 0,
    status: 'pending',
  });

  const uploadUrl = await presignPut(requestContextFrom(req.headers), {
    key,
    contentType,
    expiresIn: 60 * 30,
  });

  return jsonOk({ assetId, key, uploadUrl, expiresIn: 1800 }, 201);
}
