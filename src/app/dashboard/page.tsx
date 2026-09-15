import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { AppHeader } from "@/components/app-header";
import {
  NewProjectForm,
  SignOutButton,
} from "@/components/dashboard/project-actions";
import { getStorageHealth } from "@/lib/storage/health";

export const metadata = { title: "Projects — Modaya" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const rows = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));
  const storage = await getStorageHealth();

  return (
    <div className="min-h-screen">
      <AppHeader>
        <span className="hidden text-[13px] text-muted sm:inline">
          {user.email}
        </span>
        <SignOutButton />
      </AppHeader>

      <main className="container-page py-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Projects
            </h1>
            <p className="mt-2 text-[14.5px] text-muted">
              {rows.length === 0
                ? "No projects yet. Create one to get a studio."
                : `${rows.length} project${rows.length === 1 ? "" : "s"}, newest first.`}
            </p>
          </div>
          <NewProjectForm />
        </div>

        <div className="mt-10">
          {rows.length === 0 ? (
            <div className="card flex flex-col items-start gap-3 p-10">
              <h2 className="text-[15px] font-medium text-ink">
                Nothing here yet
              </h2>
              <p className="max-w-lg text-[14px] leading-relaxed text-muted">
                A project is a container for footage, an optional reference
                video, a timeline spec and the exports rendered from it. Create
                one and you will land in its studio.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3">
              {rows.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/studio/${project.id}`}
                    className="card flex items-center justify-between gap-6 p-5 no-underline transition-colors hover:border-line-strong"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-ink">
                        {project.name}
                      </span>
                      <span className="mono mt-1 block text-[11.5px] text-faint">
                        {project.id}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-6 text-[12.5px] text-muted">
                      <span className="hidden sm:inline">
                        created{" "}
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                      <span className="text-accent-strong">Open studio →</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <section className="mt-14">
          <h2 className="text-[13px] font-medium tracking-wide text-faint uppercase">
            Infrastructure
          </h2>
          <p className="mt-2 max-w-2xl text-[13.5px] text-muted">
            Modaya stores data in Postgres and media in S3-compatible object
            storage. These are live checks against the configured services, not
            a mock.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <HealthCard
              title="Postgres"
              ok={storage.database.ok}
              detail={storage.database.detail}
            />
            <HealthCard
              title={`Object storage (${storage.bucket.bucket})`}
              ok={storage.bucket.ok}
              detail={storage.bucket.detail}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function HealthCard({
  title,
  ok,
  detail,
}: {
  title: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-mint-400" : "bg-danger-text"}`}
          aria-hidden
        />
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <span
          className={`ml-auto text-[11.5px] ${ok ? "text-accent-strong" : "text-danger-text"}`}
        >
          {ok ? "connected" : "unreachable"}
        </span>
      </div>
      <p className="mono mt-2.5 text-[11.5px] break-all text-faint">{detail}</p>
    </div>
  );
}
