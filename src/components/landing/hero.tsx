import Link from 'next/link';

/**
 * Hero: an eyebrow line, a two-line display headline (grotesque, then a serif
 * italic), body copy, a pill CTA with an accent arrow, and a row of fanned cards.
 *
 * The cards show real exports from this project's own renderer (see `planRender`
 * + `buildRenderArgs`), one of them with a punch-in applied, rather than stock
 * footage — so the hero demonstrates the product instead of illustrating it.
 */
export function Hero() {
  return (
    <section className="grain relative overflow-hidden">
      <div aria-hidden className="atmosphere pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="grid-dots pointer-events-none absolute inset-x-0 top-0 h-[30rem] opacity-50 [mask-image:radial-gradient(58%_60%_at_50%_0%,#000_0%,transparent_76%)]"
      />

      <div className="container-page relative pt-14 pb-2 text-center sm:pt-20">
        <p className="mx-auto inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-[12.5px] text-muted backdrop-blur">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[2px] bg-accent"
          />
          <span className="font-medium text-ink-soft">Measured, not vibes</span>
          <span className="text-line-strong" aria-hidden>
            —
          </span>
          <span>every cut traces to a number</span>
        </p>

        <h1 className="mx-auto mt-8 max-w-3xl text-[2.75rem] leading-[0.98] font-bold tracking-[-0.035em] text-ink sm:text-[3.9rem] lg:text-[4.6rem]">
          Edit to the reference&rsquo;s rhythm
          <span className="display-accent mt-1 block text-[3.1rem] font-normal tracking-[-0.01em] text-ink-soft sm:text-[4.4rem] lg:text-[5.2rem]">
            with a receipt for every cut
          </span>
        </h1>

        <p className="mx-auto mt-7 max-w-[34rem] text-[15.5px] leading-relaxed text-muted">
          Drop your footage, point Modaya at a reference, and ask for the edit. It measures the
          reference&rsquo;s cut rhythm, shot lengths and grade, then renders a real MP4 on the server.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
          <Link
            href="/signup"
            className="group inline-flex items-center gap-3 rounded-full bg-ink py-1.5 pr-1.5 pl-6 text-[15px] font-semibold text-canvas transition-colors hover:bg-ink-soft"
          >
            Get started
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-on transition-transform group-hover:translate-x-0.5"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 8h11M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
          <a
            href="#honesty"
            className="text-[15px] text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            See what it measures
          </a>
        </div>
      </div>

      <HeroCards />
    </section>
  );
}

type Card = {
  src: string;
  poster: string;
  alt: string;
  title: string;
  subtitle: string;
  /** Gradient panel behind the clip, so the fan reads as coloured cards. */
  panel: string;
  transform: string;
  z: string;
};

function HeroCards() {
  const cards: Card[] = [
    {
      src: '/media/hero-1.mp4',
      poster: '/media/hero-1.jpg',
      alt: 'Rendered clip: a woman at a cafe window',
      title: 'Measured',
      subtitle: 'cut rhythm, shot lengths',
      panel: 'from-[#2dd4b0] to-[#1c9c81]',
      transform: 'lg:-rotate-[9deg] lg:translate-y-10',
      z: 'lg:z-10',
    },
    {
      src: '/media/hero-2.mp4',
      poster: '/media/hero-2.jpg',
      alt: 'Rendered clip with a punch-in applied: a man on a street at golden hour',
      title: 'Punch-in',
      subtitle: 'framing that follows the beat',
      panel: 'from-[#7c6cf0] to-[#4b3fc4]',
      transform: 'lg:-translate-y-2 lg:scale-[1.08]',
      z: 'lg:z-30',
    },
    {
      src: '/media/hero-3.mp4',
      poster: '/media/hero-3.jpg',
      alt: 'Rendered clip: hands arranging packaged goods',
      title: 'Export',
      subtitle: 'a real MP4, server-rendered',
      panel: 'from-[#f0736c] to-[#c9403a]',
      transform: 'lg:rotate-[9deg] lg:translate-y-10',
      z: 'lg:z-20',
    },
  ];

  return (
    <div className="relative pb-0">
      <div className="container-page">
        <div className="flex items-end justify-center gap-3 sm:gap-5 lg:gap-6">
          {cards.map((card) => (
            <div
              key={card.src}
              className={`relative min-w-0 w-full max-w-[290px] flex-1 ${card.transform} ${card.z}`}
            >
              <div
                className={`overflow-hidden rounded-[26px] bg-gradient-to-b p-3 shadow-[var(--shadow-card-lift)] ring-1 ring-white/10 ${card.panel}`}
              >
                <div className="px-1 pb-3">
                  <p className="text-[15px] font-semibold text-black/85">{card.title}</p>
                  <p className="text-[12px] text-black/60">{card.subtitle}</p>
                </div>
                <div className="relative overflow-hidden rounded-[16px] bg-base-950 ring-1 ring-black/25">
                  <video
                    className="block aspect-[9/16] w-full object-cover"
                    src={card.src}
                    poster={card.poster}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    aria-label={card.alt}
                  />
                  <span
                    aria-hidden
                    className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-[var(--shadow-card)] backdrop-blur"
                  >
                    <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                      <path
                        d="M1 1.6v10.8a1 1 0 0 0 1.53.85l8.8-5.4a1 1 0 0 0 0-1.7l-8.8-5.4A1 1 0 0 0 1 1.6Z"
                        fill="#0A0A0C"
                      />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="container-page mt-14 text-center text-[12.5px] text-faint">
        These frames are exports from Modaya&rsquo;s own renderer, not a mockup — the middle card has
        a punch-in applied.
      </p>
    </div>
  );
}
