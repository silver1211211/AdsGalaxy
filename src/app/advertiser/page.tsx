"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  PlusCircle,
  Wallet,
  BarChart3,
  Eye,
  MousePointer2,
  Zap,
  ArrowRight,
  TrendingUp,
  DollarSign,
  Tv,
  Smartphone,
  Bot,
  X,
  Sparkles,
  Megaphone,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/i18n/client";
import { readDashboardSnapshot, writeDashboardSnapshot } from "@/lib/dashboardSnapshot";
import CampaignStatusBadge from "@/components/advertiser/CampaignStatusBadge";

const CREATE_OPTIONS = [
  {
    key: "channel",
    href: "/advertiser/campaigns/new/channel",
    icon: Tv,
    title: "Channel Campaign",
    tagline: "Post ads in active Telegram channels",
  },
  {
    key: "miniapp",
    href: "/advertiser/miniapp-rewarded",
    icon: Smartphone,
    title: "Mini App Campaign",
    tagline: "Rewarded ads inside Telegram Mini Apps",
  },
  {
    key: "bot",
    href: "/advertiser/campaigns/new/bot",
    icon: Bot,
    title: "Bot Campaign",
    tagline: "Direct inbox delivery via Telegram bots",
  },
];

type AdvertiserCampaign = {
  id: number;
  name: string;
  source?: "regular" | "miniapp";
  type?: string;
  campaign_kind?: string | null;
  status?: string;
  spend?: string | number;
};

type AdvertiserStats = {
  active_ads: number;
  total_campaigns: number;
  total_views: number;
  total_spent: number;
  total_clicks: number;
  tracked_clicks?: number;
  conversions?: number;
  conversion_rate?: number;
  cost_per_conversion?: number;
  conversion_value?: number;
  miniapp_impressions?: number;
  ad_balance: number;
  advertiser_trust_level?: string;
  advertiser_trust_label?: string;
  recent_campaigns: AdvertiserCampaign[];
};

const CAMPAIGN_TYPE_ICONS: Record<string, typeof Tv> = {
  views: Tv,
  clicks: Tv,
  broadcast: Bot,
  miniapp: Smartphone,
};

const LIVE_STATUSES = new Set(["active", "approved", "monetized"]);

function getCampaignTypeIcon(type?: string) {
  return CAMPAIGN_TYPE_ICONS[type || ""] || BarChart3;
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}


const defaultStats: AdvertiserStats = {
  active_ads: 0,
  total_campaigns: 0,
  total_views: 0,
  total_spent: 0,
  total_clicks: 0,
  tracked_clicks: 0,
  conversions: 0,
  conversion_rate: 0,
  cost_per_conversion: 0,
  conversion_value: 0,
  miniapp_impressions: 0,
  ad_balance: 0,
  advertiser_trust_level: "new",
  advertiser_trust_label: "New Advertiser",
  recent_campaigns: [],
};

