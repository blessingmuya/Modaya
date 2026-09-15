import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { assertProjectAccess } from "@/lib/project";
import { mediaKey, putObject, signedUpload } from "@/lib/storage";
import { probe } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Upload a media file. The bytes land in object storage (never on local disk
 * as the source of truth) and are then probed with ffprobe.
 *
 * GET on this route issues a direct-to-storage signed PUT URL for clients that
 * can reach the storage endpoint; the POST path proxies the bytes for clients
 * that can't (e.g. a private R2 endpoint or a local dev endpoint).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const filename = url.searchParams.get("filename") || "upload.mp4";
  const contentType = url.searchParams.get("contentType") || "video/mp4";
  const role = url.searchParams.get("role") === "reference" ? "reference" : "source";
  const key = mediaKey(id, role, filename);
  return NextResponse.json({ key, uploadUrl: await signedUpload(key, contentType) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const role = form.get("role") === "reference" ? "reference" : "source";
  if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "empty_file" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const key = mediaKey(id, role, file.name || "upload.mp4");
  await putObject(key, buf, file.type || "video/mp4");

  // Probe from a scratch copy; storage remains the source of truth.
  const scratch = path.join(os.tmpdir(), `modaya-probe-${Date.now()}-${path.basename(key)}`);
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
  await fs.rm(scratch, { force: true });

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      projectId: id,
      role,
      storageKey: key,
      filename: file.name || "upload.mp4",
      contentType: file.type || "video/mp4",
      bytes: buf.length,
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      probe: meta.raw as object,
    })
    .returning();

  return NextResponse.json({ asset });
}
