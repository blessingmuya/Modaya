import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { logOut } from "@/app/actions/auth";
import { createProject, deleteProject, listProjects } from "@/app/actions/projects";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const rows = await listProjects();

  return (
    <main className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Logo size="sm" />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted">{user.email}</span>
            <form action={logOut}>
              <button className="btn-ghost text-sm">Log out</button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="mt-1 text-sm text-muted">
              {rows.length === 0
                ? "No projects yet. Create one to open the studio."
                : `${rows.length} project${rows.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <form action={createProject}>
            <button className="btn-mint">New project</button>
          </form>
        </div>

        {rows.length === 0 ? (
          <div className="card mt-8 p-12 text-center">
            <p className="text-muted">
              Your projects live in Postgres and your media in object storage — nothing here is
              held in browser memory.
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {rows.map((p) => (
              <li key={p.id} className="card flex items-center justify-between p-4">
                <div>
                  <Link href={`/studio/${p.id}`} className="font-medium hover:text-mint">
                    {p.name}
                  </Link>
                  <div className="mt-0.5 font-mono text-xs text-muted">
                    {p.id.slice(0, 8)} · updated {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/studio/${p.id}`} className="btn-ghost text-sm">
                    Open
                  </Link>
                  <form action={deleteProject}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn-ghost text-sm text-danger">Delete</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
