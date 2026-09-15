import Link from 'next/link';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="mint-glow pointer-events-none absolute inset-x-0 -top-24 h-[520px]" />
      <div className="container-page relative pt-20 pb-16 sm:pt-28 sm:pb-24">
        <div className="max-w-3xl">
          <span className="chip chip-measured">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
            Server-rendered exports · no browser capture
          </span>
          <h1 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight text-ink sm:text-6xl">
            Edit video by describing
            <span className="text-mint-400"> the result</span>, not the timeline.
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-soft">
            Drop your footage, optionally point Modaya at a reference video, and ask for what you
            want. Modaya measures the reference — cut rhythm, shot lengths, loudness onsets, colour
            statistics — then renders a real MP4 on the server with ffmpeg.
          </p>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
            Style matching is scoped honestly: we report which numbers we measured from your
            reference, and which parts are a model&apos;s plain-English description. Nothing is
            labelled as measurement unless it is one.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="btn btn-primary">
              Start a project
            </Link>
            <a href="#honesty" className="btn btn-secondary">
              See what it measures
            </a>
          </div>
        </div>

        <TimelineIllustration />
      </div>
    </section>
  );
}

/**
 * Decorative illustration of the product's core object — an ordered clip list
 * plus the operations applied to it. Not a control surface: no inputs here.
 */
function TimelineIllustration() {
  const clips = [
    { w: '18%', label: '0.0–2.4s' },
    { w: '26%', label: '4.1–7.6s' },
    { w: '12%', label: '9.0–10.6s' },
    { w: '30%', label: '12.2–16.2s' },
  ];
  const cuts = ['2.4s', '7.6s', '10.6s', '16.2s'];

  return (
    <figure className="mt-16">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="mono text-xs text-muted">timeline · spec v1</span>
          <span className="mono text-xs text-mint-400">4 clips · 13.9s out</span>
        </div>
        <div className="grid gap-6 p-5 sm:p-6">
          <div className="flex h-14 w-full overflow-hidden rounded-lg bg-base-900 ring-1 ring-line">
            {clips.map((clip, i) => (
              <div
                key={clip.label}
                style={{ width: clip.w }}
                className={`flex items-center justify-center border-r border-base-950/80 text-[10.5px] ${
                  i % 2 === 0 ? 'bg-mint-400/22 text-mint-300' : 'bg-mint-400/12 text-mint-300/80'
                }`}
              >
                <span className="mono truncate px-1">{clip.label}</span>
              </div>
            ))}
          </div>
          <div className="relative h-6">
            {cuts.map((cut) => (
              <span
                key={cut}
                className="mono absolute top-0 -translate-x-1/2 text-[10.5px] text-faint"
                style={{ left: cut }}
              >
                {cut}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-faint">
        Illustration of a Modaya edit plan: ordered source ranges, measured cut points, one
        server-rendered export.
      </figcaption>
    </figure>
  );
}
