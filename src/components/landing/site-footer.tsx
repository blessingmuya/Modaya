import Link from "next/link";
import { Wordmark } from "@/components/brand";

export function SiteFooter() {
  return (
    <footer className="pb-14">
      <div className="container-page">
        {/* Closing CTA gets the one dark surface on the page, so the eye lands on it. */}
        <div className="relative overflow-hidden rounded-[24px] bg-base-950 px-8 py-11 text-center shadow-[var(--shadow-lift)] sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "radial-gradient(40% 70% at 20% 0%, rgba(45,212,176,0.22) 0%, rgba(17,18,20,0) 70%), radial-gradient(40% 70% at 85% 100%, rgba(255,255,255,0.06) 0%, rgba(17,18,20,0) 70%)",
            }}
          />
          <div className="relative">
            <h2 className="display mx-auto max-w-2xl text-[2rem] text-white sm:text-[2.6rem]">
              Bring a clip and a reference.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[14.5px] leading-relaxed text-white/60">
              Create an account, make a project, and render your first cut in a
              couple of minutes.
            </p>
            <Link href="/signup" className="btn btn-primary mt-7">
              Create your first project
            </Link>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 text-[13px] text-faint sm:flex-row">
          <div className="flex items-center gap-4">
            <Wordmark />
            <span className="hidden sm:inline">
              Real exports. Honest measurements.
            </span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/login" className="nav-link">
              Sign in
            </Link>
            <Link href="/signup" className="nav-link">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
