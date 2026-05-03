"use client";

import React, { useState, useEffect } from "react";
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
  Lock
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";

export default function AdvertiserDashboard() {
  const { setTitle } = useHeader();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<any>({
    active_ads: 0,
    total_campaigns: 0,
    total_views: 0,
    total_spent: 0,
    total_clicks: 0,
    ad_balance: 0,
    ad_balance_locked: 0,
    recent_campaigns: []
  });

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      const res = await apiFetch("/api/advertiser/stats");
      const data = await res.json();
      if (res.ok) {
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setTitle("Dashboard");
    fetchStats();
  }, [setTitle]);

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
  ];

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-8">
        {/* Header Section */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900">Advertiser Dashboard</h1>
          <p className="text-slate-500">Track and manage your Telegram advertising campaigns.</p>
        </div>

        {/* Balance Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {statCards.map((stat) => (
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
        </div>

        {/* Recent Campaigns Placeholder */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">Recent Campaigns</h3>
            <Link href="/advertiser/campaigns" className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="space-y-4">
            {stats.recent_campaigns.length === 0 ? (
              <p className="text-center py-10 text-slate-400 font-bold uppercase tracking-widest text-xs">No recent campaigns</p>
            ) : (
              stats.recent_campaigns.map((campaign: any) => (
                <div key={campaign.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border border-slate-50 bg-slate-50/50 gap-4">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white",
                      campaign.status === 'active' ? "bg-emerald-500" : "bg-slate-400"
                    )}>
                      <BarChart3 size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate uppercase">{campaign.name}</p>
                      <p className="text-xs text-slate-500">{campaign.type} • {campaign.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:text-right gap-4">
                    <div className={cn(
                      "px-3 py-1 text-[10px] font-black uppercase rounded-full",
                      campaign.status === 'active' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    )}>
                      {campaign.status}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">${campaign.budget}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-black">Total Budget</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>
      </div>
    </DashboardLayout>
  );
}
