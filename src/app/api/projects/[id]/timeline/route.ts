import { getCurrentUser } from '@/lib/auth/session';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { projectForUser } from '@/lib/media/access';
import type { TimelineSpec } from '@/lib/timeline/spec';
import { invalidSpecReason } from '@/lib/timeline/validate';
import { latestSpec, saveVersion } from '@/lib/timeline/store';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id: projectId } = await ctx.params;
  const project = await projectForUser(projectId, user.id);
  if (!project) return jsonError(404, 'Project not found.');

  return jsonOk({ spec: await latestSpec(projectId) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Not signed in.');

  const { id: projectId } = await ctx.params;
  const project = await projectForUser(projectId, user.id);
  if (!project) return jsonError(404, 'Project not found.');

  const body = await readJson<{ spec?: unknown; source?: string; note?: string }>(req);
  if (!body?.spec) return jsonError(400, 'A timeline spec is required.');

  const reason = invalidSpecReason(body.spec);
  if (reason) return jsonError(400, `Invalid timeline spec — ${reason}`);

  const source = body.source === 'chat' || body.source === 'plan' ? body.source : 'manual';
  const version = await saveVersion(projectId, body.spec as TimelineSpec, source, body.note);

  return jsonOk({ version: version.version, id: version.id });
}
