import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { mediaAssets, projects, styleProfiles } from "@/lib/db/schema";
import { AppHeader } from "@/components/app-header";
import { MediaUploader } from "@/components/studio/media-uploader";
import { MediaList } from "@/components/studio/media-list";
import { TimelineEditor } from "@/components/studio/timeline-editor";
import { StylePanel } from "@/components/studio/style-panel";
import { requestContextFromHeaders } from "@/lib/storage/s3";
import { latestSpec } from "@/lib/timeline/store";
import type { StyleProfile as StyleProfileData } from "@/lib/style/types";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/studio/${id}`);

  const [project] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) notFound();

  const assets = await getDb()
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.projectId, project.id))
    .orderBy(desc(mediaAssets.createdAt));

  const [ctx, spec, profileRows] = await Promise.all([
    requestContextFromHeaders(),
    latestSpec(project.id),
    getDb()
      .select()
      .from(styleProfiles)
      .where(eq(styleProfiles.projectId, project.id))
      .orderBy(desc(styleProfiles.createdAt)),
  ]);

  // Latest profile per asset, rendered on the server so the spec panel is
  // readable without waiting for client hydration.
  const profilesByAsset = new Map<string, StyleProfileData>();
  for (const row of profileRows) {
    if (profilesByAsset.has(row.assetId)) continue;
    profilesByAsset.set(row.assetId, {
      id: row.id,
      projectId: row.projectId,
      assetId: row.assetId,
      measured: row.measured as StyleProfileData["measured"],
      model: (row.model as StyleProfileData["model"]) ?? null,
      modelStatus: row.modelStatus as StyleProfileData["modelStatus"],
      modelError: row.modelError,
      createdAt: row.createdAt.toISOString(),
    });
  }
  const sources = assets.filter((a) => a.role === "source");
  const references = assets.filter((a) => a.role === "reference");

  return (
    <div className="min-h-screen">
      <AppHeader crumb={project.name}>
        <Link href="/dashboard" className="btn btn-secondary btn-sm">
          All projects
        </Link>
      </AppHeader>

      <main className="container-page grid gap-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {project.name}
          </h1>
          <p className="mono mt-1.5 text-[11.5px] text-faint">{project.id}</p>
        </div>

        <MediaUploader projectId={project.id} />

        <TimelineEditor
          projectId={project.id}
          sources={sources}
          initialSpec={spec}
        />

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-[13px] font-medium tracking-wide text-faint uppercase">
              Footage ({sources.length})
            </h2>
            <MediaList
              assets={sources}
              ctx={ctx}
              emptyLabel="No footage attached yet. Upload a video to start."
            />
          </div>
          <div>
            <h2 className="mb-3 text-[13px] font-medium tracking-wide text-faint uppercase">
              Reference ({references.length})
            </h2>
            <MediaList
              assets={references}
              ctx={ctx}
              emptyLabel="No reference attached. Modaya works without one."
            />
          </div>
        </section>

        <section className="grid gap-4">
          <div>
            <h2 className="text-[13px] font-medium tracking-wide text-faint uppercase">
              Style profiles
            </h2>
            <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-muted">
              One profile per file. The{" "}
              <span className="text-accent-strong">measured</span> layer is
              deterministic math over sampled frames and decoded audio; the{" "}
              <span className="text-warn-text">model-described</span> layer is
              prose from a multimodal model looking at up to 8 sampled frames.
              They are never merged, and timestamps only ever come from the
              measured side.
            </p>
          </div>
          {assets.length === 0 ? (
            <p className="rounded-lg bg-base-900 px-4 py-3.5 text-[13px] text-faint ring-1 ring-line">
              Upload footage or a reference, then analyze it here.
            </p>
          ) : (
            <div className="grid gap-4">
              {assets
                .filter((asset) => asset.role !== "export")
                .map((asset) => (
                  <StylePanel
                    key={`${asset.id}-${asset.createdAt}`}
                    assetId={asset.id}
                    filename={asset.filename}
                    variant={asset.role === "reference" ? "full" : "compact"}
                    initialProfile={profilesByAsset.get(asset.id) ?? null}
                  />
                ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
