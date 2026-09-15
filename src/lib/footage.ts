import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, styleProfiles } from "@/db/schema";
import { getObjectBuffer } from "@/lib/storage";
import { measureStyle, type Measured, type StyleProfile } from "@/lib/styleProfile";

/**
 * Measure the project's source footage (cuts, silences, onsets, grade).
 * Cached in style_profiles keyed by the asset, so it is computed once.
 */
export async function getFootageMeasured(projectId: string): Promise<{ assetId: string; measured: Measured } | null> {
  const [src] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.role, "source")))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  if (!src) return null;

  const [cached] = await db.select().from(styleProfiles).where(eq(styleProfiles.assetId, src.id)).limit(1);
  if (cached) {
    const p = cached.profile as StyleProfile;
    if (p?.measured) return { assetId: src.id, measured: p.measured };
  }

  const buf = await getObjectBuffer(src.storageKey);
  const scratch = path.join(os.tmpdir(), `modaya-footage-${src.id}.mp4`);
  await fs.writeFile(scratch, buf);
  let measured: Measured;
  try {
    measured = await measureStyle(scratch);
  } finally {
    await fs.rm(scratch, { force: true });
  }

  const profile: StyleProfile = {
    version: 2,
    assetId: src.id,
    createdAt: new Date().toISOString(),
    measured,
    modelDescribed: null,
    modelStatus: "skipped",
    provenance: {},
  };
  await db
    .insert(styleProfiles)
    .values({ projectId, assetId: src.id, profile })
    .onConflictDoUpdate({ target: styleProfiles.assetId, set: { profile } });

  return { assetId: src.id, measured };
}

export async function getReferenceProfile(projectId: string): Promise<StyleProfile | null> {
  const [ref] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.role, "reference")))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  if (!ref) return null;
  const [sp] = await db.select().from(styleProfiles).where(eq(styleProfiles.assetId, ref.id)).limit(1);
  return (sp?.profile as StyleProfile) ?? null;
}
