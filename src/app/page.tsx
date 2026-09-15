import Link from "next/link";
import { Card, Logo, Pill, SectionTitle } from "@/components/ui";
import { getSessionUserId } from "@/lib/auth";

export default async function Landing() {
  const signedIn = Boolean(await getSessionUserId());

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-base/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="flex items-center gap-3 text-sm">
            <a href="#how" className="hidden text-muted hover:text-ink sm:block">
              How it works
            </a>
            <a href="#honesty" className="hidden text-muted hover:text-ink sm:block">
              What it actually does
            </a>
            {signedIn ? (
              <Link href="/dashboard" className="btn-mint text-sm">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-ghost text-sm">
                  Log in
                </Link>
                <Link href="/signup" className="btn-mint text-sm">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="glow">
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center">
          <Pill>Server-rendered exports. No browser screen-capture.</Pill>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
            Edit like the video you{" "}
            <span className="text-mint">actually want to copy</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
            Drop your raw footage and a reference clip. Modaya measures the reference&apos;s cut
            rhythm, shot lengths and grade, describes its technique, and renders a real MP4 with
            ffmpeg on the server.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href={signedIn ? "/dashboard" : "/signup"} className="btn-mint">
              {signedIn ? "Open dashboard" : "Start a project"}
            </Link>
            <a href="#how" className="btn-ghost">
              See the pipeline
            </a>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle
          kicker="Pipeline"
          title="Four real steps, no black box"
          sub="Every stage produces an artifact you can inspect: a probe, a profile, an operation list, a file."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: "01",
              t: "Upload",
              d: "Footage goes straight to object storage via a signed URL, then ffprobe records duration, resolution and fps.",
            },
            {
              n: "02",
              t: "Profile the reference",
              d: "Deterministic math finds cuts, shot lengths and audio onsets. A vision model adds a described technique layer — clearly labelled as described, not measured.",
            },
            {
              n: "03",
              t: "Plan the edit",
              d: "The model only ever emits a validated operation list — trim, remove_ranges, grade, captions. It never touches the timeline directly.",
            },
            {
              n: "04",
              t: "Render",
              d: "A server-side ffmpeg worker consumes the timeline deterministically and hands back a downloadable MP4 at source resolution.",
            },
          ].map((s) => (
            <Card key={s.n}>
              <div className="font-mono text-xs text-mint">{s.n}</div>
              <div className="mt-2 font-medium">{s.t}</div>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="honesty" className="mx-auto max-w-6xl px-6 pb-24">
        <SectionTitle
          kicker="Honest scope"
          title="What “style matching” means here"
          sub="Modaya does not understand your reference the way an editor does. Here is the exact split."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <Pill>Measured</Pill>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>• Cut points and shot-length distribution from frame differencing</li>
              <li>• Audio RMS and onset timing</li>
              <li>• Colour grade estimate: exposure, contrast, saturation, temperature</li>
              <li>• Every timestamp in the output comes from this layer only</li>
            </ul>
          </Card>
          <Card>
            <Pill tone="warn">Model-described</Pill>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>• Shot types and transition style, in words</li>
              <li>• Caption position and styling</li>
              <li>• A plain-English read of pacing and hook structure</li>
              <li>• Never a source of timestamps, and always labelled in the UI</li>
            </ul>
          </Card>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-muted">
          <Logo size="sm" />
          <span>Real DB. Real object storage. Real ffmpeg.</span>
        </div>
      </footer>
    </main>
  );
}
