import { startSession, verifyLogin } from '@/lib/auth/session';
import { validateCredentials } from '@/lib/auth/constants';
import { jsonError, jsonOk, readJson } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await readJson<{ email?: string; password?: string }>(req);
  if (!body) return jsonError(400, 'Invalid JSON body.');

  // Validate shape only; do not leak which part was wrong.
  const problem = validateCredentials(body);
  if (problem && !body.password) return jsonError(400, problem);

  const user = await verifyLogin(body.email ?? '', body.password ?? '');
  if (!user) return jsonError(401, 'Email or password is incorrect.');

  await startSession(user.id);
  return jsonOk({ userId: user.id });
}
