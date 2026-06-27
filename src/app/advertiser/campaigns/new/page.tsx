"use client";

import { useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import Link from "next/link";
import { Tv, Smartphone, Bot, ArrowRight, HelpCircle } from "lucide-react";

const CAMPAIGN_KINDS = [
  {
    key: "channel",
    href: "/advertiser/campaigns/new/channel",
    title: "Channel Campaign",
    description: "Advertise in Telegram channels with view or click campaigns.",
    detail: "Create a channel placement and choose View Campaign or Click Campaign inside the existing setup flow.",
    icon: Tv,
    accent: "from-[#13aef5] to-[#0b86d6]",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
  },
  {
    key: "miniapp",
    href: "/advertiser/miniapp-rewarded",
    title: "Mini App Campaign",
    description: "Advertise inside Telegram Mini Apps with rewarded ads.",
    detail: "Use the Mini App rewarded campaign flow with admin review, CPM approval, and budget pacing.",
    icon: Smartphone,
    accent: "from-violet-500 to-purple-700",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
  },
  {
    key: "bot",
    href: "/advertiser/campaigns/new/bot",
    title: "Bot Campaign",
    description: "Advertise through Telegram bot broadcasts.",
    detail: "Create a bot broadcast campaign using the existing broadcast delivery flow.",
    icon: Bot,
    accent: "from-emerald-500 to-teal-700",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
  },
] as const;

export default function NewCampaignChooserPage() {
  const { setTitle } = useHeader();

  useEffect(() => {
    setTitle("Create Campaign");
  }, [setTitle]);

  return (
    <DashboardLayout type="advertiser">
      <div className="max-w-4xl mx-auto space-y-10 pb-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Create Campaign</h1>
            <p className="text-slate-500 text-sm">Choose the campaign type you want to create.</p>
          </div>
          <Link href="/docs/advertiser#overview" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:border-blue-200 hover:text-blue-600">
            <HelpCircle size={14} />
            Need help?
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {CAMPAIGN_KINDS.map((kind) => (
            <Link
              key={kind.key}
              href={kind.href}
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:border-transparent"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${kind.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

              <div className="relative z-10 flex flex-col flex-1 gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${kind.iconBg} ${kind.iconColor} group-hover:bg-white/15 group-hover:text-white transition-colors duration-300`}>
                  <kind.icon size={28} />
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight group-hover:text-white transition-colors duration-300">
                    {kind.title}
                  </h3>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide group-hover:text-white/80 transition-colors duration-300">
                    {kind.description}
                  </p>
                </div>

                <p className="text-sm text-slate-500 leading-relaxed flex-1 group-hover:text-white/90 transition-colors duration-300">
                  {kind.detail}
                </p>

                <div className="flex items-center gap-2 text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-white transition-colors duration-300">
                  Get started
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
