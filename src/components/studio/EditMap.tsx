"use client";

import { useState } from "react";
import type { Marker } from "@/lib/markers";

const KIND_COLOR: Record<Marker["kind"], string> = {
  Hook: "#f5c86b",
  Cut: "#6ee7c9",
  Zoom: "#8ab4ff",
  Caption: "#d59bff",
  Grade: "#ff9f7a",
};

/**
 * Edit Map: every marker corresponds to one applied operation. Clicking a
 * marker shows the grounded reason and the exact StyleProfile field behind it.
 */
export default function EditMap({
  markers,
  duration,
  onSeek,
}: {
  markers: Marker[];
  duration: number;
  onSeek?: (t: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const timed = markers.filter((m) => m.atSec !== null);
  const global = markers.filter((m) => m.atSec === null);
  const sel = selected !== null ? markers[selected] : null;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Edit Map</h3>
        <span className="text-xs text-muted">{markers.length} marker(s) — click for the reason</span>
      </div>

      <div className="relative mt-4 h-16 rounded-lg border border-line bg-surface-2">
        {timed.map((m, i) => {
          const idx = markers.indexOf(m);
          const left = duration > 0 ? Math.min(99.4, ((m.atSec as number) / duration) * 100) : 0;
          const width =
            m.endSec !== null && duration > 0
              ? Math.max(0.8, ((m.endSec - (m.atSec as number)) / duration) * 100)
              : 0.8;
          return (
            <button
              key={`${m.kind}-${i}`}
              onClick={() => {
                setSelected(idx);
                if (m.atSec !== null) onSeek?.(m.atSec);
              }}
              title={`${m.kind} @ ${(m.atSec as number).toFixed(2)}s`}
              className="absolute top-0 h-full rounded-sm border transition-opacity hover:opacity-100"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `${KIND_COLOR[m.kind]}33`,
                borderColor: KIND_COLOR[m.kind],
                opacity: selected === idx ? 1 : 0.75,
              }}
            >
              <span
                className="absolute -top-0.5 left-0 text-[9px] font-medium"
                style={{ color: KIND_COLOR[m.kind] }}
              >
                {m.kind[0]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {(Object.keys(KIND_COLOR) as Marker["kind"][]).map((k) => (
          <span key={k} className="flex items-center gap-1 text-muted">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: KIND_COLOR[k] }} />
            {k}
          </span>
        ))}
      </div>

      {global.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {global.map((m, i) => (
            <button
              key={i}
              onClick={() => setSelected(markers.indexOf(m))}
              className="rounded-full border px-2.5 py-0.5 text-[11px]"
              style={{ borderColor: KIND_COLOR[m.kind], color: KIND_COLOR[m.kind] }}
            >
              {m.kind}: applies to whole timeline
            </button>
          ))}
        </div>
      )}

      {sel && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium" style={{ color: KIND_COLOR[sel.kind] }}>
              {sel.kind} — {sel.label}
            </span>
            {sel.atSec !== null && (
              <span className="font-mono text-muted">
                {sel.atSec.toFixed(2)}s{sel.endSec !== null ? ` → ${sel.endSec.toFixed(2)}s` : ""}
              </span>
            )}
          </div>
          <p className="mt-2 text-muted">{sel.reason}</p>
          {sel.groundedIn && (
            <p className="mt-2 font-mono text-[11px] text-mint">
              grounded in: {sel.groundedIn}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
