"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Logo } from "@/components/ui";
import type { AuthState } from "@/app/actions/auth";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-mint w-full" disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

export default function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
}) {
  const [state, formAction] = useActionState(action, {} as AuthState);
  const isSignup = mode === "signup";

  return (
    <main className="glow flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-sm p-7">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isSignup ? "Email and password. No social login." : "Log in to your projects."}
        </p>

        <form action={formAction} className="mt-6 space-y-3">
          <input className="input-dark" name="email" type="email" placeholder="you@studio.com" autoComplete="email" required />
          <input
            className="input-dark"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />
          {state?.error && <p className="text-sm text-danger">{state.error}</p>}
          <Submit label={isSignup ? "Create account" : "Log in"} />
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-mint">
                Log in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/signup" className="text-mint">
                Sign up
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
