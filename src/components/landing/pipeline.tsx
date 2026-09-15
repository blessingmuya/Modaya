const PIPELINE = [
  {
    label: "Browser",
    body: "Uploads straight to object storage with a signed URL; plays back the finished MP4.",
    tone: "muted" as const,
  },
  {
    label: "Postgres",
    body: "Accounts, projects, media records, timeline specs, jobs, style profiles.",
    tone: "mint" as const,
  },
  {
    label: "Job queue",
    body: "A jobs table claimed with SELECT … FOR UPDATE SKIP LOCKED by a worker process.",
    tone: "mint" as const,
  },
  {
    label: "ffmpeg worker",
    body: "Deterministic renders. The same operation list always produces the same output file.",
    tone: "mint" as const,
  },
  {
    label: "Object storage",
    body: "Sources and exports live in S3-compatible storage (R2 in production).",
    tone: "mint" as const,
  },
];

export function Pipeline() {
  return (
    <section id="pipeline" className="border-t border-line/70 py-20">
      <div className="container-page">
        <h2 className="display text-[2rem] text-ink sm:text-[2.6rem]">
          No browser-only render path
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] text-muted">
          Exports are computed on the server and stored as objects. The browser
          is a client, not a renderer.
        </p>
        <ol className="mt-10 grid gap-3">
          {PIPELINE.map((node, i) => (
            <li
              key={node.label}
              className="card flex flex-col gap-1.5 p-5 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <span className="mono flex w-8 shrink-0 text-xs text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`w-40 shrink-0 text-[14.5px] font-medium ${
                  node.tone === "mint" ? "text-accent-strong" : "text-ink-soft"
                }`}
              >
                {node.label}
              </span>
              <span className="text-[14px] leading-relaxed text-muted">
                {node.body}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
