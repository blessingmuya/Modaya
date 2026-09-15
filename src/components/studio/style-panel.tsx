'use client';

import { useCallback, useEffect, useState } from 'react';
import { readMeasured, type StyleProfile } from '@/lib/style/types';

type Props = {
  assetId: string;
  filename: string;
  /** Compact = source footage (measurements only); full = reference (both layers). */
  variant: 'full' | 'compact';
  /** Server-rendered profile, so the panel is complete before hydration. */
  initialProfile: StyleProfile | null;
};

type State = {
  profile: StyleProfile | null;
  visionConfigured: boolean;
  loading: boolean;
  jobId: string | null;
  jobStatus: string | null;
  jobProgress: number;
  error: string | null;
};

export function StylePanel({ assetId, filename, variant, initialProfile }: Props) {
  const [state, setState] = useState<State>({
    profile: initialProfile,
    visionConfigured: false,
    loading: false,
    jobId: null,
    jobStatus: null,
    jobProgress: 0,
    error: null,
  });

  const loadProfile = useCallback(async () => {
    const res = await fetch(`/api/media/${assetId}/profile`);
    if (!res.ok) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    const data = (await res.json()) as { profile: StyleProfile | null; visionConfigured: boolean };
    setState((prev) => ({
      ...prev,
      profile: data.profile,
      visionConfigured: data.visionConfigured,
      loading: false,
    }));
  }, [assetId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!state.jobId || state.jobStatus === 'succeeded' || state.jobStatus === 'failed') return;
    const timer = window.setInterval(async () => {
      const res = await fetch(`/api/jobs/${state.jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { job: { status: string; progress: number; error: string | null } };
      setState((prev) => ({
        ...prev,
        jobStatus: data.job.status,
        jobProgress: data.job.progress,
        error: data.job.status === 'failed' ? data.job.error : prev.error,
      }));
      if (data.job.status === 'succeeded') void loadProfile();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [state.jobId, state.jobStatus, loadProfile]);

  async function analyze() {
    setState((prev) => ({ ...prev, jobStatus: 'queued', jobProgress: 0, error: null }));
    const res = await fetch(`/api/media/${assetId}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includeModel: true }),
    });
    const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
    if (!res.ok || !data.jobId) {
      setState((prev) => ({ ...prev, jobStatus: 'failed', error: data.error ?? 'Could not start analysis.' }));
      return;
    }
    setState((prev) => ({ ...prev, jobId: data.jobId!, jobStatus: 'queued' }));
  }

  const busy = state.jobStatus === 'queued' || state.jobStatus === 'running';
  const profile = state.profile;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium text-ink">{filename}</span>
          <span className="mt-1 block text-[12px] text-muted">
            {profile
              ? `Analyzed ${new Date(profile.createdAt).toLocaleString()}`
              : 'Not analyzed yet'}
          </span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={analyze} disabled={busy}>
          {busy ? `Analyzing… ${state.jobProgress}%` : profile ? 'Re-analyze' : 'Analyze'}
        </button>
      </div>

      {busy && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-mint-400 transition-[width]" style={{ width: `${state.jobProgress}%` }} />
        </div>
      )}

      {state.error && <p className="mt-3 text-[12.5px] text-danger-400">{state.error}</p>}

      {!profile && !busy && !state.error && (
        <p className="mt-4 rounded-lg bg-base-900 p-3.5 text-[12.5px] leading-relaxed text-muted ring-1 ring-line">
          Analyzing decodes the file server-side: frame-to-frame differences give cut points, the
          decoded audio gives loudness and onsets, sampled frames give colour statistics. All of it
          is deterministic and free. The written description needs an API key and is labelled
          separately.
        </p>
      )}

      {profile && (
        <div className="mt-5 grid gap-4">
          <MeasuredBlock profile={profile} />
          {variant === 'full' && <ModelBlock profile={profile} visionConfigured={state.visionConfigured} />}
        </div>
      )}
    </div>
  );
}

