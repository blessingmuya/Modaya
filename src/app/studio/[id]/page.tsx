import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { mediaAssets, projects } from '@/lib/db/schema';
import { Wordmark } from '@/components/brand';
import { MediaUploader } from '@/components/studio/media-uploader';
import { MediaList } from '@/components/studio/media-list';
import { requestContextFromHeaders } from '@/lib/storage/s3';

export const dynamic = 'force-dynamic';

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
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

  const ctx = await requestContextFromHeaders();
  const sources = assets.filter((a) => a.role === 'source');
  const references = assets.filter((a) => a.role === 'reference');

  return (
    <div className="min-h-screen">
      <header className="border-b border-line/70">
        <div className="container-page flex h-16 items-center justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Wordmark href="/dashboard" />
            <span className="text-faint">/</span>
            <span className="truncate text-[14px] text-ink-soft">{project.name}</span>
          </div>
          <Link href="/dashboard" className="btn btn-ghost btn-sm">
            All projects
          </Link>
        </div>
      </header>

      <main className="container-page grid gap-8 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{project.name}</h1>
          <p className="mono mt-1.5 text-[11.5px] text-faint">{project.id}</p>
        </div>

        <MediaUploader projectId={project.id} />

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 text-[13px] font-medium tracking-wide text-faint uppercase">
              Footage ({sources.length})
            </h2>
            <MediaList
              assets={sources}
              ctx={ctx}
              emptyLabel="No footage attached yet. Upload a video to start."
            />
          </section>
          <section>
            <h2 className="mb-3 text-[13px] font-medium tracking-wide text-faint uppercase">
              Reference ({references.length})
            </h2>
            <MediaList
              assets={references}
              ctx={ctx}
              emptyLabel="No reference attached. Modaya works without one."
            />
          </section>
        </div>

        <section className="card p-6">
          <h2 className="text-[15px] font-medium text-ink">Next</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted">
            Uploads land in object storage and are recorded in Postgres today. The timeline,
            cut/trim operations and the server-side ffmpeg export arrive in the next phase — this
            page grows controls only as they become real.
          </p>
        </section>
      </main>
    </div>
  );
}
