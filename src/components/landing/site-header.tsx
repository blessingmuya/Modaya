import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { NavLinks } from '@/components/landing/nav-links';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#honesty', label: 'What it measures' },
  { href: '#pipeline', label: 'Pipeline' },
];

/**
 * Floating pill navigation: wordmark left, section links in a centred frosted
 * pill, one solid CTA right. Every link resolves to a real anchor or route, and
 * the pill's highlight is a scroll-spy over the sections that exist.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 pt-4">
      <div className="container-page">
        <div className="flex items-center justify-between gap-4">
          <Wordmark />

          <NavLinks links={LINKS} />

          <div className="flex items-center gap-4">
            {signedIn ? (
              <Link href="/dashboard" className="btn btn-solid btn-sm">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden text-[13.5px] text-ink-soft hover:text-ink sm:block">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-solid btn-sm">
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