export default function AdvertiserDashboard() {
  const { setTitle } = useHeader();
  const { t } = useTranslations();
  const router = useRouter();
  const initialSnapshot = React.useMemo(() => readDashboardSnapshot<AdvertiserStats>("advertiser"), []);
  const [isLoading, setIsLoading] = useState(!initialSnapshot);
  const [loadError, setLoadError] = useState(false);
  const [balance, setBalance] = useState<{ available: number } | null>(null);
  const [lowBalanceDismissed, setLowBalanceDismissed] = useState(false);
  const [balanceError, setBalanceError] = useState(false);
  const [stats, setStats] = useState<AdvertiserStats>(initialSnapshot || defaultStats);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      if (!initialSnapshot) setIsLoading(true);
      setLoadError(false);
      const res = await apiFetch("/api/advertiser/stats", { timeoutMs: 12000 });
      const data: Record<string, unknown> = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error || "Failed to load advertiser stats"));
      setStats(data as unknown as AdvertiserStats);
      writeDashboardSnapshot("advertiser", data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [initialSnapshot]);

  const fetchBalance = useCallback(async () => {
    setBalanceError(false);
    try {
      const res = await apiFetch("/api/me/status", { timeoutMs: 5000 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error || "Failed to load balance"));
      setBalance({
        available: Number(data.ad_balance || 0),
      });
    } catch {
      setBalanceError(true);
    }
  }, []);

  useEffect(() => {
    setTitle(t("common.dashboard"));
    const timer = window.setTimeout(() => {
      void fetchBalance();
      void fetchStats();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchBalance, fetchStats, setTitle, t]);

  const statCards = [
    { 
      label: t("advertiser.dashboard.totalCampaigns"),
      value: stats.total_campaigns, 
      icon: Zap, 
      color: "text-blue-600", 
      bg: "bg-blue-50" 
    },
    { 
      label: t("advertiser.dashboard.totalViews"),
      value: stats.total_views.toLocaleString(), 
      icon: Eye, 
      color: "text-emerald-600", 
      bg: "bg-emerald-50" 
    },
    { 
      label: t("advertiser.dashboard.totalSpent"),
      value: `$${stats.total_spent.toLocaleString()}`, 
      icon: TrendingUp, 
      color: "text-amber-600", 
      bg: "bg-amber-50" 
    },
    { 
      label: t("advertiser.dashboard.totalClicks"),
      value: stats.total_clicks.toLocaleString(), 
      icon: MousePointer2, 
      color: "text-indigo-600", 
      bg: "bg-indigo-50" 
    },
    {
      label: t("common.impressions"),
      value: Number(stats.miniapp_impressions || 0).toLocaleString(),
      icon: Smartphone,
      color: "text-emerald-600",
      bg: "bg-emerald-50"
    },
    {
      label: t("common.conversions"),
      value: Number(stats.conversions || 0).toLocaleString(),
      icon: Zap,
      color: "text-purple-600",
      bg: "bg-purple-50"
    },
    {
      label: "CPA",
      value: money(stats.cost_per_conversion || 0),
      icon: DollarSign,
      color: "text-rose-600",
      bg: "bg-rose-50"
    },
    {
      label: t("advertiser.dashboard.conversionRate"),
      value: `${(Number(stats.conversion_rate || 0) * 100).toFixed(2)}%`,
      icon: TrendingUp,
      color: "text-cyan-600",
      bg: "bg-cyan-50"
    },
  ];

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-8">
        {/* Premium Header Section */}
        <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-blue-950/10">
          <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#0c9de8]/40 blur-3xl" />
          <div className="absolute -bottom-20 left-8 h-40 w-40 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-blue-100">
              <Sparkles size={12} />
              {t("advertiser.dashboard.commandCenter")}
            </div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-tight">{t("advertiser.dashboard.hero")}</h1>
                <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-white/65">
                  {t("advertiser.dashboard.heroDescription")}
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-xs font-black uppercase tracking-wide text-[#0c9de8] shadow-lg shadow-white/10"
              >
                <Megaphone size={15} />
                {t("advertiser.campaigns.create")}
              </button>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <span>Analytics are temporarily unavailable. Your account remains usable.</span>
            <button className="font-black text-blue-600" onClick={fetchStats}>{t("common.retry")}</button>
          </div>
        )}

        {balance && balance.available < 2 && !lowBalanceDismissed && (
          <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold">{t("advertiser.dashboard.lowBalanceTitle")}</p>
              <p className="text-xs text-amber-800">{t("advertiser.dashboard.lowBalanceDescription")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/advertiser/deposit" className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white">{t("advertiser.dashboard.deposit")}</Link>
              <button type="button" aria-label={t("common.close")} onClick={() => setLowBalanceDismissed(true)} className="rounded-lg p-2 text-amber-800 hover:bg-amber-100"><X size={16} /></button>
            </div>
          </div>
        )}

        {/* Balance Section */}
        {!loadError && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center justify-between rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t("advertiser.dashboard.adBalance")}</p>
              {balance ? <p className="text-3xl font-black text-slate-900">${balance.available.toFixed(2)}</p> : <div className="h-9 w-32 animate-pulse rounded-lg bg-slate-100" />}
              {balanceError && <button onClick={fetchBalance} className="text-xs font-bold text-blue-600">{t("common.retry")}</button>}
              <div className="flex items-center gap-1.5 pt-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-xs font-medium text-slate-400">{t("advertiser.dashboard.availableForSpend")}</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
              <Wallet size={32} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Trust Level</p>
              <p className="text-2xl font-black text-slate-900">{stats.advertiser_trust_label || "New Advertiser"}</p>
              <div className="flex items-center gap-1.5 pt-1">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-xs font-medium text-slate-400">Advertiser account standing</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
              <Zap size={32} />
            </div>
          </div>
        </div>}

        {/* Stats Grid */}
        {!loadError && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {isLoading ? [1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
            <div key={item} className="h-32 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm animate-pulse" />
          )) : statCards.map((stat) => (
            <div key={stat.label} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl md:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2 md:p-3 rounded-xl ${stat.bg}`}>
                  <stat.icon className={stat.color} size={20} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] md:text-sm font-medium text-slate-500 truncate">{stat.label}</p>
                <p className="text-sm md:text-2xl font-bold text-slate-900">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>}

        {/* Recent Campaign */}
        {!loadError && <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">{t("advertiser.dashboard.recentCampaigns")}</h3>
            <Link href="/advertiser/campaigns" className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-1">
              {t("common.campaigns")} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="space-y-4">
            {isLoading ? (
              [1].map((item) => (
                <div key={item} className="h-16 rounded-xl bg-slate-50 animate-pulse" />
              ))
            ) : stats.recent_campaigns.length === 0 ? (
              <p className="text-center py-10 text-slate-400 font-bold uppercase tracking-widest text-xs">{t("advertiser.campaigns.empty")}</p>
            ) : (
              stats.recent_campaigns.slice(0, 1).map((campaign) => {
                const TypeIcon = getCampaignTypeIcon(campaign.type);
                const isLive = LIVE_STATUSES.has(campaign.status || "");
                const campaignDescription = campaign.campaign_kind === "channel_growth"
                  ? `${t("growth.title")} · ${t("common.subscribers")}`
                  : campaign.type === "broadcast"
                    ? t("advertiser.campaigns.botCampaign")
                    : campaign.type === "miniapp"
                      ? `${t("advertiser.dashboard.miniAppCampaign")} · ${t("advertiser.dashboard.rewardedViews")}`
                      : `${t("advertiser.campaigns.channelCampaign")} · ${campaign.type === "clicks" ? t("advertiser.statistics.clicks") : t("advertiser.statistics.views")}`;
                const statisticsSource = campaign.source || (campaign.type === "miniapp" ? "miniapp" : "regular");
                return (
                  <div key={`${statisticsSource}-${campaign.id}`} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white",
                        isLive ? "bg-emerald-500" : "bg-slate-400"
                      )}>
                        <TypeIcon size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate uppercase">{campaign.name}</p>
                        <p className="text-xs text-slate-500">{campaignDescription}</p>
                      </div>
                      <CampaignStatusBadge status={campaign.status} />
                    </div>
                    <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t("advertiser.dashboard.spent")}</p>
                        <p className="text-base font-black text-slate-900">{money(campaign.spend)}</p>
                      </div>
                      <Link
                        href={`/advertiser/campaigns?statistics=${encodeURIComponent(`${statisticsSource}:${campaign.id}`)}`}
                        onClick={() => window.sessionStorage.setItem("adsgalaxy:campaign-statistics-target", `${statisticsSource}:${campaign.id}`)}
                        className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
                      >
                        {t("common.statistics")} <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>}

        {/* Quick Actions */}
        {!loadError && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            onClick={() => setShowCreateModal(true)}
            className="group p-6 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl text-white shadow-lg shadow-blue-200 flex items-center justify-between transition-transform active:scale-[0.98] text-left"
          >
            <div className="space-y-1">
              <h3 className="text-lg font-bold">{t("advertiser.campaigns.create")}</h3>
              <p className="text-blue-100 text-sm">Launch a new ad in minutes</p>
            </div>
            <PlusCircle size={32} className="text-white/40 group-hover:text-white transition-colors" />
          </button>

          <Link 
            href="/advertiser/deposit"
            className="group p-6 bg-white border-2 border-slate-100 rounded-2xl text-slate-900 flex items-center justify-between transition-all hover:border-blue-200 active:scale-[0.98]"
          >
            <div className="space-y-1">
              <h3 className="text-lg font-bold">{t("advertiser.dashboard.depositFunds")}</h3>
              <p className="text-slate-500 text-sm">Add balance to run ads</p>
            </div>
            <Wallet size={32} className="text-slate-200 group-hover:text-blue-600 transition-colors" />
          </Link>
        </div>}
      </div>

      {/* ── Create Campaign Modal ── */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[600] flex items-end justify-center sm:items-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-200 rounded-full sm:hidden" />
              <div className="flex items-center justify-between px-6 pt-7 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-black uppercase tracking-tight text-slate-900">{t("advertiser.campaigns.create")}</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">{t("advertiser.dashboard.chooseFormat")}</p>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
                {CREATE_OPTIONS.map((opt) => {
                  const isChannel = opt.key === "channel";
                  return (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setShowCreateModal(false);
                        if (isChannel) { setShowTypeModal(true); }
                        else { router.push(opt.href); }
                      }}
                      className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                    >
                      <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                        <opt.icon size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{opt.title}</p>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">{opt.tagline}</p>
                      </div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
              <div className="px-4 pb-6">
                <p className="text-center text-[11px] text-slate-400 font-medium">Channel campaigns are the most common starting point</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Views vs Clicks Picker (Channel only) ── */}
      <AnimatePresence>
        {showTypeModal && (
          <div className="fixed inset-0 z-[600] flex items-end justify-center sm:items-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowTypeModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-200 rounded-full sm:hidden" />
              <div className="flex items-center justify-between px-6 pt-7 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-black uppercase tracking-tight text-slate-900">Campaign Objective</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">How do you want to pay for your ad?</p>
                </div>
                <button
                  onClick={() => setShowTypeModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-2">
                <button
                  onClick={() => { setShowTypeModal(false); router.push("/advertiser/campaigns/new/channel?type=views"); }}
                  className="w-full flex items-center gap-4 px-4 py-5 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                    <Eye size={22} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{t("advertiser.dashboard.viewsCampaign")}</p>
                    <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{t("advertiser.chooser.views.description")}</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                </button>
                <button
                  onClick={() => { setShowTypeModal(false); router.push("/advertiser/campaigns/new/channel?type=clicks"); }}
                  className="w-full flex items-center gap-4 px-4 py-5 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                    <MousePointer2 size={22} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{t("advertiser.dashboard.clickCampaign")}</p>
                    <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{t("advertiser.chooser.clicks.description")}</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                </button>
                <button
                  onClick={() => { setShowTypeModal(false); router.push("/advertiser/campaigns/new/growth"); }}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors"><PlusCircle size={22} /></div>
                  <div className="flex-1"><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{t("advertiser.chooser.growth.title")}</p><p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{t("advertiser.chooser.growth.description")}</p></div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                </button>
                <button
                  onClick={() => { setShowTypeModal(false); router.push("/advertiser/campaigns/new/channel?type=teaser"); }}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors"><Sparkles size={22} /></div>
                  <div className="flex-1"><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{t("advertiser.chooser.teaser.title")}</p><p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{t("advertiser.chooser.teaser.description")}</p></div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                </button>
              </div>
              <div className="px-4 pb-6 pt-1">
                <p className="text-center text-[11px] text-slate-400 font-medium">Views = broad reach · Clicks = direct conversions</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </DashboardLayout>
  );
}
