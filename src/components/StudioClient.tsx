"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Timeline } from "@/lib/timeline";

type AssetLite = {
  id: string;
  role: string;
  filename: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number | null;
};
type JobLite = { id: string; status: string; error: string | null; createdAt: string };

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export default function StudioClient({
  projectId,
  initialAssets,
  initialTimeline,
  initialJobs,
}: {
  projectId: string;
  initialAssets: AssetLite[];
  initialTimeline: Timeline;
  initialJobs: JobLite[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [timeline, setTimeline] = useState<Timeline>(initialTimeline);
  const [jobs, setJobs] = useState<JobLite[]>(initialJobs);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<{ jobId: string; url: string } | null>(null);
  const [markA, setMarkA] = useState<number | null>(null);
  const [markB, setMarkB] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const sources = assets.filter((a) => a.role === "source");
  const exportsList = assets.filter((a) => a.role === "export");
  const duration = useMemo(
    () => timeline.clips.reduce((s, c) => s + Math.max(0, c.end - c.start), 0),
    [timeline],
  );
  const previewAsset = sources[0];

  const refreshJobs = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/export`);
    if (r.ok) {
      const d = await r.json();
      setJobs(d.jobs);
    }
  }, [projectId]);

  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "running");

  // Poll only while a job is in flight — no idle polling.
  useEffect(() => {
    if (!activeJob) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/jobs/${activeJob.id}`);
      if (!r.ok) return;
      const d = await r.json();
      setJobs((prev) => prev.map((j) => (j.id === d.job.id ? { ...j, status: d.job.status, error: d.job.error } : j)));
      if (d.job.status === "done" && d.downloadUrl) {
        setDownload({ jobId: d.job.id, url: d.downloadUrl });
        const ar = await fetch(`/api/projects/${projectId}/assets`);
        if (ar.ok) setAssets((await ar.json()).assets);
      }
      if (d.job.status === "error") setError(d.job.error || "Render failed.");
    }, 1500);
    return () => clearInterval(t);
  }, [activeJob, projectId]);

  async function upload(file: File) {
    setError(null);
    setBusy("Uploading to object storage…");
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("role", "source");
      const r = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Upload failed");
      setAssets((a) => [d.asset, ...a]);
      // A fresh upload resets the timeline to the full clip.
      const tr = await fetch(`/api/projects/${projectId}/timeline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (tr.ok) setTimeline((await tr.json()).timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function cutMarkedRange() {
    if (markA === null || markB === null) return;
    const start = Math.min(markA, markB);
    const end = Math.max(markA, markB);
    setError(null);
    setBusy("Cutting range…");
    try {
      const r = await fetch(`/api/projects/${projectId}/timeline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove_ranges", ranges: [{ start, end }] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Cut failed");
      setTimeline(d.timeline);
      setMarkA(null);
      setMarkB(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function resetTimeline() {
    setBusy("Restoring full clip…");
    const r = await fetch(`/api/projects/${projectId}/timeline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
    if (r.ok) setTimeline((await r.json()).timeline);
    setMarkA(null);
    setMarkB(null);
    setBusy(null);
  }

  async function startExport() {
    setError(null);
    setDownload(null);
    setBusy("Queuing render…");
    try {
      const r = await fetch(`/api/projects/${projectId}/export`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Export failed");
      await refreshJobs();
      // If the spec was already rendered, the job comes back done immediately.
      const jr = await fetch(`/api/jobs/${d.job.id}`);
      const jd = await jr.json();
      if (jd.job.status === "done" && jd.downloadUrl) setDownload({ jobId: jd.job.id, url: jd.downloadUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {!previewAsset ? (
        <label className="card flex cursor-pointer flex-col items-center justify-center gap-3 p-16 text-center hover:border-mint-dim">
          <span className="text-lg font-medium">Drop footage to start</span>
          <span className="text-sm text-muted">
            MP4/MOV. Uploaded to object storage, probed with ffprobe, rendered server-side.
          </span>
          <span className="btn-mint mt-2">Choose a video</span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <div className="card overflow-hidden">
              {/* Preview plays the raw source; the export is rendered server-side. */}
              <video
                ref={videoRef}
                src={`/api/media/${previewAsset.id}`}
                controls
                className="w-full bg-black"
                onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
              />
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Timeline</h2>
                <span className="font-mono text-xs text-muted">
                  {timeline.clips.length} clip{timeline.clips.length === 1 ? "" : "s"} ·{" "}
                  {fmt(duration)}
                </span>
              </div>

              <div className="mt-4 flex h-14 w-full gap-[2px] overflow-hidden rounded-lg border border-line bg-surface-2">
                {timeline.clips.map((c, i) => {
                  const len = Math.max(0, c.end - c.start);
                  return (
                    <div
                      key={c.id}
                      title={`clip ${i + 1}: source ${fmt(c.start)} → ${fmt(c.end)}`}
                      className="flex min-w-[2px] items-center justify-center bg-mint/25 text-[10px] text-mint"
                      style={{ flexGrow: len, flexBasis: 0 }}
                    >
                      {len > duration * 0.08 ? `${len.toFixed(1)}s` : ""}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted">
                  playhead {fmt(playhead)}
                </span>
                <button
                  className="btn-ghost text-sm"
                  onClick={() => setMarkA(videoRef.current?.currentTime ?? playhead)}
                >
                  Mark in {markA !== null && `(${fmt(markA)})`}
                </button>
                <button
                  className="btn-ghost text-sm"
                  onClick={() => setMarkB(videoRef.current?.currentTime ?? playhead)}
                >
                  Mark out {markB !== null && `(${fmt(markB)})`}
                </button>
                <button
                  className="btn-mint text-sm disabled:opacity-40"
                  disabled={markA === null || markB === null || Math.abs((markA ?? 0) - (markB ?? 0)) < 0.05}
                  onClick={cutMarkedRange}
                >
                  Cut marked range
                </button>
                <button className="btn-ghost text-sm" onClick={resetTimeline}>
                  Restore full clip
                </button>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="card p-5">
              <h3 className="font-medium">Source</h3>
              <dl className="mt-3 space-y-1 font-mono text-xs text-muted">
                <div>{previewAsset.filename}</div>
                <div>
                  {previewAsset.width}×{previewAsset.height} @ {previewAsset.fps}fps
                </div>
                <div>{(previewAsset.durationSec ?? 0).toFixed(2)}s source</div>
                <div>{((previewAsset.bytes ?? 0) / 1e6).toFixed(1)} MB in object storage</div>
              </dl>
              <label className="btn-ghost mt-4 block cursor-pointer text-center text-sm">
                Replace footage
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
              </label>
            </div>

            <div className="card p-5">
              <h3 className="font-medium">Export</h3>
              <p className="mt-1 text-xs text-muted">
                Rendered by ffmpeg on the server at source resolution.
              </p>
              <button
                className="btn-mint mt-3 w-full disabled:opacity-40"
                disabled={Boolean(busy) || Boolean(activeJob) || duration < 0.05}
                onClick={startExport}
              >
                {activeJob ? `Rendering (${activeJob.status})…` : "Export MP4"}
              </button>
              {download && (
                <a className="btn-ghost mt-3 block text-center text-sm text-mint" href={download.url}>
                  Download MP4
                </a>
              )}
              {jobs.length > 0 && (
                <ul className="mt-4 space-y-1 font-mono text-[11px] text-muted">
                  {jobs.slice(0, 5).map((j) => (
                    <li key={j.id} className="flex justify-between gap-2">
                      <span>{j.id.slice(0, 8)}</span>
                      <span className={j.status === "error" ? "text-danger" : j.status === "done" ? "text-mint" : ""}>
                        {j.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {exportsList.length > 0 && (
              <div className="card p-5">
                <h3 className="font-medium">Renders</h3>
                <ul className="mt-3 space-y-2 text-xs">
                  {exportsList.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-muted">
                        {(a.durationSec ?? 0).toFixed(2)}s · {((a.bytes ?? 0) / 1e6).toFixed(1)}MB
                      </span>
                      <a className="text-mint" href={`/api/media/${a.id}?download=1`}>
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}

      {(busy || error) && (
        <div className="mt-6 text-sm">
          {busy && <p className="text-muted">{busy}</p>}
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
