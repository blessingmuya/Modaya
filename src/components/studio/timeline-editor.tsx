'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clipDuration,
  placeClips,
  round3,
  type Clip,
  type TimelineSpec,
} from '@/lib/timeline/spec';
import {
  concat,
  initialTimeline,
  removeOutputRanges,
  trimTo,
} from '@/lib/timeline/ops';
import type { MediaAsset } from '@/lib/db/schema';

type SourceInfo = Pick<MediaAsset, 'id' | 'filename' | 'durationSec' | 'width' | 'height' | 'fps'>;

type Props = {
  projectId: string;
  sources: SourceInfo[];
  initialSpec: TimelineSpec | null;
};

type ExportState = {
  jobId: string | null;
  status: string;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
  streamUrl: string | null;
  filename: string | null;
  detail: Record<string, unknown> | null;
};

const EMPTY_EXPORT: ExportState = {
  jobId: null,
  status: 'idle',
  progress: 0,
  error: null,
  downloadUrl: null,
  streamUrl: null,
  filename: null,
  detail: null,
};

export function TimelineEditor({ projectId, sources, initialSpec }: Props) {
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>(() => initialSpec?.clips ?? []);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [activeAssetId, setActiveAssetId] = useState<string>(sources[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [render, setRender] = useState<ExportState>(EMPTY_EXPORT);
  const pollRef = useRef<number | null>(null);

  const activeSource = sources.find((s) => s.id === activeAssetId) ?? sources[0];
  const placed = useMemo(() => placeClips(clips), [clips]);
  const duration = placed.length ? placed[placed.length - 1].outEnd : 0;
  const sourceDuration = Math.max(0, activeSource?.durationSec ?? 0);

  // Preview the result: a clip list has no single file, so the preview plays
  // clip by clip from the signed source URLs.
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const loadPreviewUrl = useCallback(async (assetId: string) => {
    if (previewUrls[assetId]) return;
    const res = await fetch(`/api/media/${assetId}/url`);
    if (!res.ok) return;
    const data = (await res.json()) as { url: string };
    setPreviewUrls((prev) => ({ ...prev, [assetId]: data.url }));
  }, [previewUrls]);

  useEffect(() => {
    for (const assetId of new Set(clips.map((clip) => clip.assetId))) void loadPreviewUrl(assetId);
  }, [clips, loadPreviewUrl]);

  useEffect(() => {
    if (!activeSource) return;
    setSelection({
      start: round3(Math.min(1, sourceDuration / 4)),
      end: round3(Math.min(sourceDuration, 1 + sourceDuration / 4)),
    });
  }, [activeSource?.id, sourceDuration]);

  // Poll the render job. Progress here is ffmpeg's own position in the encode.
  useEffect(() => {
    if (!render.jobId || render.status === 'succeeded' || render.status === 'failed') return;

    const poll = async () => {
      const res = await fetch(`/api/jobs/${render.jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        job: { status: string; progress: number; error: string | null; result: unknown };
        asset: { downloadUrl: string; streamUrl: string; filename: string } | null;
      };
      setRender((prev) => ({
        ...prev,
        status: data.job.status,
        progress: data.job.progress,
        error: data.job.error,
        downloadUrl: data.asset?.downloadUrl ?? prev.downloadUrl,
        streamUrl: data.asset?.streamUrl ?? prev.streamUrl,
        filename: data.asset?.filename ?? prev.filename,
        detail: (data.job.result as Record<string, unknown>) ?? prev.detail,
      }));
      if (data.job.status === 'succeeded') router.refresh();
    };

    pollRef.current = window.setInterval(poll, 1200);
    void poll();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [render.jobId, render.status, router]);

  async function persist(nextClips: Clip[], note: string) {
    setClips(nextClips);
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/projects/${projectId}/timeline`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: { version: 1, clips: nextClips }, source: 'manual', note }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(data.error ?? 'Could not save the timeline.');
      return false;
    }
    return true;
  }

  function loadSource() {
    if (!activeSource || sourceDuration <= 0) return;
    void persist(initialTimeline(activeSource.id, sourceDuration), `load ${activeSource.filename}`);
  }

  function cutSelection() {
    const next = removeOutputRanges(clips, [{ startSec: selection.start, endSec: selection.end }]);
    if (next.length === 0) {
      setMessage('That range covers the whole timeline — nothing would be left.');
      return;
    }
    void persist(next, `cut ${selection.start.toFixed(2)}–${selection.end.toFixed(2)}s`);
  }

  function keepSelection() {
    const next = trimTo(clips, { startSec: selection.start, endSec: selection.end });
    if (next.length === 0) {
      setMessage('Nothing to keep in that range.');
      return;
    }
    void persist(next, `trim to ${selection.start.toFixed(2)}–${selection.end.toFixed(2)}s`);
  }

  function appendSource() {
    if (!activeSource || sourceDuration <= 0) return;
    void persist(
      concat(clips, initialTimeline(activeSource.id, sourceDuration)),
      `append ${activeSource.filename}`,
    );
  }

  function removeClip(index: number) {
    void persist(
      clips.filter((_, i) => i !== index),
      `remove clip ${index + 1}`,
    );
  }

  async function startExport() {
    setRender({ ...EMPTY_EXPORT, status: 'queued' });
    const res = await fetch(`/api/projects/${projectId}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: { version: 1, clips } }),
    });
    const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
    if (!res.ok || !data.jobId) {
      setRender({ ...EMPTY_EXPORT, status: 'failed', error: data.error ?? 'Could not start the render.' });
      return;
    }
    setRender({ ...EMPTY_EXPORT, jobId: data.jobId, status: 'queued' });
  }

  const previewClip = placed[previewIndex]?.clip;
  const previewUrl = previewClip ? previewUrls[previewClip.assetId] : undefined;
  const busy = render.status === 'queued' || render.status === 'running';

  return (
    <div className="grid gap-6">
      {/* ---------------------------------------------------------------- preview */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-[13px] font-medium text-ink-soft">Preview</span>
          <span className="mono text-[11.5px] text-faint">
            clip {placed.length === 0 ? 0 : previewIndex + 1}/{placed.length} ·{' '}
            {duration.toFixed(2)}s out
          </span>
        </div>
        <div className="bg-black">
          {previewUrl && previewClip ? (
            <video
              key={`${previewClip.id}-${previewIndex}`}
              className="mx-auto max-h-[380px] w-full"
              src={`${previewUrl}#t=${previewClip.inSec},${previewClip.outSec}`}
              controls
              autoPlay
              playsInline
              onEnded={() => {
                if (previewIndex + 1 < placed.length) {
                  setPreviewIndex(previewIndex + 1);
                }
              }}
            />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[13px] text-faint">
              {placed.length === 0
                ? 'Nothing on the timeline yet — load a source below.'
                : 'Loading preview…'}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- timeline + ops */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-soft">Timeline</span>
          <span className="text-[12px] text-faint">
            {clips.length} clip{clips.length === 1 ? '' : 's'}
            {saving ? ' · saving…' : ''}
          </span>
        </div>

        <ClipStrip placed={placed} activeIndex={previewIndex} onSelect={setPreviewIndex} />

        <div className="mt-5 grid gap-3">
          <RangePicker
            min={0}
            max={duration}
            value={selection}
            onChange={setSelection}
            disabled={duration <= 0}
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-secondary btn-sm" onClick={cutSelection} disabled={duration <= 0 || saving}>
              Cut selected range
            </button>
            <button className="btn btn-secondary btn-sm" onClick={keepSelection} disabled={duration <= 0 || saving}>
              Trim to selection
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void persist([], 'clear timeline')}
              disabled={clips.length === 0 || saving}
            >
              Clear timeline
            </button>
          </div>
        </div>

        <div className="hairline mt-5 grid gap-3 pt-5">
          <span className="text-[13px] font-medium text-ink-soft">Sources</span>
          {sources.length === 0 ? (
            <p className="text-[13px] text-faint">
              Upload footage above — it will be probed by the worker, then appear here.
            </p>
          ) : (
            <ul className="grid gap-2">
              {sources.map((source) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-900 px-3.5 py-2.5 ring-1 ring-line"
                >
                  <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                    <input
                      type="radio"
                      name="active-source"
                      checked={activeAssetId === source.id}
                      onChange={() => setActiveAssetId(source.id)}
                      className="accent-mint-400"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{source.filename}</span>
                      <span className="mono block text-[11px] text-faint">
                        {source.durationSec ? `${source.durationSec.toFixed(2)}s` : 'probing…'}
                        {source.width ? ` · ${source.width}×${source.height}` : ''}
                        {source.fps ? ` · ${source.fps.toFixed(2)}fps` : ''}
                      </span>
                    </span>
                  </label>
                  <span className="flex gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={loadSource}
                      disabled={!source.durationSec || saving}
                    >
                      Load
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={appendSource}
                      disabled={!source.durationSec || saving}
                    >
                      Append
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message && <p className="mt-3 text-[12.5px] text-warn-400">{message}</p>}
      </div>

      {/* ------------------------------------------------------------- exports */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[13px] font-medium text-ink-soft">Export</span>
            <p className="mt-1 text-[12.5px] text-muted">
              Rendered server-side with ffmpeg at source resolution — not a browser capture.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={startExport}
            disabled={clips.length === 0 || busy || saving}
          >
            {busy ? 'Rendering…' : 'Export MP4'}
          </button>
        </div>

        {render.status !== 'idle' && (
          <div className="mt-4 grid gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${
                  render.status === 'failed' ? 'bg-danger-400' : 'bg-mint-400'
                }`}
                style={{ width: `${render.status === 'succeeded' ? 100 : render.progress}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
              <span className={render.status === 'failed' ? 'text-danger-400' : 'text-muted'}>
                {render.status === 'queued' && 'Queued for the worker…'}
                {render.status === 'running' && `Encoding on the server… ${render.progress}%`}
                {render.status === 'succeeded' && 'Render complete.'}
                {render.status === 'failed' && (render.error ?? 'Render failed.')}
              </span>
              {render.status === 'succeeded' && render.downloadUrl && (
                <span className="flex items-center gap-2">
                  {render.streamUrl && (
                    <a className="btn btn-ghost btn-sm" href={render.streamUrl} target="_blank" rel="noreferrer">
                      Play result
                    </a>
                  )}
                  <a className="btn btn-primary btn-sm" href={render.downloadUrl} download>
                    Download MP4
                  </a>
                </span>
              )}
            </div>
            {render.detail && render.status === 'succeeded' && (
              <p className="mono text-[11px] text-faint">
                {String(render.detail.clips)} clips ·{' '}
                {typeof render.detail.durationSec === 'number'
                  ? `${render.detail.durationSec.toFixed(2)}s`
                  : ''}{' '}
                · {Math.round(Number(render.detail.sizeBytes ?? 0) / 1024)} KB ·{' '}
                {typeof render.detail.renderWallMs === 'number'
                  ? `${(render.detail.renderWallMs / 1000).toFixed(1)}s wall`
                  : ''}{' '}
                {typeof render.detail.realtimeFactor === 'number'
                  ? `(${render.detail.realtimeFactor}× realtime)`
                  : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClipStrip({
  placed,
  activeIndex,
  onSelect,
}: {
  placed: ReturnType<typeof placeClips>;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const total = placed.length ? placed[placed.length - 1].outEnd : 0;
  if (placed.length === 0) {
    return (
      <div className="mt-4 flex h-16 items-center justify-center rounded-lg bg-base-900 text-[12.5px] text-faint ring-1 ring-line">
        Empty timeline
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex h-16 w-full overflow-hidden rounded-lg ring-1 ring-line">
        {placed.map(({ clip, index, outStart, outEnd }) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => onSelect(index)}
            style={{ width: `${((outEnd - outStart) / total) * 100}%` }}
            className={`group relative min-w-[36px] border-r border-base-950/70 px-1 text-left transition-colors ${
              index === activeIndex ? 'bg-mint-400/30' : 'bg-mint-400/12 hover:bg-mint-400/20'
            }`}
            title={`${clip.inSec.toFixed(2)}s → ${clip.outSec.toFixed(2)}s (source)`}
          >
            <span className="mono block truncate text-[10px] text-mint-300">
              {clipDuration(clip).toFixed(2)}s
            </span>
            <span className="mono block truncate text-[9.5px] text-faint">
              {outStart.toFixed(1)}–{outEnd.toFixed(1)}
            </span>
          </button>
        ))}
      </div>
      <div className="mono mt-1 flex justify-between text-[10px] text-faint">
        <span>0.00s</span>
        <span>{total.toFixed(2)}s</span>
      </div>
    </div>
  );
}

function RangePicker({
  min,
  max,
  value,
  onChange,
  disabled,
}: {
  min: number;
  max: number;
  value: { start: number; end: number };
  onChange: (next: { start: number; end: number }) => void;
  disabled: boolean;
}) {
  const step = 0.05;
  return (
    <div className={`grid gap-2 ${disabled ? 'opacity-50' : ''}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-3">
          <span className="w-10 text-[12px] text-faint">in</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value.start}
            disabled={disabled}
            onChange={(e) =>
              onChange({ start: Math.min(Number(e.target.value), value.end - step), end: value.end })
            }
            className="w-full accent-mint-400"
          />
          <span className="mono w-14 text-right text-[11.5px] text-ink-soft">
            {value.start.toFixed(2)}
          </span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-10 text-[12px] text-faint">out</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value.end}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                start: value.start,
                end: Math.max(Number(e.target.value), value.start + step),
              })
            }
            className="w-full accent-mint-400"
          />
          <span className="mono w-14 text-right text-[11.5px] text-ink-soft">
            {value.end.toFixed(2)}
          </span>
        </label>
      </div>
      <p className="text-[12px] text-faint">
        Selected range: {(value.end - value.start).toFixed(2)}s of the current{' '}
        {max.toFixed(2)}s timeline
      </p>
    </div>
  );
}
