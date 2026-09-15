import { getCurrentUser } from '@/lib/auth/session';
import { SiteHeader } from '@/components/landing/site-header';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Honesty } from '@/components/landing/honesty';
import { Pipeline } from '@/components/landing/pipeline';
import { SiteFooter } from '@/components/landing/site-footer';

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen">
      <SiteHeader signedIn={Boolean(user)} />
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
