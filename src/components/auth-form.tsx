'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand';

type Mode = 'login' | 'signup';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Try again.');
      setBusy(false);
      return;
    }

    const next = params.get('next') || '/dashboard';
    router.push(next.startsWith('/') ? next : '/dashboard');
    router.refresh();
  }

  const isSignup = mode === 'signup';

  return (
    <div className="container-page flex min-h-screen max-w-md flex-col justify-center py-16">
      <Wordmark />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink">
        {isSignup ? 'Create your account' : 'Sign in'}
      </h1>
      <p className="mt-2 text-[14.5px] text-muted">
        {isSignup
          ? 'Email and password. No social login yet — deliberately.'
          : 'Welcome back. Your projects are where you left them.'}
      </p>

      <form onSubmit={submit} className="mt-8 grid gap-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? 'At least 8 characters, one number' : '••••••••'}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-danger-400/10 px-3.5 py-2.5 text-[13px] text-danger-400 ring-1 ring-danger-400/30">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary mt-1 w-full" disabled={busy}>
          {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-[13.5px] text-muted">
        {isSignup ? 'Already have an account? ' : 'Need an account? '}
        <Link href={isSignup ? '/login' : '/signup'} className="text-mint-400 hover:text-mint-300">
          {isSignup ? 'Sign in' : 'Sign up'}
        </Link>
      </p>
      <p className="mt-10 text-[12.5px] text-faint">
        <Link href="/" className="hover:text-muted">
          ← Back to the homepage
        </Link>
      </p>
    </div>
  );
}
