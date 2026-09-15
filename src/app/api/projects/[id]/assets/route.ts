import { NextResponse } from "next/server";
import { assertProjectAccess, getAssets } from "@/lib/project";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await assertProjectAccess(id);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const role = new URL(req.url).searchParams.get("role") ?? undefined;
  return NextResponse.json({ assets: await getAssets(id, role || undefined) });
}
