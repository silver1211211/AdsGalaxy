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
  Lock,
  Tv,
  Smartphone,
  Bot,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import AppBootState from "@/components/shared/AppBootState";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";

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
  type?: string;
  category?: string;
  status?: string;
  budget?: string | number;
  impressions?: string | number;
  today_impressions?: string | number;
  yesterday_impressions?: string | number;
  spend?: string | number;
  today_spend?: string | number;
  conversions?: string | number;
  conversion_value?: string | number;
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
  ad_balance_locked: number;
  advertiser_trust_level?: string;
  advertiser_trust_label?: string;
  recent_campaigns: AdvertiserCampaign[];
};

const CAMPAIGN_TYPE_META: Record<string, { label: string; icon: typeof Tv }> = {
  views: { label: "Channel Campaign - Views", icon: Tv },
  clicks: { label: "Channel Campaign - Clicks", icon: Tv },
  broadcast: { label: "Bot Campaign", icon: Bot },
  miniapp: { label: "Mini App Campaign", icon: Smartphone },
};

const LIVE_STATUSES = new Set(["active", "approved", "monetized"]);

function getCampaignTypeMeta(type?: string) {
  return CAMPAIGN_TYPE_META[type || ""] || { label: type || "Campaign", icon: BarChart3 };
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
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
  ad_balance_locked: 0,
  advertiser_trust_level: "new",
  advertiser_trust_label: "New Advertiser",
  recent_campaigns: [],
};

export default function AdvertiserDashboard() {
  const { setTitle } = useHeader();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [stats, setStats] = useState<AdvertiserStats>(defaultStats);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(false);
      const res = await apiFetch("/api/advertiser/stats");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load advertiser stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setTitle("Dashboard");
    const timer = window.setTimeout(() => {
      fetchStats();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats, setTitle]);

  const statCards = [
    { 
      label: "Total Campaigns", 
      value: stats.total_campaigns, 
      icon: Zap, 
      color: "text-blue-600", 
      bg: "bg-blue-50" 
    },
    { 
      label: "Total Views", 
      value: stats.total_views.toLocaleString(), 
      icon: Eye, 
      color: "text-emerald-600", 
      bg: "bg-emerald-50" 
    },
    { 
      label: "Total Spent", 
      value: `$${stats.total_spent.toLocaleString()}`, 
      icon: TrendingUp, 
      color: "text-amber-600", 
      bg: "bg-amber-50" 
    },
    { 
      label: "Total Clicks", 
      value: stats.total_clicks.toLocaleString(), 
      icon: MousePointer2, 
      color: "text-indigo-600", 
      bg: "bg-indigo-50" 
    },
    {
      label: "Impressions",
      value: Number(stats.miniapp_impressions || 0).toLocaleString(),
      icon: Smartphone,
      color: "text-emerald-600",
      bg: "bg-emerald-50"
    },
    {
      label: "Conversions",
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
      label: "Conversion Rate",
      value: `${(Number(stats.conversion_rate || 0) * 100).toFixed(2)}%`,
      icon: TrendingUp,
      color: "text-cyan-600",
      bg: "bg-cyan-50"
    },
  ];

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-8">
        {/* Header Section */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900">Advertiser Dashboard</h1>
          <p className="text-slate-500">Track and manage your Telegram advertising campaigns.</p>
        </div>

        {loadError && (
          <div className="-mx-4 sm:mx-0">
            <AppBootState
              mode="error"
              title="Unable to load AdsGalaxy"
              message="We couldn't start the Mini App. Please reload and try again."
              detail="If this continues, contact support."
              actionLabel="Retry"
              onAction={fetchStats}
            />
          </div>
        )}

        {/* Balance Section */}
        {!loadError && <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Ad Balance</p>
              <p className="text-3xl font-black text-slate-900">${stats.ad_balance.toFixed(2)}</p>
              <div className="flex items-center gap-1.5 pt-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-xs font-medium text-slate-400">Available for ads</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
              <Wallet size={32} />
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Locked Balance</p>
              <p className="text-3xl font-black text-slate-900">${stats.ad_balance_locked.toFixed(2)}</p>
              <div className="flex items-center gap-1.5 pt-1">
                <div className="w-2 h-2 bg-amber-500 rounded-full" />
                <span className="text-xs font-medium text-slate-400">In active campaigns</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
              <Lock size={32} />
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
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
            <div key={stat.label} className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
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

        {/* Recent Campaigns Placeholder */}
        {!loadError && <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">Recent Campaigns</h3>
            <Link href="/advertiser/campaigns" className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="space-y-4">
            {isLoading ? (
              [1, 2, 3].map((item) => (
                <div key={item} className="h-16 rounded-xl bg-slate-50 animate-pulse" />
              ))
            ) : stats.recent_campaigns.length === 0 ? (
              <p className="text-center py-10 text-slate-400 font-bold uppercase tracking-widest text-xs">No recent campaigns</p>
            ) : (
              stats.recent_campaigns.map((campaign) => {
                const typeMeta = getCampaignTypeMeta(campaign.type);
                const isLive = LIVE_STATUSES.has(campaign.status || "");
                return (
                  <div key={`${campaign.type}-${campaign.id}`} className="flex flex-col gap-4 rounded-xl border border-slate-50 bg-slate-50/50 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white",
                        isLive ? "bg-emerald-500" : "bg-slate-400"
                      )}>
                        <typeMeta.icon size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate uppercase">{campaign.name}</p>
                        <p className="text-xs text-slate-500">{typeMeta.label}{campaign.category ? ` - ${campaign.category}` : ""}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-3 lg:grid-cols-7 md:text-right">
                      <div className={cn(
                        "inline-flex h-7 items-center justify-center rounded-full px-3 text-[10px] font-black uppercase",
                        isLive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      )}>
                        {campaign.status}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{numberValue(campaign.impressions)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">Impressions</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{numberValue(campaign.today_impressions)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">Today</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{numberValue(campaign.yesterday_impressions)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">Yesterday</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{money(campaign.spend)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">Spend</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{money(campaign.today_spend)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">Today Spend</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{numberValue(campaign.conversions)}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">Conversions</p>
                      </div>
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
              <h3 className="text-lg font-bold">Create Campaign</h3>
              <p className="text-blue-100 text-sm">Launch a new ad in minutes</p>
            </div>
            <PlusCircle size={32} className="text-white/40 group-hover:text-white transition-colors" />
          </button>

          <Link 
            href="/advertiser/deposit"
            className="group p-6 bg-white border-2 border-slate-100 rounded-2xl text-slate-900 flex items-center justify-between transition-all hover:border-blue-200 active:scale-[0.98]"
          >
            <div className="space-y-1">
              <h3 className="text-lg font-bold">Deposit Funds</h3>
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
                  <h2 className="text-base font-black uppercase tracking-tight text-slate-900">Create Campaign</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Choose how you want to advertise</p>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-2">
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
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Views Campaign</p>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Pay per 1,000 channel post views</p>
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
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Click Campaign</p>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Pay per button or link click</p>
                  </div>
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
