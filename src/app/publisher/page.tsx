"use client";

import React from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { 
  Lock, 
  Wallet, 
  Tv, 
  History,
  ArrowRight
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

import { useHeader } from "@/context/HeaderContext";

export default function PublisherDashboard() {
  const { setTitle } = useHeader();
  const [stats, setStats] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    setTitle("Dashboard");
    const fetchStats = async () => {
      // Retry logic to wait for Telegram WebApp to be ready
      let retries = 0;
      const maxRetries = 10;
      
      const getInitData = () => (window as any).Telegram?.WebApp?.initData;

      while (!getInitData() && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 200));
        retries++;
      }

      const initData = getInitData();
      if (!initData) {
        console.warn("No Telegram initData found after retries. Ensure you are in Telegram.");
        setIsLoading(false);
        return;
      }

      try {
        const res = await apiFetch("/api/publisher/stats");
        const data = await res.json();
        if (res.ok) {
          setStats(data);
        } else {
          console.error("API Error:", data.error);
        }
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  const statCards = stats ? [
    { 
      label: "Locked Balance", 
      value: `$${parseFloat(stats.balance_locked || 0).toFixed(2)}`, 
      icon: Lock, 
      color: "text-amber-600", 
      bg: "bg-amber-50" 
    },
    { 
      label: "Available Balance", 
      value: `$${parseFloat(stats.balance_available || 0).toFixed(2)}`, 
      icon: Wallet, 
      color: "text-emerald-600", 
      bg: "bg-emerald-50" 
    },
    { 
      label: "Total Channels", 
      value: (stats.total_channels ?? 0).toString(), 
      icon: Tv, 
      color: "text-blue-600", 
      bg: "bg-blue-50" 
    },
    { 
      label: "Lifetime Withdrawn", 
      value: `$${parseFloat(stats.total_withdrawn || 0).toFixed(2)}`, 
      icon: History, 
      color: "text-indigo-600", 
      bg: "bg-indigo-50" 
    },
  ] : [];

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-8">
        {/* Header Section */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900">Publisher Dashboard</h1>
          <p className="text-slate-500">Welcome back! Here's an overview of your channel performance.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {isLoading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm animate-pulse h-32" />
            ))
          ) : (
            statCards.map((stat) => (
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
            ))
          )}
        </div>

        {/* Quick Actions / Recent Activity Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-900">Recent Channels</h3>
                <Link href="/publisher/channels" className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-1">
                  View all <ArrowRight size={14} />
                </Link>
              </div>
              <div className="space-y-4">
                {isLoading ? (
                  [1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-slate-50 animate-pulse rounded-xl" />
                  ))
                ) : !stats?.recent_channels || stats.recent_channels.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-slate-400 text-sm">No channels added yet.</p>
                  </div>
                ) : (
                  stats.recent_channels.map((channel: any) => (
                    <div key={channel.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-50 bg-slate-50/50">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                          <Tv size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{channel.title}</p>
                          <p className="text-xs text-slate-500">@{channel.username} • {channel.status}</p>
                        </div>
                      </div>
                      <Link href="/publisher/channels" className="p-2 hover:bg-white rounded-lg transition-colors text-slate-400">
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-br from-[#0c9de8] to-blue-700 p-6 rounded-[32px] text-white shadow-xl shadow-blue-100">
              <h3 className="text-lg font-black mb-2 uppercase tracking-tight">Refer & Earn</h3>
              <p className="text-blue-50 text-sm mb-6 font-medium leading-relaxed">
                Invite your fellow publishers and earn <span className="font-black text-white">{stats?.referral_percent || 5}%</span> of their lifetime earnings!
              </p>
              <Link 
                href="/publisher/referral"
                className="w-full py-3.5 bg-white text-[#0c9de8] font-black rounded-2xl hover:bg-blue-50 transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-blue-900/10 active:scale-95"
              >
                Invite Friends
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
