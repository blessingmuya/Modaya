import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { timelineVersions, type TimelineVersion } from '@/lib/db/schema';
import type { TimelineSpec } from './spec';
import { invalidSpecReason } from './validate';

export async function latestVersion(projectId: string): Promise<TimelineVersion | null> {
  const [row] = await getDb()
    .select()
    .from(timelineVersions)
    .where(eq(timelineVersions.projectId, projectId))
    .orderBy(desc(timelineVersions.version))
    .limit(1);
  return row ?? null;
}

export async function latestSpec(projectId: string): Promise<TimelineSpec | null> {
  const row = await latestVersion(projectId);
  if (!row) return null;
  const reason = invalidSpecReason(row.spec);
  return reason ? null : (row.spec as TimelineSpec);
}

/**
 * Timelines are append-only: every save is a new version, so an export can be
 * traced to the exact spec it rendered.
 */
export async function saveVersion(
  projectId: string,
  spec: TimelineSpec,
  source: 'manual' | 'initial' | 'chat' | 'plan',
  note?: string,
): Promise<TimelineVersion> {
  const current = await latestVersion(projectId);
  const [row] = await getDb()
    .insert(timelineVersions)
    .values({
      projectId,
      version: (current?.version ?? 0) + 1,
      spec,
      source,
      note: note ?? null,
    })
    .returning();
  return row;
}
