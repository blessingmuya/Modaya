import Link from "next/link";

/**
 * Hero: an editorial display headline over a soft streaked canvas, with three
 * vertical video cards beneath it.
 *
 * The clips are real exports produced by this project's own renderer (see
 * `planRender` + `buildRenderArgs`), one of them with a punch-in applied, so the
 * cards show what the product actually makes rather than stock footage.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="atmosphere pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_0%,#000_42%,transparent_88%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[38rem] [mask-image:radial-gradient(65%_60%_at_50%_25%,#000_0%,transparent_78%)]"
      >
        <div className="grid-dots h-full w-full opacity-40" />
      </div>

      <div className="container-page relative pt-12 pb-4 text-center sm:pt-16">
        <span className="chip">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
          Measured reference analysis · not a vibe
        </span>

        <h1 className="display mx-auto mt-8 max-w-4xl text-[2.6rem] text-ink sm:text-[3.6rem] lg:text-[4.4rem]">
          Cut to the reference&rsquo;s <em className="italic">rhythm</em>, with
          a <em className="italic">receipt</em> for every cut
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-[16.5px] leading-relaxed text-muted">
          Drop your footage, point Modaya at a reference, and ask for the edit.
          Modaya measures the reference&rsquo;s cut rhythm, shot lengths and
          grade, then renders a real MP4 on the server.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <Link href="/signup" className="btn btn-dark">
            Try it free
            <span aria-hidden>→</span>
          </Link>
          <a
            href="#honesty"
            className="text-[14.5px] text-ink-soft underline-offset-4 hover:underline"
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
  /** Tailwind classes for the tilt and vertical offset in the fan. */
  transform: string;
  chip?: { text: string; side: "left" | "right" };
};

/**
 * Three 9:16 clips fanned like the reference: the middle one raised and slightly
 * larger, the outer two rotated away from centre.
 */
function HeroCards() {
  const cards: Card[] = [
    {
      src: "/media/hero-1.mp4",
      poster: "/media/hero-1.jpg",
      alt: "Rendered clip: a woman at a cafe window",
      transform: "lg:-rotate-[6deg] lg:translate-y-6",
      chip: { text: "measured · 6 shots", side: "left" },
    },
    {
      src: "/media/hero-2.mp4",
      poster: "/media/hero-2.jpg",
      alt: "Rendered clip with a punch-in applied: a man on a street at golden hour",
      transform: "lg:-translate-y-4 lg:scale-[1.06]",
    },
    {
      src: "/media/hero-3.mp4",
      poster: "/media/hero-3.jpg",
      alt: "Rendered clip: hands arranging packaged goods",
      transform: "lg:rotate-[6deg] lg:translate-y-6",
      chip: { text: "export · 720×1280", side: "right" },
    },
  ];

  return (
    <div className="container-page relative pb-20">
      <div className="flex items-center justify-center gap-3 sm:gap-5 lg:gap-7">
        {cards.map((card) => (
          <div
            key={card.src}
            className={`relative min-w-0 w-full max-w-[272px] flex-1 ${card.transform}`}
          >
            {/* The card itself: a rounded, shadowed video surface. */}
            <div className="relative overflow-hidden rounded-[22px] bg-base-950 shadow-[var(--shadow-card-lift)] ring-1 ring-black/5">
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
                <svg
                  width="12"
                  height="14"
                  viewBox="0 0 12 14"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M1 1.6v10.8a1 1 0 0 0 1.53.85l8.8-5.4a1 1 0 0 0 0-1.7l-8.8-5.4A1 1 0 0 0 1 1.6Z"
                    fill="#14161A"
                  />
                </svg>
              </span>
            </div>

            {card.chip ? (
              <span
                className={`float-card absolute bottom-6 hidden items-center gap-1.5 px-3 py-2 text-[11px] whitespace-nowrap text-ink-soft lg:flex ${
                  card.chip.side === "left"
                    ? "-left-6 lg:-left-12"
                    : "-right-6 lg:-right-12"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-mint-500"
                  aria-hidden
                />
                <span className="mono">{card.chip.text}</span>
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="mt-14 text-center text-[12.5px] text-faint">
        These frames are exports from Modaya&rsquo;s own renderer, not a mockup
        — the middle one has a punch-in applied.
      </p>
    </div>
  );
}
