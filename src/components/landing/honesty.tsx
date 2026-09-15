const MEASURED = [
  ["Cut points", "Frame-difference peaks over sampled frames"],
  ["Shot lengths", "Deltas between detected cuts"],
  ["Loudness & onsets", "RMS envelope over decoded PCM"],
  ["Grade statistics", "Channel means, contrast, saturation"],
];

const DESCRIBED = [
  ["Shot types used", "A model looking at sampled frames, in words"],
  ["Transition style", "Described, not timed"],
  ["Caption position & style", "Described from frames"],
  ["Hook structure & pacing", "Plain English, no timestamps"],
];

export function Honesty() {
  return (
    <section id="honesty" className="border-t border-line/70 py-20">
      <div className="container-page">
        <span className="chip">The part most tools skip</span>
        <h2 className="display mt-5 max-w-3xl text-[2rem] text-ink sm:text-[2.6rem]">
          Two layers, labelled by where they came from
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          A <span className="mono text-accent-strong">StyleProfile</span> keeps
          measurement and description in separate fields. Timestamps only ever
          come from the measured layer — a language model is never asked for,
          and never trusted with, a number it cannot know.
        </p>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <span className="chip chip-measured">measured</span>
              <span className="text-xs text-faint">
                deterministic · free · offline
              </span>
            </div>
            <ul className="mt-6 grid gap-4">
              {MEASURED.map(([name, how]) => (
                <li
                  key={name}
                  className="flex flex-col gap-0.5 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <span className="text-[14.5px] font-medium text-ink">
                    {name}
                  </span>
                  <span className="text-[13px] text-muted">{how}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3">
              <span className="chip chip-described">model-described</span>
              <span className="text-xs text-faint">
                optional · needs an API key
              </span>
            </div>
            <ul className="mt-6 grid gap-4">
              {DESCRIBED.map(([name, how]) => (
                <li
                  key={name}
                  className="flex flex-col gap-0.5 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <span className="text-[14.5px] font-medium text-ink">
                    {name}
                  </span>
                  <span className="text-[13px] text-muted">{how}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 rounded-lg bg-base-900 p-3.5 text-[12.5px] leading-relaxed text-muted ring-1 ring-line">
              No key configured? Modaya says so in the UI and only reports the
              measured layer. It does not invent a description to fill the gap.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
