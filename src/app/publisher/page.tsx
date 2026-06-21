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
import AppBootState from "@/components/shared/AppBootState";
import { getTelegramWebApp, waitForTelegramInitData } from "@/lib/telegramWebApp";

type PublisherStats = {
  balance_locked?: string | number;
  balance_available?: string | number;
  total_channels?: string | number;
  total_withdrawn?: string | number;
  join_rewarded?: number | boolean;
  referral_percent?: string | number;
  recent_channels?: Array<{
    id: number;
    title: string;
    username?: string;
    status?: string;
  }>;
};

function toFixedMoney(value: unknown) {
  return `$${(Number.parseFloat(String(value || 0)) || 0).toFixed(2)}`;
}

export default function PublisherDashboard() {
  const { setTitle } = useHeader();
  const [stats, setStats] = React.useState<PublisherStats | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [verifyError, setVerifyError] = React.useState("");
  
  const channelName = process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
  const channelReward = process.env.NEXT_PUBLIC_CHANNEL_REWARD || "0.5";

  const fetchStats = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch("/api/publisher/stats");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load publisher stats");
      setStats(data);
    } catch (error) {
      console.error("Error fetching stats:", error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setTitle("Dashboard");
    const timer = window.setTimeout(() => {
      fetchStats();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats, setTitle]);

  const handleVerifyJoin = async () => {
    setIsVerifying(true);
    setVerifyError("");
    try {
      const initData = await waitForTelegramInitData();
      const res = await fetch("/api/publisher/verify-join", {
        method: "POST",
        headers: { "x-telegram-init-data": initData }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const currentAvailable = Number.parseFloat(String(stats?.balance_available || 0)) || 0;
        setStats({
          ...(stats || {}),
          join_rewarded: 1, 
          balance_available: (currentAvailable + Number.parseFloat(String(data.reward || 0))).toString()
        });
        getTelegramWebApp()?.showAlert?.(`Success! $${data.reward} added to your available balance.`);
      } else {
        setVerifyError(data.error || "Verification failed");
      }
    } catch {
      setVerifyError("Network error. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const statCards = stats ? [
    { 
      label: "Locked Balance", 
      value: toFixedMoney(stats.balance_locked),
      icon: Lock, 
      color: "text-amber-600", 
      bg: "bg-amber-50" 
    },
    { 
      label: "Available Balance", 
      value: toFixedMoney(stats.balance_available),
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
      value: toFixedMoney(stats.total_withdrawn),
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
          <p className="text-slate-500">Welcome back! Here&apos;s an overview of your channel performance.</p>
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

        {!loadError && stats && !stats.join_rewarded && (
          <div className="bg-gradient-to-r from-blue-600 to-blue-500 rounded-2xl p-6 shadow-lg shadow-blue-500/20 text-white flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
            <div className="relative z-10">
              <h3 className="font-black text-xl tracking-tight mb-1">Join & Earn ${channelReward}!</h3>
              <p className="text-sm text-blue-100 font-medium">Join our official channel @{channelName} to receive an instant welcome bonus directly to your available balance.</p>
              {verifyError && <p className="text-xs text-white mt-3 font-bold bg-red-500/80 px-3 py-1.5 rounded-lg inline-block shadow-sm backdrop-blur-sm border border-red-400/50">{verifyError}</p>}
            </div>
            <div className="flex gap-3 w-full md:w-auto relative z-10 shrink-0">
              <a 
                href={`https://t.me/${channelName}`} 
                target="_blank" 
                rel="noreferrer"
                className="flex-1 md:flex-none text-center bg-white text-blue-600 px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-50 transition-colors shadow-sm"
              >
                Join Channel
              </a>
              <button 
                onClick={handleVerifyJoin}
                disabled={isVerifying}
                className="flex-1 md:flex-none bg-blue-700/40 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-700/60 transition-colors disabled:opacity-50 border border-blue-400/30 backdrop-blur-sm"
              >
                {isVerifying ? "Verifying..." : "Verify"}
              </button>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {isLoading || loadError ? (
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
                  stats.recent_channels.map((channel) => (
                    <div key={channel.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-50 bg-slate-50/50">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                          <Tv size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{channel.title}</p>
                          <p className="text-xs text-slate-500">@{channel.username} - {channel.status}</p>
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
