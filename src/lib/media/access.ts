import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { mediaAssets, projects, type MediaAsset, type Project } from '@/lib/db/schema';

export async function projectForUser(projectId: string, userId: string): Promise<Project | null> {
  const [project] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project ?? null;
}

export async function assetForUser(
  assetId: string,
  userId: string,
): Promise<{ asset: MediaAsset; project: Project } | null> {
  const rows = await getDb()
    .select({ asset: mediaAssets, project: projects })
    .from(mediaAssets)
    .innerJoin(projects, eq(projects.id, mediaAssets.projectId))
    .where(and(eq(mediaAssets.id, assetId), eq(projects.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

const ALLOWED_ROLES = new Set(['source', 'reference']);

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export function validateUpload(input: {
  role?: string;
  contentType?: string;
  sizeBytes?: number;
  filename?: string;
}): { ok: true; role: string } | { ok: false; error: string } {
  const role = input.role ?? 'source';
  if (!ALLOWED_ROLES.has(role)) return { ok: false, error: `Unsupported role "${role}".` };

  const type = input.contentType ?? '';
  if (!/^(video|audio|image)\//.test(type)) {
    return { ok: false, error: 'Only video, audio and image files can be uploaded.' };
  }
  if (!input.filename || input.filename.length > 300) {
    return { ok: false, error: 'A filename is required (max 300 characters).' };
  }
  const size = input.sizeBytes ?? 0;
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'File appears to be empty.' };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: 'Files must be 2 GB or smaller.' };
  return { ok: true, role };
}

export function kindFor(contentType: string): 'video' | 'audio' | 'image' {
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('image/')) return 'image';
  return 'video';
}
