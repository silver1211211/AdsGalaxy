"use client";

import React from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Lock,
  Wallet,
  Tv,
  History,
  ArrowRight,
  MoreVertical,
  FileText,
  Edit3,
  Pause,
  Play,
  Loader2,
  Bot,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import { useHeader } from "@/context/HeaderContext";
import AppBootState from "@/components/shared/AppBootState";
import { getTelegramWebApp, waitForTelegramInitData } from "@/lib/telegramWebApp";
import ChannelDetailsScreen from "@/components/publisher/ChannelDetailsScreen";
import AddChannelScreen from "@/components/publisher/AddChannelScreen";
import Toast from "@/components/ui/Toast";

type PublisherStats = {
  balance_locked?: string | number;
  balance_available?: string | number;
  total_channels?: string | number;
  total_monetized?: string | number;
  total_withdrawn?: string | number;
  join_rewarded?: number | boolean;
  referral_percent?: string | number;
  referral_reward_amount?: string | number;
  referral_sprint_enabled?: boolean;
  referral_dashboard_promotion_enabled?: boolean;
  recent_channels?: Array<{
    id: number;
    title: string;
    username?: string;
    status?: string;
  }>;
  recent_monetized?: Array<{
    type: "channel" | "bot" | "miniapp";
    id: number;
    name: string;
    username?: string;
    status?: string;
  }>;
};

function toFixedMoney(value: unknown) {
  return `$${(Number.parseFloat(String(value || 0)) || 0).toFixed(2)}`;
}

const canReactivate = (status: string) =>
  ["paused", "bot_removed", "channel_not_found", "permission_missing"].includes(status);

