import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

/**
 * Floating frosted header for the signed-in surfaces, matching the landing page.
 * One component instead of a header hand-rolled per page, so the app shell cannot
 * drift from the marketing surface.
 *
 * `children` are the right-hand controls — the caller supplies them, because the
 * dashboard shows account controls and the studio shows a way back to the list.
 */
export function AppHeader({
  crumb,
  children,
}: {
  crumb?: string;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-4 z-40">
      <div className="container-page">
        <div className="nav-shell justify-between gap-4 py-2 pr-2 pl-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Wordmark href="/dashboard" />
            {crumb ? (
              <>
                <span className="text-line-strong" aria-hidden>
                  /
                </span>
                <span className="truncate text-[13.5px] text-muted">
                  {crumb}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
      </div>
    </header>
  );
}
