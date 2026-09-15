import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Logo } from "@/components/ui";
import { db } from "@/db";
import { editPlans } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedProject } from "@/app/actions/projects";
import { getAssets, getJobs, getTimeline } from "@/lib/project";
import { getReferenceProfile } from "@/lib/footage";
import Studio from "@/components/studio/Studio";
import type { OpResult } from "@/components/studio/types";
import type { Marker } from "@/lib/markers";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const project = await getOwnedProject(id);
  if (!project) notFound();

  const [assets, timeline, jobs, profile, planRows] = await Promise.all([
    getAssets(id),
    getTimeline(id),
    getJobs(id, 5),
    getReferenceProfile(id),
    db.select().from(editPlans).where(eq(editPlans.projectId, id)).orderBy(desc(editPlans.createdAt)).limit(1),
  ]);

  const plan = planRows[0]
    ? { results: planRows[0].results as unknown as OpResult[], markers: planRows[0].markers as unknown as Marker[] }
    : null;

  return (
    <main className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Logo size="sm" />
            <span className="text-muted">/</span>
            <span className="text-sm">{project.name}</span>
          </div>
          <Link href="/dashboard" className="btn-ghost text-sm">Dashboard</Link>
        </div>
      </header>

      <Studio
        projectId={id}
        projectName={project.name}
        initialAssets={assets.map((a) => ({
          id: a.id, role: a.role, filename: a.filename, durationSec: a.durationSec,
          width: a.width, height: a.height, fps: a.fps, bytes: a.bytes,
        }))}
        initialTimeline={timeline}
        initialJobs={jobs.map((j) => ({ id: j.id, status: j.status, error: j.error, createdAt: String(j.createdAt) }))}
        initialProfile={profile}
        initialPlan={plan}
      />
    </main>
  );
}
