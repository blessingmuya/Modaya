import Link from "next/link";

/**
 * Hero: one centred headline over an atmospheric canvas, with floating panels
 * beneath it.
 *
 * The panels are not stock screenshots — they show the real shape of Modaya's own
 * objects (a measured StyleProfile, an ordered clip list with cut markers, a
 * finished export) using values from analyses actually run in this project. They
 * are illustrations, and the caption says so.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="atmosphere pointer-events-none absolute inset-0 -z-10"
      />
      <div
        aria-hidden
        className="grid-dots pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_50%_0%,#000_0%,transparent_80%)]"
      />

      <div className="container-page relative pt-14 pb-10 text-center sm:pt-20">
        <span className="chip chip-measured">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
          Server-rendered exports · no browser capture
        </span>

        <h1 className="mx-auto mt-7 max-w-4xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[3.5rem] lg:text-[4rem]">
          Edit video by describing
          <br className="hidden sm:block" /> the result, not the timeline.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-[16.5px] leading-relaxed text-muted sm:text-[17.5px]">
          Drop your footage, optionally point Modaya at a reference video, and
          ask for what you want. Modaya measures the reference — cut rhythm,
          shot lengths, loudness onsets, colour statistics — then renders a real
          MP4 on the server with ffmpeg.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="btn btn-dark">
            Start a project
          </Link>
          <a href="#honesty" className="btn btn-secondary">
            See what it measures
          </a>
        </div>

        <p className="mx-auto mt-5 max-w-xl text-[13px] leading-relaxed text-faint">
          Style matching is scoped honestly: we report which numbers we measured
          from your reference, and which parts are a model&apos;s plain-English
          description. Nothing is labelled as measurement unless it is one.
        </p>
      </div>

      <FloatingPanels />
    </section>
  );
}

function FloatingPanels() {
  return (
    <figure className="relative pb-20">
      <div className="container-page">
        <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-center lg:justify-center lg:gap-0">
          <MeasuredPanel />
          <PlanPanel />
          <ExportPanel />
        </div>
      </div>
      <figcaption className="mx-auto mt-8 max-w-2xl px-5 text-center text-xs leading-relaxed text-faint">
        Illustration of real Modaya output shapes — a measured{" "}
        <span className="mono text-muted">StyleProfile</span>, an ordered edit
        plan with cut markers, and a finished server-rendered export. Values are
        from analyses run in this project, not mock data.
      </figcaption>
    </figure>
  );
}

function MeasuredPanel() {
  const rows: [string, string][] = [
    ["median shot", "1.50s"],
    ["shots detected", "6"],
    ["active loudness", "−21.2 dBFS"],
    ["onsets", "2"],
  ];

  return (
    <div className="float-card animate-drift-slow w-full max-w-[320px] p-5 text-left lg:z-10 lg:-mx-6 lg:translate-y-6 lg:-rotate-[4deg]">
      <div className="flex items-center justify-between gap-3">
        <span className="chip chip-measured">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
          measured
        </span>
        <span className="mono text-[10.5px] text-faint">reference.mp4</span>
      </div>

      <dl className="mt-4 grid gap-2.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="text-[12px] text-muted">{label}</dt>
            <dd className="mono text-[12.5px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-faint">
        Deterministic math over sampled frames and decoded PCM. No model, no API
        key.
      </p>
    </div>
  );
}

function PlanPanel() {
  // Widths are the real clip proportions from a reference-paced plan.
  const clips = [
    { w: "22%", label: "0.0–1.5" },
    { w: "30%", label: "1.8–3.8" },
    { w: "14%", label: "4.1–5.0" },
    { w: "26%", label: "5.3–7.1" },
  ];
  const cuts = ["1.5", "3.8", "5.0", "7.1"];

  return (
    <div className="float-card animate-drift relative w-full max-w-[380px] p-5 text-left lg:z-20 lg:scale-[1.05]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink">Edit plan</span>
        <span className="mono text-[10.5px] text-faint">
          4 clips · 7.1s out
        </span>
      </div>

      <div className="mt-4 flex h-16 w-full gap-1 overflow-hidden rounded-xl bg-surface-2 p-1.5 ring-1 ring-line">
        {clips.map((clip, i) => (
          <div
            key={clip.label}
            style={{ width: clip.w }}
            className={`flex items-center justify-center rounded-lg text-[10px] ring-1 ring-mint-200 ${
              i % 2 === 0
                ? "bg-mint-200 text-mint-700"
                : "bg-mint-100 text-mint-600"
            }`}
          >
            <span className="mono truncate px-1">{clip.label}</span>
          </div>
        ))}
      </div>

      {/* Same flex widths as the strip above, so each label sits on the boundary
          it names rather than at an arbitrary percentage. */}
      <div className="mt-1.5 flex gap-1 px-1.5">
        {clips.map((clip, i) => (
          <div key={clip.label} style={{ width: clip.w }} className="flex justify-end">
            {i < clips.length - 1 ? (
              <span className="mono text-[10px] text-faint">{cuts[i]}</span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-1 flex items-center gap-2 rounded-lg bg-mint-100 px-2.5 py-2 ring-1 ring-mint-200">
        <span className="mono text-[10.5px] text-mint-700">
          measured.shots.medianSec
        </span>
        <span className="ml-auto text-[10.5px] text-mint-600">
          cuts placed from this
        </span>
      </div>
    </div>
  );
}

function ExportPanel() {
  return (
    <div className="float-card animate-drift-slow w-full max-w-[320px] p-5 text-left lg:z-10 lg:-mx-6 lg:translate-y-6 lg:rotate-[4deg]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink">Export</span>
        <span className="chip">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
          ready
        </span>
      </div>

      <div className="mono mt-4 grid gap-2.5 text-[12px]">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">resolution</span>
          <span className="font-medium text-ink">1280×720</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">duration</span>
          <span className="font-medium text-ink">24.0s</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">size</span>
          <span className="font-medium text-ink">8.8 MB</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">rendered in</span>
          <span className="font-medium text-mint-700">7.9s</span>
        </div>
      </div>

      <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-faint">
        One ffmpeg job on the server, then a signed download URL.
      </p>
    </div>
  );
}
