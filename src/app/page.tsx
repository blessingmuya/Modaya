import { getCurrentUser } from '@/lib/auth/session';
import { SiteHeader } from '@/components/landing/site-header';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Honesty } from '@/components/landing/honesty';
import { Pipeline } from '@/components/landing/pipeline';
import { SiteFooter } from '@/components/landing/site-footer';

export default async function LandingPage() {
  // The front page must render even when Postgres is unreachable: a visitor with
  // a stale session cookie is enough to trigger a lookup, and a database blip
  // should not take the marketing page down with it. Signed-out is the safe
  // default — it only changes which button the header shows.
  let signedIn = false;
  try {
    signedIn = Boolean(await getCurrentUser());
  } catch {
    signedIn = false;
  }

  return (
    <div className="min-h-screen">
      <SiteHeader signedIn={signedIn} />
      <main>
        <Hero />
        <HowItWorks />
        <Honesty />
        <Pipeline />
      </main>
      <SiteFooter />
    </div>
  );
}
