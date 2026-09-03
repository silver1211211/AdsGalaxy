"use client";

import Link from "next/link";
import { ArrowRight, Megaphone, Sparkles } from "lucide-react";

export default function PromoteAdsGalaxyBanner({ status }: { status?: string | null }) {
  if (!status) return null;
  const active = status === "active";
  const ended = ["closed", "payout_review", "paid", "cancelled"].includes(String(status));
  return (
    <section className="relative overflow-hidden rounded-3xl border border-cyan-200/70 bg-gradient-to-r from-cyan-50 via-white to-blue-50 p-4 shadow-sm sm:p-5">
      <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#0c9de8]/15 blur-2xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0c9de8] text-white shadow-lg shadow-cyan-200"><Megaphone size={21} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black text-slate-950">Promote AdsGalaxy</h2>
              <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-700">
                {active ? "Live" : ended ? "Ends" : "Coming soon"}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">Earn up to <strong className="text-slate-950">$50</strong> when new users you refer add eligible Telegram channels.</p>
          </div>
        </div>
        <Link href="/publisher/promote" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-wide text-white shadow-lg shadow-slate-300 active:scale-95">
          <Sparkles size={14} /> {active ? "Start Promoting" : ended ? "View Results" : "Learn More"} <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
