'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: { id: string };
      error?: string;
    };

    if (!res.ok || !data.project) {
      setError(data.error ?? 'Could not create the project.');
      setBusy(false);
      return;
    }

    router.push(`/studio/${data.project.id}`);
  }

  return (
    <form onSubmit={create} className="flex flex-wrap items-center gap-2">
      <input
        className="input w-56"
        placeholder="New project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        aria-label="New project name"
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'New project'}
      </button>
      {error && <span className="text-[12.5px] text-danger-400">{error}</span>}
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
