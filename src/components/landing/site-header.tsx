import Link from 'next/link';
import { Wordmark } from '@/components/brand';

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-base-950/80 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Wordmark />
        <nav className="hidden items-center gap-8 text-[13.5px] text-muted md:flex">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#honesty" className="hover:text-ink">
            What it measures
          </a>
          <a href="#pipeline" className="hover:text-ink">
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
              <Link href="/login" className="btn btn-ghost btn-sm">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
