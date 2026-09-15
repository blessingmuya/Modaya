import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

/**
 * Header for the signed-in surfaces. Same flat editorial treatment as the landing
 * page, in one component so the app shell cannot drift from the marketing page.
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
    <header className="sticky top-0 z-40 bg-canvas/85 backdrop-blur-md">
      <div className="container-page">
        <div className="flex h-[72px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Wordmark href="/dashboard" />
            {crumb ? (
              <>
                <span className="text-line-strong" aria-hidden>
                  /
                </span>
                <span className="truncate text-[14px] text-muted">{crumb}</span>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">{children}</div>
        </div>
      </div>
    </header>
  );
}
