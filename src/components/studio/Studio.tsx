"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Timeline } from "@/lib/timeline";
import type { StyleProfile } from "@/lib/styleProfile";
import type { Marker } from "@/lib/markers";
import StyleProfilePanel from "@/components/StyleProfilePanel";
import EditMap from "./EditMap";
import CompareView from "./CompareView";
import type { AssetLite, JobLite, OpResult, Stage, StudioProps } from "./types";

const STAGES: { key: Stage; label: string }[] = [
  { key: "footage", label: "Footage" },
  { key: "reference", label: "Reference" },
  { key: "plan", label: "Edit plan" },
  { key: "render", label: "Render" },
  { key: "compare", label: "Compare" },
  { key: "iterate", label: "Iterate" },
];

const dur = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

export default function Studio({
  projectId,
  projectName,
  initialAssets,
  initialTimeline,
  initialJobs,
  initialProfile,
  initialPlan,
}: StudioProps) {
  const [assets, setAssets] = useState<AssetLite[]>(initialAssets);
  const [timeline, setTimeline] = useState<Timeline>(initialTimeline);
  const [jobs, setJobs] = useState<JobLite[]>(initialJobs);
  const [profile, setProfile] = useState<StyleProfile | null>(initialProfile);
  const [results, setResults] = useState<OpResult[]>(initialPlan?.results ?? []);
  const [markers, setMarkers] = useState<Marker[]>(initialPlan?.markers ?? []);
  const [download, setDownload] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatLog, setChatLog] = useState<{ role: "user" | "modaya"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const resultRef = useRef<HTMLVideoElement>(null);

  const source = assets.find((a) => a.role === "source") ?? null;
  const reference = assets.find((a) => a.role === "reference") ?? null;
  const latestExport = assets.find((a) => a.role === "export") ?? null;
  const duration = useMemo(
    () => timeline.clips.reduce((s, c) => s + Math.max(0, c.end - c.start), 0),
    [timeline],
  );
  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "running") ?? null;

  const stage: Stage = !source
    ? "footage"
    : !profile
      ? "reference"
      : results.length === 0
        ? "plan"
        : !latestExport
          ? "render"
          : "compare";

  const refreshAssets = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/assets`);
    if (r.ok) setAssets((await r.json()).assets);
  }, [projectId]);

  useEffect(() => {
    if (!activeJob) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/jobs/${activeJob.id}`);
      if (!r.ok) return;
      const d = await r.json();
      setJobs((p) => p.map((j) => (j.id === d.job.id ? { ...j, status: d.job.status, error: d.job.error } : j)));
      if (d.job.status === "done") {
        setDownload(d.downloadUrl);
        await refreshAssets();
      }
      if (d.job.status === "error") setError(d.job.error || "Render failed.");
    }, 1500);
    return () => clearInterval(t);
  }, [activeJob, refreshAssets]);

  async function guard<T>(label: string, fn: () => Promise<T>) {
    setError(null);
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function uploadFootage(file: File) {
    await guard("Uploading footage and probing it…", async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("role", "source");
      const r = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Upload failed");
      const tr = await fetch(`/api/projects/${projectId}/timeline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (tr.ok) setTimeline((await tr.json()).timeline);
      await refreshAssets();
    });
  }

  async function uploadReference(file: File) {
    await guard("Measuring the reference (cuts, audio, grade)…", async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await fetch(`/api/projects/${projectId}/reference`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Reference analysis failed");
      setProfile(d.profile);
      await refreshAssets();
    });
  }

  async function buildPlan() {
    await guard("Building the edit plan from the measured profile…", async () => {
      const r = await fetch(`/api/projects/${projectId}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Planning failed");
      setResults(d.results);
      setMarkers(d.markers ?? []);
      setTimeline(d.timeline);
    });
  }

  async function render() {
    await guard("Queuing the server-side render…", async () => {
      setDownload(null);
      const r = await fetch(`/api/projects/${projectId}/export`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Export failed");
      const jr = await fetch(`/api/projects/${projectId}/export`);
      if (jr.ok) setJobs((await jr.json()).jobs);
      const status = await (await fetch(`/api/jobs/${d.job.id}`)).json();
      if (status.job.status === "done") {
        setDownload(status.downloadUrl);
        await refreshAssets();
      }
    });
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    setChatInput("");
    setChatLog((l) => [...l, { role: "user", text: message }]);
    await guard("Planning your change…", async () => {
      const r = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, apply: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Chat failed");
      setChatLog((l) => [...l, { role: "modaya", text: d.reply }]);
      setTimeline(d.timeline);
      if (d.results?.length) setResults((p) => [...p, ...d.results]);
    });
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Stage rail */}
      <ol className="mb-8 flex flex-wrap gap-2 text-xs">
        {STAGES.map((s, i) => {
          const done = i < stageIndex;
          const now = i === stageIndex;
          return (
            <li
              key={s.key}
              className={`rounded-full border px-3 py-1 ${
                now
                  ? "border-mint bg-mint/10 text-mint"
                  : done
                    ? "border-mint-dim/40 text-mint-dim"
                    : "border-line text-muted"
              }`}
            >
              {done ? "✓ " : `${i + 1}. `}
              {s.label}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Stage 1: footage */}
          {!source ? (
            <label className="card flex cursor-pointer flex-col items-center gap-3 p-16 text-center hover:border-mint-dim">
              <span className="text-lg font-medium">Drop your footage</span>
              <span className="max-w-md text-sm text-muted">
                It uploads to object storage, gets probed with ffprobe, and everything after this
                runs against the real file on the server.
              </span>
              <span className="btn-mint mt-2">Choose a video</span>
              <input type="file" accept="video/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadFootage(e.target.files[0])} />
            </label>
          ) : (
            <div className="card overflow-hidden">
              <video
                ref={resultRef}
                src={`/api/media/${latestExport?.id ?? source.id}`}
                controls
                className="w-full bg-black"
              />
              <div className="flex items-center justify-between px-5 py-3 text-xs text-muted">
                <span>{latestExport ? "Rendered result" : "Source footage"}</span>
                <span className="font-mono">
                  {source.width}×{source.height} · timeline {dur(duration)} · {timeline.clips.length} clip(s)
                </span>
              </div>
            </div>
          )}

          {/* Stage 2: reference */}
          {source && !profile && (
            <label className="card flex cursor-pointer flex-col items-center gap-3 p-12 text-center hover:border-mint-dim">
              <span className="font-medium">Attach a reference video</span>
              <span className="max-w-md text-sm text-muted">
                Modaya measures its cuts, shot lengths, audio onsets and grade. That measurement —
                not a guess — places every cut in your edit.
              </span>
              <span className="btn-mint mt-2">Choose a reference</span>
              <input type="file" accept="video/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadReference(e.target.files[0])} />
            </label>
          )}

          {/* Stage 3: plan */}
          {profile && results.length === 0 && (
            <div className="card p-6 text-center">
              <p className="font-medium">Reference measured</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                {profile.measured.cutCount} cuts · median shot {profile.measured.shotLengthMedian.toFixed(2)}s ·{" "}
                {profile.measured.cutsPerMinute.toFixed(1)} cuts/min. Build the plan to map that
                rhythm and grade onto your footage.
              </p>
              <button className="btn-mint mt-4" onClick={buildPlan} disabled={Boolean(busy)}>
                Build edit plan
              </button>
            </div>
          )}

          {/* Stage 4+: plan results, render, compare, iterate */}
          {results.length > 0 && (
            <>
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Edit plan</h3>
                  <span className="text-xs text-muted">
                    {results.filter((r) => r.applied).length} applied · {results.filter((r) => !r.applied).length} skipped
                  </span>
                </div>
                <ul className="mt-3 space-y-2 text-xs">
                  {results.map((r, i) => (
                    <li key={i} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-mint">{r.op.op}</span>
                        <span className={r.applied ? "text-mint" : "text-muted"}>
                          {r.applied ? "applied" : "skipped"}
                        </span>
                      </div>
                      <p className="mt-1 text-muted">{r.op.reason ?? r.note}</p>
                      {r.groundedIn && (
                        <p className="mt-1 font-mono text-[11px] text-mint-dim">↳ {r.groundedIn}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  className="btn-mint mt-4 w-full disabled:opacity-40"
                  onClick={render}
                  disabled={Boolean(busy) || Boolean(activeJob) || duration < 0.05}
                >
                  {activeJob ? `Rendering (${activeJob.status})…` : "Render this plan"}
                </button>
                {download && (
                  <a className="btn-ghost mt-2 block text-center text-sm text-mint" href={download}>
                    Download MP4
                  </a>
                )}
              </div>

              {latestExport && (
                <CompareView
                  referenceSrc={reference ? `/api/media/${reference.id}` : null}
                  resultSrc={`/api/media/${latestExport.id}`}
                />
              )}

              {markers.length > 0 && (
                <EditMap
                  markers={markers}
                  duration={duration}
                  onSeek={(t) => {
                    if (resultRef.current) resultRef.current.currentTime = t;
                  }}
                />
              )}

              {/* Iterate: chat, which is itself a real op producer */}
              <div className="card p-5">
                <h3 className="font-medium">Iterate</h3>
                <p className="mt-1 text-xs text-muted">
                  Every message becomes validated operations against this timeline — nothing here
                  edits the timeline directly.
                </p>
                {chatLog.length > 0 && (
                  <ul className="mt-3 space-y-2 text-xs">
                    {chatLog.map((m, i) => (
                      <li key={i} className={m.role === "user" ? "text-ink" : "text-mint"}>
                        <span className="text-muted">{m.role === "user" ? "you" : "modaya"}: </span>
                        {m.text}
                      </li>
                    ))}
                  </ul>
                )}
                <form onSubmit={sendChat} className="mt-3 flex gap-2">
                  <input
                    className="input-dark"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="cut the silences · make it warmer · trim to the first 10 seconds"
                  />
                  <button className="btn-mint text-sm" disabled={Boolean(busy) || !chatInput.trim()}>
                    Send
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        {/* Right rail — only real, wired controls */}
        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="font-medium">{projectName}</h3>
            <dl className="mt-3 space-y-1 font-mono text-[11px] text-muted">
              <div>footage: {source ? source.filename : "none"}</div>
              <div>reference: {reference ? reference.filename : "none"}</div>
              <div>timeline: {dur(duration)} · {timeline.clips.length} clip(s)</div>
              <div>captions: {(timeline.captions ?? []).length}</div>
              <div>renders: {assets.filter((a) => a.role === "export").length}</div>
            </dl>
            {source && (
              <label className="btn-ghost mt-4 block cursor-pointer text-center text-sm">
                Replace footage
                <input type="file" accept="video/*" className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadFootage(e.target.files[0])} />
              </label>
            )}
            {source && profile && (
              <label className="btn-ghost mt-2 block cursor-pointer text-center text-sm">
                Swap reference
                <input type="file" accept="video/*" className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadReference(e.target.files[0])} />
              </label>
            )}
          </div>

          {profile && <StyleProfilePanel profile={profile} />}

          {assets.some((a) => a.role === "export") && (
            <div className="card p-5">
              <h3 className="font-medium">Renders</h3>
              <ul className="mt-3 space-y-2 text-xs">
                {assets.filter((a) => a.role === "export").map((a) => (
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

      {(busy || error) && (
        <div className="mt-6 text-sm">
          {busy && <p className="text-muted">{busy}</p>}
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