function MeasuredBlock({ profile }: { profile: StyleProfile }) {
  const { measured: m, stale, missingFields } = readMeasured(profile.measured);
  const cutTimes = m.cuts?.cutTimesSec ?? [];
  const audio = m.audio;
  const grade = m.grade;

  return (
    <section className="rounded-lg bg-base-900 p-4 ring-1 ring-line">
      <header className="flex flex-wrap items-center gap-2.5">
        <span className="chip chip-measured">measured</span>
        <span className="text-[11.5px] text-faint">
          deterministic · no model involved · schema v{m.schemaVersion ?? 1}
        </span>
      </header>

      {stale && (
        <p className="mt-3 rounded-md bg-warn-400/10 px-3 py-2 text-[11.5px] text-warn-400 ring-1 ring-warn-400/25">
          This profile was recorded by an earlier version of the analyzer
          {missingFields.length > 0 ? ` and is missing: ${missingFields.join(', ')}` : ''}. Missing
          values are shown as — rather than guessed. Re-analyze to fill them in.
        </p>
      )}

      <dl className="mono mt-4 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
        <Row label="duration" value={num(m.durationSec, 2, 's')} />
        <Row
          label="frame"
          value={
            m.media
              ? `${m.media.width ?? '?'}×${m.media.height ?? '?'} @ ${num(m.media.fps, 2, 'fps')}`
              : '—'
          }
        />
        <Row label="cuts detected" value={String(cutTimes.length)} />
        <Row
          label="cut resolution"
          value={num(m.cutResolutionSec, 3, 's', '±') + (m.sampledFps ? ` (sampled at ${m.sampledFps}fps)` : '')}
        />
        <Row label="shot length (median)" value={num(m.shots?.medianSec, 2, 's')} />
        <Row
          label="shot length (min/max)"
          value={
            m.shots
              ? `${num(m.shots.minSec, 2, 's')} / ${num(m.shots.maxSec, 2, 's')}`
              : '—'
          }
        />
        <Row
          label="cuts per minute"
          value={
            m.durationSec ? ((cutTimes.length / m.durationSec) * 60).toFixed(1) : '—'
          }
        />
        <Row label="shot length stdev" value={num(m.shots?.stdevSec, 2, 's')} />
        <Row
          label="motion floor / spread"
          value={`${num(m.cuts?.medianFrameDiff, 3)} / σ ${num(m.cuts?.robustSigma, 3)}`}
        />
        <Row label="detection threshold" value={num(m.cuts?.threshold, 3)} />
        <Row label="active level" value={num(audio?.activeMeanRmsDb, 1, 'dBFS')} />
        <Row label="peak level" value={num(audio?.peakRmsDb, 1, 'dBFS')} />
        <Row label="mean level (incl. silence)" value={num(audio?.meanRmsDb, 1, 'dBFS')} />
        <Row
          label="active / silent windows"
          value={
            audio ? `${pct(audio.activeRatio)} / ${pct(audio.silenceRatio)}` : '—'
          }
        />
        <Row
          label="onsets"
          value={audio ? `${audio.onsetsSec.length} (${num(audio.onsetsPerMinute, 1, '/min')})` : '—'}
        />
        <Row
          label="silence gaps"
          value={
            audio
              ? `${audio.silenceRanges.length} below ${num(audio.silenceThresholdDb, 0, 'dBFS')}`
              : '—'
          }
        />
        <Row
          label="mean colour (R/G/B)"
          value={grade ? `${num(grade.meanR, 1)} / ${num(grade.meanG, 1)} / ${num(grade.meanB, 1)}` : '—'}
        />
        <Row
          label="luma mean / contrast"
          value={grade ? `${num(grade.meanLuma, 1)} / σ ${num(grade.contrast, 1)}` : '—'}
        />
        <Row label="saturation" value={num(grade?.saturation, 3)} />
        <Row label="warmth (R−B)" value={num(grade?.warmth, 1)} />
      </dl>

      {cutTimes.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] text-mint-300">
            {cutTimes.length} measured cut points
          </summary>
          <p className="mono mt-2 text-[11.5px] break-words text-faint">
            {cutTimes.map((t) => t.toFixed(2)).join('s · ')}s
          </p>
        </details>
      )}
    </section>
  );
}

/** Renders a measured number, or an em dash when the store does not have it. */
function num(value: number | null | undefined, digits = 2, unit = '', prefix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${prefix}${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function pct(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function ModelBlock({
  profile,
  visionConfigured,
}: {
  profile: StyleProfile;
  visionConfigured: boolean;
}) {
  const model = profile.model;

  return (
    <section className="rounded-lg bg-base-900 p-4 ring-1 ring-line">
      <header className="flex flex-wrap items-center gap-2.5">
        <span className="chip chip-described">model-described</span>
        <span className="text-[11.5px] text-faint">
          {model ? `${model.provider} · ${model.model} · ${model.frameCount} frames` : 'not available'}
        </span>
      </header>

      {model ? (
        <div className="mt-4 grid gap-3.5 text-[12.5px] leading-relaxed">
          {model.shotTypes.length > 0 && (
            <Field label="Shot types">
              <ul className="flex flex-wrap gap-1.5">
                {model.shotTypes.map((type) => (
                  <li key={type} className="chip">
                    {type}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          <Field label="Transitions">{text(model.transitionStyle)}</Field>
          <Field label="Captions">
            <span className="mono">{model.captionPosition}</span>
            {model.captionStyle ? <span> — {model.captionStyle}</span> : null}
          </Field>
          <Field label="Pacing (in words)">{text(model.pacingDescription)}</Field>
          <Field label="Hook structure">{text(model.hookStructure)}</Field>
          {model.notes.length > 0 && (
            <Field label="Notes">
              <ul className="list-inside list-disc text-muted">
                {model.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Field>
          )}
          <div className="rounded-md bg-base-950/60 p-3 text-[11.5px] text-muted ring-1 ring-line">
            <p className="font-medium text-ink-soft">Limits of this layer</p>
            <ul className="mt-1.5 list-inside list-disc">
              {model.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
            <p className="mono mt-2 text-[11px] text-faint">
              frames seen at{' '}
              {model.frameTimesSec.map((time) => `${time.toFixed(2)}s`).join(', ')}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
          {profile.modelStatus === 'skipped_no_key' &&
            'No multimodal provider is configured, so nothing is described. Set OPENAI_API_KEY or ANTHROPIC_API_KEY to enable this layer — Modaya will not guess a description to fill the gap.'}
          {profile.modelStatus === 'failed' &&
            `The model call failed: ${profile.modelError ?? 'unknown error'}. The measured layer above is unaffected.`}
          {visionConfigured && profile.modelStatus === 'skipped_no_key' && (
            <span className="mt-2 block text-faint">
              A key is present now; re-analyze to populate this layer.
            </span>
          )}
        </p>
      )}
    </section>
  );
}

function text(value: string): string {
  return value && value.trim().length > 0 ? value : 'unknown';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink-soft">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[11.5px] tracking-wide text-faint uppercase">{label}</span>
      <div className="mt-1 text-ink-soft">{children}</div>
    </div>
  );
}