export default function PublisherDashboard() {
  const { setTitle } = useHeader();
  const [stats, setStats] = React.useState<PublisherStats | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [verifyError, setVerifyError] = React.useState("");

  // three-dots menu state
  const [openMenu,       setOpenMenu]       = React.useState<number | null>(null);
  const [viewingChannel, setViewingChannel] = React.useState<any | null>(null);
  const [editingChannel, setEditingChannel] = React.useState<any | null>(null);
  const [processingId,   setProcessingId]   = React.useState<number | null>(null);
  const [toast, setToast] = React.useState<{ type: "success" | "error"; title: string; message: string } | null>(null);

  const channelName   = process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
  const channelReward = process.env.NEXT_PUBLIC_CHANNEL_REWARD || "0.5";

  const fetchStats = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res  = await apiFetch("/api/publisher/stats");
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
    const timer = window.setTimeout(() => { fetchStats(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats, setTitle]);

  React.useEffect(() => {
    function close() { setOpenMenu(null); }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const handleVerifyJoin = async () => {
    setIsVerifying(true);
    setVerifyError("");
    try {
      const initData = await waitForTelegramInitData();
      const res  = await fetch("/api/publisher/verify-join", {
        method: "POST",
        headers: { "x-telegram-init-data": initData },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const cur = Number.parseFloat(String(stats?.balance_available || 0)) || 0;
        setStats({ ...(stats || {}), join_rewarded: 1, balance_available: (cur + Number.parseFloat(String(data.reward || 0))).toString() });
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

  async function handleToggleStatus(channel: any) {
    setProcessingId(channel.id);
    setOpenMenu(null);
    try {
      const res  = await apiFetch(`/api/publisher/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "toggle_status" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      fetchStats();
      setToast({ type: "success", title: "Status Updated", message: "Channel status updated successfully." });
    } catch (err: any) {
      setToast({ type: "error", title: "Update Failed", message: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  const statCards = stats ? [
    { label: "Locked Balance",    value: toFixedMoney(stats.balance_locked),    icon: Lock,    color: "text-amber-600",  bg: "bg-amber-50"  },
    { label: "Available Balance", value: toFixedMoney(stats.balance_available),  icon: Wallet,  color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Monetized",          value: (stats.total_monetized ?? 0).toString(), icon: Tv,      color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Lifetime Withdrawn",value: toFixedMoney(stats.total_withdrawn),    icon: History, color: "text-emerald-600", bg: "bg-emerald-50" },
  ] : [];

  return (
    <DashboardLayout type="publisher">
      {/* overlay to close menus */}
      {openMenu !== null && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
      )}

      <AnimatePresence>
        {viewingChannel && (
          <ChannelDetailsScreen channel={viewingChannel} onClose={() => setViewingChannel(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingChannel && (
          <AddChannelScreen
            channel={editingChannel}
            onClose={() => setEditingChannel(null)}
            onSuccess={() => { setEditingChannel(null); fetchStats(); }}
          />
        )}
      </AnimatePresence>

      <Toast
        isOpen={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || "success"}
        title={toast?.title || ""}
        message={toast?.message || ""}
      />

      <div className="space-y-8">
        {/* Header */}
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

        {/* Recent Monetized */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-900">Recent Monetized</h3>
                <Link href="/publisher/monetize" className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-1">
                  View all <ArrowRight size={14} />
                </Link>
              </div>
              <div className="space-y-4">
                {isLoading ? (
                  [1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-slate-50 animate-pulse rounded-xl" />
                  ))
                ) : !stats?.recent_monetized || stats.recent_monetized.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-slate-400 text-sm">No monetized assets yet.</p>
                  </div>
                ) : (
                  stats.recent_monetized.map((item) => {
                    const isChannel = item.type === "channel";
                    const iconConfig = item.type === "channel"
                      ? { icon: <Tv size={20} />, bg: "bg-blue-100", color: "text-blue-600", label: "Channel" }
                      : item.type === "bot"
                      ? { icon: <Bot size={20} />, bg: "bg-violet-100", color: "text-violet-600", label: "Bot" }
                      : { icon: <Smartphone size={20} />, bg: "bg-emerald-100", color: "text-emerald-600", label: "Mini App" };

                    return (
                      <div key={`${item.type}-${item.id}`} className="flex items-center justify-between p-4 rounded-xl border border-slate-50 bg-slate-50/50">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full ${iconConfig.bg} flex items-center justify-center ${iconConfig.color}`}>
                            {iconConfig.icon}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{item.name}</p>
                            <p className="text-xs text-slate-500">
                              {iconConfig.label} · @{item.username} ·{" "}
                              <span className={item.status === "active" || item.status === "approved" ? "text-emerald-500 font-semibold" : ""}>
                                {item.status}
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Three-dots menu — channels only */}
                        {isChannel ? (
                          <div className="relative shrink-0">
                            <button
                              onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setOpenMenu(openMenu === item.id ? null : item.id); }}
                              className="p-2 hover:bg-white rounded-lg transition-colors text-slate-400"
                            >
                              <MoreVertical size={16} />
                            </button>

                            {openMenu === item.id && (
                              <div className="absolute right-0 bottom-full mb-1 z-20 w-52 rounded-2xl bg-white shadow-xl border border-slate-100 overflow-hidden">
                                <button
                                  onClick={() => { setOpenMenu(null); setViewingChannel({ id: item.id, title: item.name, username: item.username, status: item.status }); }}
                                  className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                  <FileText size={15} className="text-slate-400 shrink-0" />
                                  View Details
                                </button>
                                <div className="border-t border-slate-100" />
                                <button
                                  onClick={() => { setOpenMenu(null); setEditingChannel({ id: item.id, title: item.name, username: item.username, status: item.status }); }}
                                  className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                  <Edit3 size={15} className="text-slate-400 shrink-0" />
                                  Edit Channel
                                </button>
                                <div className="border-t border-slate-100" />
                                <button
                                  disabled={item.status === "pending" || item.status === "deleted" || processingId === item.id}
                                  onClick={() => handleToggleStatus({ id: item.id, status: item.status })}
                                  className={cn(
                                    "flex items-center gap-3 w-full px-4 py-3 text-xs font-bold transition-colors",
                                    item.status === "pending" || item.status === "deleted" || processingId === item.id
                                      ? "text-slate-300 cursor-not-allowed"
                                      : "text-slate-700 hover:bg-slate-50"
                                  )}
                                >
                                  {processingId === item.id ? (
                                    <><Loader2 size={15} className="animate-spin shrink-0" />Processing...</>
                                  ) : canReactivate(item.status ?? "") ? (
                                    <><Play size={15} className="text-emerald-500 shrink-0" />Resume Channel</>
                                  ) : (
                                    <><Pause size={15} className="text-slate-400 shrink-0" />Pause Channel</>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Link href="/publisher/monetize" className="p-2 text-slate-300 hover:text-slate-500 transition-colors">
                            <ArrowRight size={16} />
                          </Link>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
