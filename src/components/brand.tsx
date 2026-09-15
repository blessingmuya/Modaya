export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-[9px] bg-mint-400 shadow-[0_2px_8px_-2px_rgba(22,179,148,0.5)]"
    >
      <svg
        width={size * 0.66}
        height={size * 0.66}
        viewBox="0 0 20 20"
        fill="none"
      >
        <rect
          x="1.5"
          y="6.5"
          width="5.5"
          height="7.5"
          rx="1.6"
          fill="#05372C"
        />
        <rect
          x="8.2"
          y="4"
          width="4"
          height="12.5"
          rx="1.6"
          fill="#05372C"
          opacity="0.66"
        />
        <rect
          x="13.6"
          y="8.2"
          width="4.4"
          height="4.2"
          rx="1.6"
          fill="#05372C"
          opacity="0.42"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="flex items-center gap-2.5 no-underline">
      <LogoMark />
      <span className="display text-[23px] text-ink">Modaya</span>
    </a>
  );
}
