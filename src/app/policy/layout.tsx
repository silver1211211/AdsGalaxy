import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import PolicyMobileMenu from "@/components/policy/PolicyMobileMenu";
import PolicyNav from "@/components/policy/PolicyNav";

export default function PolicyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/policy" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="AdsGalaxy" width={36} height={36} className="h-9 w-9 shrink-0" priority />
            <span>
              <span className="block text-sm font-black uppercase tracking-tight text-slate-900">AdsGalaxy Policy</span>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Policy Center</span>
            </span>
          </Link>
          <PolicyMobileMenu />
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <PolicyNav />
          </div>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
