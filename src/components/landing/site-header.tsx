import Link from "next/link";
import { Wordmark } from "@/components/brand";

/**
 * Flat editorial header: wordmark, inline section links, one solid CTA.
 *
 * Every link here resolves to a real anchor or route — nothing is decorative.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 bg-canvas/85 backdrop-blur-md">
      <div className="container-page">
        <div className="flex h-[76px] items-center justify-between gap-6">
          <Wordmark />

          <nav
            className="hidden items-center gap-9 md:flex"
            aria-label="Sections"
          >
            <a
              href="#how"
              className="text-[14.5px] text-ink-soft hover:text-ink"
            >
              How it works
            </a>
            <a
              href="#honesty"
              className="text-[14.5px] text-ink-soft hover:text-ink"
            >
              What it measures
            </a>
            <a
              href="#pipeline"
              className="text-[14.5px] text-ink-soft hover:text-ink"
            >
              Pipeline
            </a>
          </nav>

          <div className="flex items-center gap-5">
            {signedIn ? (
              <Link href="/dashboard" className="btn btn-dark btn-sm">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden text-[14.5px] text-ink-soft hover:text-ink sm:block"
                >
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-dark btn-sm">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
