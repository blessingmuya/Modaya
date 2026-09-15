export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-[8px] bg-mint-400/12 ring-1 ring-mint-400/40"
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 20 20" fill="none">
        <rect x="2" y="6.5" width="5.5" height="7" rx="1.5" fill="#6EE7C9" />
        <rect x="8.7" y="4" width="4" height="12" rx="1.5" fill="#6EE7C9" opacity="0.65" />
        <rect x="14" y="8" width="4" height="4" rx="1.5" fill="#6EE7C9" opacity="0.4" />
      </svg>
    </span>
  );
}

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <a href={href} className="flex items-center gap-2.5 no-underline">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-ink">Modaya</span>
    </a>
  );
}
