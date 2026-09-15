import Link from 'next/link';
import { Wordmark } from '@/components/brand';

export function SiteFooter() {
  return (
    <footer className="border-t border-line/70">
      <div className="container-page py-16">
        <div className="card flex flex-col items-start justify-between gap-6 p-8 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-ink">Bring a clip and a reference.</h2>
            <p className="mt-2 max-w-md text-[14.5px] text-muted">
              Create an account, make a project, and render your first cut in a couple of minutes.
            </p>
          </div>
          <Link href="/signup" className="btn btn-primary">
            Create your first project
          </Link>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 text-[13px] text-faint sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <Wordmark />
            <span className="hidden sm:inline">Real exports. Honest measurements.</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-ink-soft">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-ink-soft">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
