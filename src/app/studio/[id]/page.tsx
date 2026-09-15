import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedProject } from "@/app/actions/projects";
import { getAssets, getJobs, getTimeline } from "@/lib/project";
import StudioClient from "@/components/StudioClient";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const project = await getOwnedProject(id);
  if (!project) notFound();

  const [assets, timeline, jobs] = await Promise.all([
    getAssets(id),
    getTimeline(id),
    getJobs(id, 5),
  ]);

  return (
    <main className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Logo size="sm" />
            <span className="text-muted">/</span>
            <span className="text-sm">{project.name}</span>
          </div>
          <Link href="/dashboard" className="btn-ghost text-sm">
            Dashboard
          </Link>
        </div>
      </header>

      <StudioClient
        projectId={id}
        initialAssets={assets.map((a) => ({
          id: a.id,
          role: a.role,
          filename: a.filename,
          durationSec: a.durationSec,
          width: a.width,
          height: a.height,
          fps: a.fps,
          bytes: a.bytes,
        }))}
        initialTimeline={timeline}
        initialJobs={jobs.map((j) => ({
          id: j.id,
          status: j.status,
          error: j.error,
          createdAt: String(j.createdAt),
        }))}
      />
    </main>
  );
}
