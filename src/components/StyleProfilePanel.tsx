"use client";

import { useState } from "react";
import type { StyleProfile } from "@/lib/styleProfile";

function Tag({ kind }: { kind: "measured" | "model_described" }) {
  return kind === "measured" ? (
    <span
      title="Computed deterministically from the video's pixels and audio. No model involved."
      className="rounded border border-mint-dim/50 bg-mint/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-mint"
    >
      measured
    </span>
  ) : (
    <span
      title="A multimodal model's description of technique. Never a source of timestamps or numbers."
      className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warn"
    >
      described
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono">{value}</span>
    </div>
  );
}

export default function StyleProfilePanel({ profile }: { profile: StyleProfile }) {
  const [showCuts, setShowCuts] = useState(false);
  const m = profile.measured;
  const d = profile.modelDescribed;

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Measured</h3>
          <Tag kind="measured" />
        </div>
        <p className="mt-1 text-xs text-muted">
          Frame differencing, audio RMS and pixel statistics. Every timestamp Modaya uses comes
          from here.
        </p>

        <div className="mt-4 divide-y divide-line">
          <Row label="Duration" value={`${m.durationSec.toFixed(2)}s`} />
          <Row label="Format" value={`${m.width}×${m.height} · ${m.aspect} · ${m.fps}fps`} />
          <Row label="Cuts detected" value={`${m.cutCount} (${m.cutsPerMinute.toFixed(1)}/min)`} />
          <Row
            label="Shot length"
            value={`median ${m.shotLengthMedian.toFixed(2)}s · p10 ${m.shotLengthP10.toFixed(2)}s · p90 ${m.shotLengthP90.toFixed(2)}s`}
          />
          <Row
            label="Audio"
            value={
              m.audio.hasAudio
                ? `${m.audio.rmsMeanDb ?? "—"} dB mean · ${m.audio.onsetTimes.length} onsets · ${m.audio.silentRanges.length} silences`
                : "no audio track"
            }
          />
          <Row
            label="Grade"
            value={`bright ${m.grade.brightness.toFixed(3)} · contrast ${m.grade.contrast.toFixed(3)} · sat ${m.grade.saturation.toFixed(3)} · temp ${m.grade.temperature > 0 ? "+" : ""}${m.grade.temperature.toFixed(3)}`}
          />
        </div>

        {m.cutTimes.length > 0 && (
          <>
            <button
              className="mt-3 text-xs text-mint"
              onClick={() => setShowCuts((s) => !s)}
            >
              {showCuts ? "Hide" : "Show"} {m.cutTimes.length} cut timestamps
            </button>
            {showCuts && (
              <div className="mt-2 max-h-32 overflow-y-auto rounded border border-line bg-surface-2 p-2 font-mono text-[11px] text-muted">
                {m.cutTimes.map((t) => t.toFixed(2)).join("s · ")}s
              </div>
            )}
          </>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Model-described</h3>
          <Tag kind="model_described" />
        </div>
        <p className="mt-1 text-xs text-muted">
          A multimodal model&apos;s read of technique from 8 sampled frames. It is an opinion, not
          a measurement, and it never supplies timestamps.
        </p>

        {profile.modelStatus === "no_key" && (
          <p className="mt-4 rounded border border-line bg-surface-2 p-3 text-xs text-muted">
            No vision key configured, so this layer is empty. Everything above still works — the
            measured layer is fully offline and drives the edit plan on its own.
          </p>
        )}
        {profile.modelStatus === "error" && (
          <p className="mt-4 rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            Vision layer unavailable: {profile.modelError}. The measured layer is unaffected.
          </p>
        )}

        {d && (
          <div className="mt-4 space-y-3 text-xs">
            {d.shotTypes.length > 0 && (
              <div>
                <div className="text-muted">Shot types</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {d.shotTypes.map((s) => (
                    <span key={s} className="rounded-full border border-line px-2 py-0.5">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {d.transitionStyle && (
              <div>
                <div className="text-muted">Transitions</div>
                <p className="mt-0.5">{d.transitionStyle}</p>
              </div>
            )}
            {d.pacingDescription && (
              <div>
                <div className="text-muted">Pacing</div>
                <p className="mt-0.5">{d.pacingDescription}</p>
              </div>
            )}
            {d.hookStructure && (
              <div>
                <div className="text-muted">Hook structure</div>
                <p className="mt-0.5">{d.hookStructure}</p>
              </div>
            )}
            {d.captionStyle?.present && (
              <div>
                <div className="text-muted">Captions</div>
                <p className="mt-0.5">
                  {d.captionStyle.position} — {d.captionStyle.description}
                </p>
              </div>
            )}
            <div className="text-muted">Model confidence: {d.confidence}</div>
          </div>
        )}
      </section>
    </div>
  );
}
