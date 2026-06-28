"use client";

import { useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import Link from "next/link";
import { Tv, Smartphone, Bot, ArrowRight, CheckCircle2, Megaphone } from "lucide-react";

const KINDS = [
  {
    key: "channel",
    href: "/advertiser/campaigns/new/channel",
    icon: Tv,
    title: "Channel Campaign",
    tagline: "Reach Telegram channel audiences",
    gradient: "from-[#0c9de8] to-blue-700",
    ringColor: "ring-blue-200",
    btnColor: "bg-[#0c9de8] hover:bg-blue-600",
    badgeBg: "bg-blue-50 text-blue-700",
    features: [
      "Post ads in active Telegram channels",
      "Choose View or Click campaign type",
      "Set daily budget and CPM",
      "Category & country targeting",
    ],
    badge: "Most Popular",
  },
  {
    key: "miniapp",
    href: "/advertiser/miniapp-rewarded",
    icon: Smartphone,
    title: "Mini App Campaign",
    tagline: "Rewarded ads inside Telegram Mini Apps",
    gradient: "from-violet-500 to-purple-700",
    ringColor: "ring-violet-200",
    btnColor: "bg-violet-600 hover:bg-violet-700",
    badgeBg: "bg-violet-50 text-violet-700",
    features: [
      "Rewarded ad placements in Mini Apps",
      "Users earn rewards for watching",
      "Admin review & CPM approval",
      "Budget pacing & impression control",
    ],
    badge: "High Engagement",
  },
  {
    key: "bot",
    href: "/advertiser/campaigns/new/bot",
    icon: Bot,
    title: "Bot Campaign",
    tagline: "Direct inbox delivery via Telegram bots",
    gradient: "from-emerald-500 to-teal-700",
    ringColor: "ring-emerald-200",
    btnColor: "bg-emerald-600 hover:bg-emerald-700",
    badgeBg: "bg-emerald-50 text-emerald-700",
    features: [
      "Broadcast to bot subscriber audiences",
      "Direct message delivery to inbox",
      "High open rates vs channel posts",
      "Flexible message format support",
    ],
    badge: "Direct Reach",
  },
] as const;

export default function NewCampaignChooserPage() {
  const { setTitle } = useHeader();
  useEffect(() => { setTitle("Create Campaign"); }, [setTitle]);

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-8 pb-12">

        {/* ── Hero ── */}
        <section className="rounded-3xl px-7 py-8 text-white shadow-xl" style={{background: "linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%)"}}>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
              <Megaphone size={22} />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Create a Campaign</h1>
              <p className="text-xs font-medium text-blue-100">Choose how you want to reach your audience on Telegram.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {["No minimum spend", "Real-time reporting", "Admin-verified inventory"].map(tag => (
              <span key={tag} className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white">
                <CheckCircle2 size={11} className="text-white" />
                {tag}
              </span>
            ))}
          </div>
        </section>

        {/* ── Campaign type cards ── */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {KINDS.map((kind) => (
            <div key={kind.key} className="group flex flex-col rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-200 overflow-hidden hover:-translate-y-1 hover:shadow-xl hover:border-slate-300">

              {/* Card gradient header */}
              <div className={`bg-gradient-to-br ${kind.gradient} px-6 pt-6 pb-5`}>
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-white/20 p-3">
                    <kind.icon size={26} className="text-white" />
                  </div>
                  <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                    {kind.badge}
                  </span>
                </div>
                <h2 className="text-lg font-black uppercase tracking-tight text-white">{kind.title}</h2>
                <p className="mt-1 text-xs font-medium text-white/70">{kind.tagline}</p>
              </div>

              {/* Card body */}
              <div className="flex flex-1 flex-col gap-5 p-5">
                <ul className="space-y-2.5">
                  {kind.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={kind.href}
                  className={`mt-auto flex items-center justify-center gap-2 rounded-xl ${kind.btnColor} px-4 py-3 text-sm font-black uppercase tracking-wide text-white transition-all active:scale-95`}
                >
                  Get Started
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* ── Help strip ── */}
        <div className="rounded-2xl border border-slate-100 bg-white px-5 py-4 flex items-center justify-between gap-4 shadow-sm">
          <div>
            <p className="text-sm font-black text-slate-800">Not sure which type to choose?</p>
            <p className="mt-0.5 text-xs text-slate-400">Channel campaigns are the most common starting point for new advertisers.</p>
          </div>
          <Link
            href="/advertiser/campaigns/new/channel"
            className="shrink-0 rounded-xl bg-[#0c9de8] px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0b86d6] transition-colors"
          >
            Start with Channel →
          </Link>
        </div>

      </div>
    </DashboardLayout>
  );
}
