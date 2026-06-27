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
  Bot
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import AppBootState from "@/components/shared/AppBootState";

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
  last_displayed_at?: string | null;
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
  roi?: number;
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

function displayDateTime(value?: string | null) {
  if (!value) return "Not displayed";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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
  roi: 0,
  ad_balance: 0,
  ad_balance_locked: 0,
  advertiser_trust_level: "new",
  advertiser_trust_label: "New Advertiser",
  recent_campaigns: [],
};

export default function AdvertiserDashboard() {
  const { setTitle } = useHeader();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [stats, setStats] = useState<AdvertiserStats>(defaultStats);

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
      label: "Conversions",
      value: Number(stats.conversions || 0).toLocaleString(),
      icon: Zap,
      color: "text-purple-600",
      bg: "bg-purple-50"
    },
    {
      label: "Conversion Rate",
      value: `${(Number(stats.conversion_rate || 0) * 100).toFixed(2)}%`,
      icon: TrendingUp,
      color: "text-cyan-600",
      bg: "bg-cyan-50"
    },
    {
      label: "CPA",
      value: money(stats.cost_per_conversion || 0),
      icon: DollarSign,
      color: "text-rose-600",
      bg: "bg-rose-50"
    },
    {
      label: "ROI",
      value: `${(Number(stats.roi || 0) * 100).toFixed(1)}%`,
      icon: BarChart3,
      color: "text-emerald-600",
      bg: "bg-emerald-50"
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
                    <div className="border-t border-slate-100 pt-3 text-left md:min-w-36 md:border-t-0 md:pt-0 md:text-right">
                      <p className="text-xs font-bold text-slate-700">{displayDateTime(campaign.last_displayed_at)}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-black">Last displayed</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>}

        {/* Quick Actions */}
        {!loadError && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link 
            href="/advertiser/campaigns/new"
            className="group p-6 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl text-white shadow-lg shadow-blue-200 flex items-center justify-between transition-transform active:scale-[0.98]"
          >
            <div className="space-y-1">
              <h3 className="text-lg font-bold">Create Campaign</h3>
              <p className="text-blue-100 text-sm">Launch a new ad in minutes</p>
            </div>
            <PlusCircle size={32} className="text-white/40 group-hover:text-white transition-colors" />
          </Link>

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
    </DashboardLayout>
  );
}
