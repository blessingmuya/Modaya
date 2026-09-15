"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";

const creds = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type AuthState = { error?: string };

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = creds.safeParse({
    email: String(form.get("email") || "").toLowerCase().trim(),
    password: String(form.get("password") || ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (existing.length) return { error: "That email is already registered." };

  const [u] = await db
    .insert(users)
    .values({ email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password) })
    .returning({ id: users.id });

  await createSession(u.id);
  redirect("/dashboard");
}

export async function logIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = creds.safeParse({
    email: String(form.get("email") || "").toLowerCase().trim(),
    password: String(form.get("password") || ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [u] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (!u || !(await verifyPassword(parsed.data.password, u.passwordHash)))
    return { error: "Incorrect email or password." };

  await createSession(u.id);
  redirect("/dashboard");
}

export async function logOut() {
  await destroySession();
  redirect("/");
}
