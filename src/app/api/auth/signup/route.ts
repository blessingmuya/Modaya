import { eq } from 'drizzle-orm';
import { createUser, startSession } from '@/lib/auth/session';
import { validateCredentials } from '@/lib/auth/constants';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { jsonError, jsonOk, readJson } from '@/lib/http';

export const runtime = 'nodejs';

async function emailTaken(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows.length > 0;
}

export async function POST(req: Request) {
  const body = await readJson<{ email?: string; password?: string }>(req);
  if (!body) return jsonError(400, 'Invalid JSON body.');

  const problem = validateCredentials(body);
  if (problem) return jsonError(400, problem);

  const email = body.email!.trim().toLowerCase();
  if (await emailTaken(email)) {
    return jsonError(409, 'An account with that email already exists.');
  }

  try {
    const user = await createUser(email, body.password!);
    await startSession(user.id);
    return jsonOk({ userId: user.id }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return jsonError(409, 'An account with that email already exists.');
    }
    console.error('[signup] failed', err);
    return jsonError(500, 'Could not create your account. Try again.');
  }
}
