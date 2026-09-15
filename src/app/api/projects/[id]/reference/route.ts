import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, styleProfiles } from "@/db/schema";
import { assertProjectAccess } from "@/lib/project";
import { getObjectBuffer, mediaKey, putObject } from "@/lib/storage";
import { probe } from "@/lib/ffmpeg";
import { buildStyleProfile } from "@/lib/styleProfile";

export const runtime = "nodejs";
export const maxDuration = 600;

/** Current reference asset + its StyleProfile, if any. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [ref] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.role, "reference")))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  if (!ref) return NextResponse.json({ reference: null, profile: null });

  const [sp] = await db.select().from(styleProfiles).where(eq(styleProfiles.assetId, ref.id)).limit(1);
  return NextResponse.json({ reference: ref, profile: sp?.profile ?? null });
}

/** Upload a reference video and build its StyleProfile (measured + model-described). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const reanalyzeAssetId = form.get("assetId");
  let assetRow;

  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = mediaKey(id, "reference", file.name || "reference.mp4");
    await putObject(key, buf, file.type || "video/mp4");
    const scratch = path.join(os.tmpdir(), `modaya-ref-${Date.now()}.mp4`);
    await fs.writeFile(scratch, buf);
    let meta;
    try {
      meta = await probe(scratch);
    } catch (e) {
      await fs.rm(scratch, { force: true });
      return NextResponse.json(
        { error: "unreadable_media", detail: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
    [assetRow] = await db
      .insert(mediaAssets)
      .values({
        projectId: id,
        role: "reference",
        storageKey: key,
        filename: file.name || "reference.mp4",
        contentType: file.type || "video/mp4",
        bytes: buf.length,
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        probe: meta.raw as object,
      })
      .returning();

    const profile = await buildStyleProfile(assetRow.id, scratch);
    await fs.rm(scratch, { force: true });
    await db
      .insert(styleProfiles)
      .values({ projectId: id, assetId: assetRow.id, profile })
      .onConflictDoUpdate({ target: styleProfiles.assetId, set: { profile } });
    return NextResponse.json({ reference: assetRow, profile });
  }

  if (typeof reanalyzeAssetId === "string") {
    const [a] = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, reanalyzeAssetId), eq(mediaAssets.projectId, id)))
      .limit(1);
    if (!a) return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
    const buf = await getObjectBuffer(a.storageKey);
    const scratch = path.join(os.tmpdir(), `modaya-ref-${a.id}.mp4`);
    await fs.writeFile(scratch, buf);
    const profile = await buildStyleProfile(a.id, scratch);
    await fs.rm(scratch, { force: true });
    await db
      .insert(styleProfiles)
      .values({ projectId: id, assetId: a.id, profile })
      .onConflictDoUpdate({ target: styleProfiles.assetId, set: { profile } });
    return NextResponse.json({ reference: a, profile });
  }

  return NextResponse.json({ error: "file_required" }, { status: 400 });
}
