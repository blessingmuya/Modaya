import Link from "next/link";
import type { ReactNode } from "react";

export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span
        className="inline-block rounded-md bg-mint"
        style={{ width: size === "sm" ? 14 : 18, height: size === "sm" ? 14 : 18 }}
      />
      <span className={size === "sm" ? "text-base font-semibold" : "text-lg font-semibold"}>
        Modaya
      </span>
    </Link>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function Pill({ children, tone = "mint" }: { children: ReactNode; tone?: "mint" | "muted" | "warn" }) {
  const tones = {
    mint: "border-mint-dim/50 text-mint bg-mint/10",
    muted: "border-line text-muted",
    warn: "border-warn/40 text-warn bg-warn/10",
  } as const;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
  );
}

export function SectionTitle({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mb-8">
      {kicker && <div className="mb-2 text-xs uppercase tracking-[0.2em] text-mint">{kicker}</div>}
      <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
      {sub && <p className="mt-2 max-w-2xl text-muted">{sub}</p>}
    </div>
  );
}
