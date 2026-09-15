import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { assertProjectAccess } from "@/lib/project";
import { signedDownload } from "@/lib/storage";

export const runtime = "nodejs";

/** Redirects to a short-lived signed URL for the asset in object storage. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await assertProjectAccess(asset.projectId);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const url = await signedDownload(asset.storageKey, 3600, download ? asset.filename : undefined);
  return NextResponse.redirect(url, 302);
}
