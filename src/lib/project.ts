import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, projects, renderJobs, timelines } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { timelineSchema, type Timeline } from "@/lib/timeline";

export async function assertProjectAccess(projectId: string) {
  const user = await requireUser();
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!p) throw new Error("NOT_FOUND");
  return p;
}

export async function getTimeline(projectId: string): Promise<Timeline> {
  const [row] = await db.select().from(timelines).where(eq(timelines.projectId, projectId)).limit(1);
  const empty: Timeline = { clips: [], captions: [] };
  if (!row) {
    await db.insert(timelines).values({ projectId, clips: empty }).onConflictDoNothing();
    return empty;
  }
  // The jsonb column holds the whole Timeline object (legacy rows may hold a bare clip array).
  const stored = row.clips as unknown;
  const candidate = Array.isArray(stored) ? { clips: stored, captions: [] } : stored;
  const parsed = timelineSchema.safeParse(candidate);
  return parsed.success ? parsed.data : empty;
}

export async function saveTimeline(projectId: string, t: Timeline) {
  const clean = timelineSchema.parse(t);
  await db
    .insert(timelines)
    .values({ projectId, clips: clean as unknown as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: timelines.projectId,
      set: { clips: clean as unknown as object, updatedAt: new Date() },
    });
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  return clean;
}

export async function getAssets(projectId: string, role?: string) {
  const where = role
    ? and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.role, role))
    : eq(mediaAssets.projectId, projectId);
  return db.select().from(mediaAssets).where(where).orderBy(desc(mediaAssets.createdAt));
}

export async function getJobs(projectId: string, limit = 10) {
  return db
    .select()
    .from(renderJobs)
    .where(eq(renderJobs.projectId, projectId))
    .orderBy(desc(renderJobs.createdAt))
    .limit(limit);
}

export async function sourceMap(projectId: string) {
  const assets = await getAssets(projectId);
  return Object.fromEntries(assets.map((a) => [a.id, a.storageKey]));
}
