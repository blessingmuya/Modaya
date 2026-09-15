'use client';

import { useEffect, useState } from 'react';

/**
 * Section links in the floating pill nav, with a scroll-spy so the highlighted
 * link reflects which section is actually on screen.
 *
 * The highlight is measured from the document, not hard-coded: if a section were
 * removed the pill would simply stop highlighting it.
 */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const sections = links
      .map((link) => document.getElementById(link.href.replace('#', '')))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const pick = () => {
      // The section whose top is closest to (but not far past) the viewport top.
      const line = window.innerHeight * 0.3;
      let current = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
      }
      setActiveId(current);
    };

    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => {
      window.removeEventListener('scroll', pick);
      window.removeEventListener('resize', pick);
    };
  }, [links]);

  return (
    <nav className="nav-shell hidden px-1.5 py-1.5 md:flex" aria-label="Sections">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={`nav-link ${activeId === link.href.replace('#', '') ? 'nav-link-active' : ''}`}
          aria-current={activeId === link.href.replace('#', '') ? 'true' : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
