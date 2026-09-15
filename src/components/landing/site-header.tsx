import Link from "next/link";
import { Wordmark } from "@/components/brand";

/**
 * Floating frosted pill navigation, as in the reference direction: wordmark on
 * the left, links in a centred pill, a single CTA on the right.
 *
 * Every link here resolves to a real anchor or route — nothing is decorative.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-4 z-40">
      <div className="container-page">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 pl-1">
            <Wordmark />
          </div>

          <nav
            className="nav-shell hidden px-2 py-1.5 md:flex"
            aria-label="Sections"
          >
            <a href="#how" className="nav-link">
              How it works
            </a>
            <a href="#honesty" className="nav-link">
              What it measures
            </a>
            <a href="#pipeline" className="nav-link">
              Pipeline
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            {signedIn ? (
              <Link href="/dashboard" className="btn btn-primary btn-sm">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="nav-link hidden sm:inline-block">
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
