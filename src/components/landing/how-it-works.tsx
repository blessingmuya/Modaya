const STEPS = [
  {
    n: "01",
    title: "Upload footage",
    body: "Your video goes straight to S3-compatible object storage with a signed URL. The server never proxies the bytes.",
    detail: "Real object storage · not IndexedDB",
  },
  {
    n: "02",
    title: "Measure the reference",
    body: "Modaya decodes the reference server-side and computes cut points, shot lengths, loudness onsets and grade statistics. Optionally, a vision model adds a written description of technique.",
    detail: "Deterministic math first · model layer optional",
  },
  {
    n: "03",
    title: "Render and download",
    body: "Your request becomes a validated operation list, which becomes a single ffmpeg job, which becomes a real MP4 at source resolution.",
    detail: "ffmpeg on the server · faster than real time",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-line/70 py-20">
      <div className="container-page">
        <h2 className="display text-[2rem] text-ink sm:text-[2.6rem]">
          Three steps, none of them a mockup
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] text-muted">
          Every stage below is wired to the same pipeline the app actually runs.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="card p-6">
              <span className="mono text-xs text-mint-600">{step.n}</span>
              <h3 className="mt-4 text-lg font-medium text-ink">
                {step.title}
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-soft">
                {step.body}
              </p>
              <p className="mt-5 border-t border-line pt-4 text-xs text-faint">
                {step.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
