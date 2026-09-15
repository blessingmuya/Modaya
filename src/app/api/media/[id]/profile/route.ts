import { desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { styleProfiles } from '@/lib/db/schema';
import { jsonError, jsonOk } from '@/lib/http';
import { assetForUser } from '@/lib/media/access';
import { visionAvailable } from '@/lib/style/llm';
import type { StyleProfile } from '@/lib/style/types';

export const runtime = 'nodejs';

/** The latest style profile for a media asset, both layers labelled. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id } = await ctx.params;
  const found = await assetForUser(id, user.id);
  if (!found) return jsonError(404, 'Media not found.');

  const [row] = await getDb()
    .select()
    .from(styleProfiles)
    .where(eq(styleProfiles.assetId, id))
    .orderBy(desc(styleProfiles.createdAt))
    .limit(1);

  const profile: StyleProfile | null = row
    ? {
        id: row.id,
        projectId: row.projectId,
        assetId: row.assetId,
        measured: row.measured as StyleProfile['measured'],
        model: (row.model as StyleProfile['model']) ?? null,
        modelStatus: row.modelStatus as StyleProfile['modelStatus'],
        modelError: row.modelError,
        createdAt: row.createdAt.toISOString(),
      }
    : null;

  return jsonOk({ profile, visionConfigured: visionAvailable() });
}
