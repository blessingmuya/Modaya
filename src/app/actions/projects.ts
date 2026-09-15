"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, timelines } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export async function listProjects() {
  const user = await requireUser();
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.updatedAt));
}

export async function createProject() {
  const user = await requireUser();
  const [p] = await db
    .insert(projects)
    .values({ userId: user.id, name: `Untitled project` })
    .returning({ id: projects.id });
  await db.insert(timelines).values({ projectId: p.id, clips: [] });
  revalidatePath("/dashboard");
  redirect(`/studio/${p.id}`);
}

export async function deleteProject(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, user.id)));
  revalidatePath("/dashboard");
}

export async function renameProject(projectId: string, name: string) {
  const user = await requireUser();
  await db
    .update(projects)
    .set({ name: name.slice(0, 120), updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  revalidatePath(`/studio/${projectId}`);
}

export async function getOwnedProject(projectId: string) {
  const user = await requireUser();
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  return p ?? null;
}
