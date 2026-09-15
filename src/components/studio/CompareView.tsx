"use client";

import { useRef, useState } from "react";

/**
 * Reference-vs-Result compare with genuinely synced playback: one transport
 * drives both elements, and a drift correction keeps them locked.
 */
export default function CompareView({
  referenceSrc,
  resultSrc,
}: {
  referenceSrc: string | null;
  resultSrc: string;
}) {
  const refVid = useRef<HTMLVideoElement>(null);
  const outVid = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [synced, setSynced] = useState(true);

  const both = (fn: (v: HTMLVideoElement) => void) => {
    for (const r of [refVid.current, outVid.current]) if (r) fn(r);
  };

  async function toggle() {
    if (playing) {
      both((v) => v.pause());
      setPlaying(false);
    } else {
      if (synced) both((v) => (v.currentTime = 0));
      await Promise.all(
        [refVid.current, outVid.current].filter(Boolean).map((v) => v!.play().catch(() => {})),
      );
      setPlaying(true);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Reference vs Result</h3>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={synced}
            onChange={(e) => setSynced(e.target.checked)}
            className="accent-[#6ee7c9]"
          />
          Synced playback
        </label>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs text-muted">Reference</div>
          {referenceSrc ? (
            <video
              ref={refVid}
              src={referenceSrc}
              className="w-full rounded-lg bg-black"
              muted
              playsInline
              onTimeUpdate={(e) => {
                if (!synced || !outVid.current) return;
                const drift = Math.abs(outVid.current.currentTime - e.currentTarget.currentTime);
                if (drift > 0.25) outVid.current.currentTime = e.currentTarget.currentTime;
              }}
              onEnded={() => setPlaying(false)}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg border border-line bg-surface-2 text-xs text-muted">
              No reference attached
            </div>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-xs text-mint">Your result</div>
          <video
            ref={outVid}
            src={resultSrc}
            className="w-full rounded-lg bg-black"
            playsInline
            controls={!synced}
            onEnded={() => setPlaying(false)}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button className="btn-mint text-sm" onClick={toggle}>
          {playing ? "Pause both" : "Play both"}
        </button>
        <button
          className="btn-ghost text-sm"
          onClick={() => {
            both((v) => {
              v.pause();
              v.currentTime = 0;
            });
            setPlaying(false);
          }}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
