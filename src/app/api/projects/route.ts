import { desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { jsonError, jsonOk, readJson } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const rows = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));

  return jsonOk({ projects: rows });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const body = (await readJson<{ name?: string }>(req)) ?? {};
  const name = (body.name ?? '').trim() || 'Untitled project';
  if (name.length > 120) return jsonError(400, 'Project name must be 120 characters or fewer.');

  const [project] = await getDb()
    .insert(projects)
    .values({ userId: user.id, name })
    .returning();

  return jsonOk({ project }, 201);
}
