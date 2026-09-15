"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Megaphone, Smartphone, Sparkles, Tv, UserPlus } from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import { useTranslations } from "@/i18n/client";

const KINDS = [
  { key: "channel", href: "/advertiser/campaigns/new/channel", icon: Tv, model: "CPM / CPC" },
  { key: "growth", href: "/advertiser/campaigns/new/growth", icon: UserPlus, model: "CPS" },
  { key: "teaser", href: "/advertiser/campaigns/new/channel?type=teaser", icon: Sparkles, model: "CPM" },
  { key: "miniapp", href: "/advertiser/miniapp-rewarded", icon: Smartphone, model: "CPM" },
  { key: "bot", href: "/advertiser/campaigns/new/bot", icon: Bot, model: "CPM" },
] as const;

export default function NewCampaignChooserPage() {
  const { setTitle } = useHeader();
  const { t } = useTranslations();
  useEffect(() => { setTitle(t("advertiser.chooser.title")); }, [setTitle, t]);
  return (
    <DashboardLayout type="advertiser">
      <main className="mx-auto min-w-0 max-w-6xl space-y-5 overflow-hidden pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]"><Megaphone size={21} /></div>
          <div className="min-w-0"><h1 className="text-2xl font-black tracking-tight text-slate-950">{t("advertiser.chooser.title")}</h1><p className="mt-1 text-sm text-slate-500">{t("advertiser.chooser.description")}</p></div>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {KINDS.map((kind) => (
            <Link key={kind.key} href={kind.href} className="group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-500">
              <div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-blue-50 group-hover:text-blue-600"><kind.icon size={20} /></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{kind.model}</span></div>
              <h2 className="mt-5 break-words text-base font-black text-slate-950">{t(`advertiser.chooser.${kind.key}.title`)}</h2>
              <p className="mt-1 min-h-10 break-words text-sm leading-5 text-slate-500">{t(`advertiser.chooser.${kind.key}.description`)}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-blue-600">{t("advertiser.chooser.select")} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          ))}
        </div>
      </main>
    </DashboardLayout>
  );
}
