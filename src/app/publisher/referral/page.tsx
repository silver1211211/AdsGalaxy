"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Bell, Check, Clock, Copy, Gift, Medal, Share2, Sparkles, Target, Trophy,
  UserPlus, Users, X, ArrowRight, CheckCircle2, Zap, ChevronDown, ChevronUp, Star,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(value: unknown, digits = 3) {
  return `$${Number(value || 0).toFixed(digits)}`;
}

function rewardBreakdown(data: any) {
  const joinReward         = Number(data?.referral_join_reward_amount         ?? 0.005);
  const verificationReward = Number(data?.referral_verification_reward_amount ?? 0.010);
  return {
    joinReward,
    verificationReward,
    totalReward: Number(data?.reward_amount ?? (joinReward + verificationReward)),
  };
}

function rankMedalClass(rank: number) {
  if (rank === 1) return "text-amber-400";
  if (rank === 2) return "text-slate-400";
  return "text-orange-400";
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function Countdown({ endsAt, dark = false }: { endsAt?: string; dark?: boolean }) {
  const [r, setR] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, (endsAt ? new Date(endsAt).getTime() : 0) - Date.now());
      setR({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000)  / 60000),
        s: Math.floor((diff % 60000)    / 1000),
      });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endsAt]);

  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {([["Days", r.d], ["Hrs", r.h], ["Min", r.m], ["Sec", r.s]] as [string, number][]).map(([l, v]) => (
        <div key={l} className={cn("rounded-xl px-2 py-2.5", dark ? "bg-white/10" : "bg-slate-50 shadow-sm")}>
          <p className={cn("text-xl font-black", dark ? "text-white" : "text-slate-900")}>
            {String(v).padStart(2, "0")}
          </p>
          <p className={cn("text-[9px] font-black uppercase tracking-widest", dark ? "text-white/60" : "text-slate-400")}>
            {l}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Midnight countdown (daily reset) ─────────────────────────────────────────

function MidnightCountdown() {
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const diff = midnight.getTime() - now.getTime();
      setTimeLeft({
        h: Math.floor(diff / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="tabular-nums font-black text-[#0c9de8]">
      {String(timeLeft.h).padStart(2, "0")}:{String(timeLeft.m).padStart(2, "0")}:{String(timeLeft.s).padStart(2, "0")}
    </span>
  );
}

// ── Referral status badge ─────────────────────────────────────────────────────

function ReferralBadge({ status, verificationStatus }: { status?: string; verificationStatus?: string }) {
  if (status === "rejected" || verificationStatus === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-bold text-red-600">
        Rejected
      </span>
    );
  }
  if (verificationStatus === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
        <Check size={9} />Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
      <Clock size={9} />Pending
    </span>
  );
}

// ── Rewards Modal ─────────────────────────────────────────────────────────────

function RewardsModal({ data, onClose }: { data: any; onClose: () => void }) {
  const { joinReward, verificationReward, totalReward } = rewardBreakdown(data);
  const isSprint = data?.mode === "sprint";
  const fallback = `https://t.me/${process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News"}`;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50">
              <Gift size={18} className="text-emerald-500" />
            </div>
            <h2 className="text-base font-black text-slate-900">Reward Details</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Reward tiers */}
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">How You Earn</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-xl bg-blue-50 px-5 py-4">
                <div>
                  <p className="text-sm font-black text-slate-900">Friend Joins</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">Instant when they start the bot</p>
                </div>
                <span className="text-lg font-black text-[#0c9de8]">{money(joinReward)}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-5 py-4">
                <div>
                  <p className="text-sm font-black text-slate-900">Friend Verifies</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">After joining the required channel</p>
                </div>
                <span className="text-lg font-black text-emerald-600">{money(verificationReward)}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-5 py-4">
                <div>
                  <p className="text-sm font-black text-white">Total Per Referral</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-400">Maximum reward when fully verified</p>
                </div>
                <span className="text-xl font-black text-white">{money(totalReward)}</span>
              </div>
            </div>
          </div>

          {/* Channel requirement */}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Verification Requirement</p>
            <a
              href={data?.required_channel_url || fallback}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 transition-colors hover:bg-slate-100"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">Join Required Channel</p>
                <p className="truncate text-xs text-slate-400">{data?.required_channel_url || fallback}</p>
              </div>
              <ArrowRight size={16} className="ml-2 shrink-0 text-slate-400" />
            </a>
            <p className="mt-2 text-xs text-slate-400">
              Your referral must join this channel to unlock the{" "}
              <span className="font-bold text-emerald-600">{money(verificationReward)}</span> bonus.
            </p>
          </div>

          {/* Earnings summary */}
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Your Earnings</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total Earned</p>
                <p className="mt-2 text-xl font-black text-emerald-600">
                  {money(data?.total_earnings || data?.stats?.referral_earnings || 0)}
                </p>
                <p className="text-[9px] font-medium text-slate-300">USDT</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Verified Refs</p>
                <p className="mt-2 text-xl font-black text-slate-900">{data?.stats?.verified_referrals || 0}</p>
                <p className="text-[9px] font-medium text-slate-300">friends</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReferralPage() {
  const { setTitle } = useHeader();
  const [data, setData]               = useState<any>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const [copied, setCopied]           = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [showAllLeaders, setShowAllLeaders] = useState(false);
  const [showAllTeams, setShowAllTeams]     = useState(false);

  useEffect(() => {
    setTitle("Referral");
    apiFetch("/api/publisher/referrals")
      .then(r => r.json())
      .then(json => setData(json))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [setTitle]);

  const copyToClipboard = () => {
    if (!data?.referral_link) return;
    navigator.clipboard.writeText(data.referral_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
  };

  const handleShare = () => {
    if (!data?.referral_link) return;
    const { joinReward, verificationReward } = rewardBreakdown(data);
    const text = encodeURIComponent(
      `Join AdsGalaxy and monetize your Telegram audience. I earn ${money(joinReward)} when you join + ${money(verificationReward)} when you verify.\n\n${data.referral_link}`
    );
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.referral_link)}&text=${text}`;
    const twa = (window as any).Telegram?.WebApp;
    if (twa?.openTelegramLink) twa.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <DashboardLayout type="publisher">
        <div className="animate-pulse space-y-4">
          <div className="h-64 rounded-3xl bg-slate-100" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100" />)}
          </div>
          <div className="h-48 rounded-3xl bg-slate-100" />
          <div className="h-36 rounded-2xl bg-slate-100" />
          <div className="h-48 rounded-2xl bg-slate-100" />
        </div>
      </DashboardLayout>
    );
  }

  const { joinReward, verificationReward, totalReward } = rewardBreakdown(data);
  const isSprint          = data?.mode === "sprint";
  const totalReferrals    = data?.stats?.total_referrals    || 0;
  const verifiedReferrals = data?.stats?.verified_referrals || 0;
  const pendingCount      = Math.max(0, totalReferrals - verifiedReferrals);
  const hasBoost          = isSprint && Number(data?.boost?.multiplier || 1) > 1;
  const teamUnlocked      = isSprint && data?.team_league?.unlocked && data?.team_league?.current_team;
  const teamLocked        = isSprint && data?.team_league && !data.team_league.unlocked;
  const leaderboard       = (data?.leaderboard || []) as any[];
  const visibleLeaders    = showAllLeaders ? leaderboard : leaderboard.slice(0, 5);
  const notifications     = (data?.notifications || []) as any[];

  return (
    <DashboardLayout type="publisher">
      {showRewards && <RewardsModal data={data} onClose={() => setShowRewards(false)} />}

      <div className="space-y-5">

        {/* ── HERO ── */}
        <section className="rounded-3xl bg-gradient-to-br from-[#0c9de8] to-blue-700 p-7 text-white shadow-lg shadow-blue-100">
          {isSprint && (
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Sprint Live
            </div>
          )}

          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              <Gift size={26} />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Invite Friends & Earn</h1>
              <p className="text-xs font-medium text-blue-100">
                Up to{" "}
                <span className="font-black text-white">{money(totalReward)} USDT</span>{" "}
                per verified referral
              </p>
            </div>
          </div>

          <div className="mb-4 space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Your Referral Link</p>
            <div className="truncate rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 font-mono text-sm text-blue-50">
              {data?.referral_link || "-"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={copyToClipboard}
              className="flex items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-sm font-black uppercase tracking-wide text-[#0c9de8] shadow-sm transition-all active:scale-95"
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              onClick={handleShare}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/20 py-3.5 text-sm font-black uppercase tracking-wide text-white transition-all hover:bg-white/30 active:scale-95"
            >
              <Share2 size={17} />
              Share
            </button>
          </div>
        </section>

        {/* ── ALERTS ── (sprint only) */}
        {isSprint && (data?.alerts || []).length > 0 && (
          <div className="space-y-2">
            {data.alerts.map((alert: string) => (
              <div key={alert} className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-700">
                <Zap size={13} className="mt-0.5 shrink-0 text-blue-500" />
                {alert}
              </div>
            ))}
          </div>
        )}

        {/* ── EARNINGS STATS ── */}
        {isSprint && (
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
                <Target size={18} />
              </div>
              <div>
                <p className="text-sm font-black text-slate-900">Referral Sprint Features</p>
                <p className="text-xs font-semibold text-slate-500">All active sprint tools are shown here in the Mini App.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Leaderboard", value: data?.current_rank ? `Rank #${data.current_rank}` : "Open", icon: Trophy },
                { label: "Milestones", value: data?.progress?.next_milestone ? `${data.progress.referrals_needed} to next` : "Complete", icon: Medal },
                { label: "Team League", value: teamUnlocked ? data.team_league.current_team.name : `${data?.team_league?.referrals_needed || 0} left`, icon: Users },
                { label: "Boosts", value: hasBoost ? `${data.boost.multiplier}x active` : "Standard", icon: Zap },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-50 p-3">
                  <item.icon size={16} className="mb-2 text-[#0c9de8]" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                  <p className="mt-1 truncate text-sm font-black text-slate-900">{item.value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Earned", value: money(data?.total_earnings || data?.stats?.referral_earnings || 0), sub: "USDT",       cls: "text-emerald-600" },
            { label: "Verified",     value: String(verifiedReferrals),                                          sub: "referrals",  cls: "text-slate-900" },
            { label: "Pending",      value: String(pendingCount),                                               sub: "unverified", cls: pendingCount > 0 ? "text-amber-600" : "text-slate-900" },
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-slate-100 bg-white px-3 py-4 text-center shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
              <p className={cn("mt-1.5 text-lg font-black leading-none", item.cls)}>{item.value}</p>
              <p className="mt-1 text-[9px] font-medium text-slate-300">{item.sub}</p>
            </div>
          ))}
        </section>

        {/* ── SPRINT CONTEST ── (sprint only, fully inline) */}
        {isSprint && data?.sprint && (
          <section className="rounded-3xl overflow-hidden shadow-lg shadow-blue-100" style={{ background: "linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%)" }}>
            {/* Sprint header */}
            <div className="px-6 pt-6 pb-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  <Trophy size={20} />
                  <p className="text-sm font-black uppercase tracking-wide">Sprint Contest</p>
                </div>
                {data?.current_rank ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-black text-white">
                    <Medal size={12} className="text-yellow-300" />
                    Rank #{data.current_rank}
                  </div>
                ) : (
                  <div className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold text-white/70">
                    Not ranked yet
                  </div>
                )}
              </div>

              {/* Countdown */}
              {data?.sprint?.ends_at && (
                <div className="mb-4">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/60">Ends In</p>
                  <Countdown endsAt={data.sprint.ends_at} dark />
                </div>
              )}

              {/* Sprint activity stats */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Sprint Refs", value: data?.stats?.sprint_referrals || 0 },
                  { label: "Today",       value: data?.stats?.today_referrals   || 0 },
                  { label: "This Week",   value: data?.stats?.weekly_referrals  || 0 },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-white/15 p-3 text-center">
                    <p className="text-lg font-black text-white">{item.value}</p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-white/60">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Prize positions */}
            {(data?.top_winners || []).length > 0 && (
              <div className="mx-4 mb-4 rounded-2xl bg-white/10 p-4">
                <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-white/60">Prize Positions</p>
                <div className="space-y-2">
                  {data.top_winners.map((w: any) => (
                    <div key={w.rank} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Medal
                          size={15}
                          className={w.rank === 1 ? "text-yellow-300" : w.rank === 2 ? "text-white/60" : "text-blue-200"}
                        />
                        <div>
                          <p className="text-sm font-black text-white">{w.display_name || "Open spot"}</p>
                          <p className="text-[10px] text-white/50">{w.referral_count || 0} verified referrals</p>
                        </div>
                      </div>
                      <span className="text-sm font-black text-white">{money(w.reward_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </section>
        )}

        {/* ── DAILY MILESTONES ── (sprint only) */}
        {isSprint && (data?.daily_milestones || []).length > 0 && (
          <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Star size={14} className="text-amber-500" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Daily Milestones</p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                <Clock size={11} className="text-slate-300" />
                Resets in <MidnightCountdown />
              </div>
            </div>

            {/* Today's progress summary */}
            <div className="flex items-center gap-3 px-5 py-3 bg-blue-50/50 border-b border-slate-100">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0c9de8]/10">
                <Target size={14} className="text-[#0c9de8]" />
              </div>
              <div>
                <p className="text-xs font-black text-slate-800">
                  <span className="text-[#0c9de8]">{data?.stats?.today_referrals || 0}</span> referrals today
                </p>
                <p className="text-[10px] font-medium text-slate-400">Progress resets at midnight 00:00</p>
              </div>
            </div>

            {/* Milestones list */}
            <div className="divide-y divide-slate-50">
              {(data.daily_milestones as any[]).map((ms: any) => {
                const pct = Math.min(100, ((data?.stats?.today_referrals || 0) / Math.max(1, ms.threshold)) * 100);
                const done = ms.completed_today;
                return (
                  <div key={ms.id} className={cn("px-5 py-4", done && "bg-emerald-50/40")}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {done ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
                            <Check size={12} className="text-emerald-600" />
                          </div>
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
                            <Star size={12} className="text-slate-400" />
                          </div>
                        )}
                        <p className={cn("text-sm font-black", done ? "text-emerald-700" : "text-slate-800")}>
                          {ms.label}
                        </p>
                      </div>
                      <span className={cn("text-sm font-black", done ? "text-emerald-600" : "text-amber-600")}>
                        +{money(ms.reward)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={cn("h-1.5 rounded-full transition-all", done ? "bg-emerald-400" : "bg-[#0c9de8]")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <p className="text-[10px] font-medium text-slate-400">
                        {data?.stats?.today_referrals || 0} / {ms.threshold} refs today
                      </p>
                      {done && (
                        <p className="text-[10px] font-black text-emerald-600">Completed ✓</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isSprint && notifications.length > 0 && (
          <section className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-50 px-5 py-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <Bell size={13} className="text-[#0c9de8]" />
                Sprint Updates
              </p>
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-[#0c9de8]">{notifications.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {notifications.slice(0, 4).map((item) => (
                <div key={item.id} className="px-5 py-3">
                  <p className="text-sm font-black text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-500">{item.message}</p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-300">{new Date(item.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── HOW IT WORKS ── */}
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">How It Works</p>
          <div className="space-y-4">
            {[
              {
                Icon: UserPlus,
                label: "Friend Joins",
                amount: money(joinReward),
                desc: "Instant reward when they start the bot",
                iconBg: "bg-blue-50",   iconCls: "text-[#0c9de8]", amtCls: "text-[#0c9de8]",
              },
              {
                Icon: CheckCircle2,
                label: "Friend Verifies",
                amount: money(verificationReward),
                desc: "Bonus after they join the required channel",
                iconBg: "bg-emerald-50", iconCls: "text-emerald-600", amtCls: "text-emerald-600",
              },
              {
                Icon: Sparkles,
                label: "Total Per Referral",
                amount: money(totalReward),
                desc: "Maximum combined reward",
                iconBg: "bg-violet-50", iconCls: "text-violet-600", amtCls: "text-violet-600",
              },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", row.iconBg)}>
                  <row.Icon size={16} className={row.iconCls} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">{row.label}</p>
                  <p className="text-[10px] text-slate-400">{row.desc}</p>
                </div>
                <span className={cn("shrink-0 text-sm font-black", row.amtCls)}>
                  {row.amount}{" "}
                  <span className="text-[10px] font-medium opacity-60">USDT</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── BOOST BANNER ── (sprint + active boost only) */}
        {hasBoost && (
          <section className="rounded-2xl p-4" style={{ background: "linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%)" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                <Zap size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black text-white">
                  {data.boost.multiplier}x Boost Active
                </p>
                {(data?.boost?.events || []).map((ev: any) => (
                  <p key={ev.name} className="text-[10px] font-medium text-white/80">{ev.name}</p>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── REWARDS BUTTON ── */}
        <button
          onClick={() => setShowRewards(true)}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-black text-emerald-700 transition-all hover:bg-emerald-100 active:scale-95"
        >
          <Gift size={17} className="text-emerald-500" />
          View Reward Details
        </button>

        {/* ── TOP REFERRERS LEADERBOARD ── (sprint only) */}
        {isSprint && leaderboard.length > 0 && (
          <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sprint Leaderboard</p>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                {leaderboard.length}
              </span>
            </div>
            <div className="divide-y divide-slate-50">
              {visibleLeaders.map((row: any) => (
                <div key={row.user_id} className="flex items-center gap-3 px-5 py-3">
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                      row.rank === 1 ? "bg-amber-100 text-amber-700"
                        : row.rank === 2 ? "bg-slate-100 text-slate-600"
                        : row.rank === 3 ? "bg-orange-100 text-orange-600"
                        : "bg-slate-50 text-slate-400",
                    )}
                  >
                    {row.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-800 truncate">
                      {row.display_name || `User #${row.user_id}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {row.rank <= 3 && <Medal size={12} className={rankMedalClass(row.rank)} />}
                    <span className="text-xs font-black text-emerald-600">{row.referral_count} refs</span>
                  </div>
                </div>
              ))}
            </div>
            {leaderboard.length > 5 && (
              <button
                onClick={() => setShowAllLeaders(v => !v)}
                className="flex w-full items-center justify-center gap-1 border-t border-slate-50 py-3 text-[11px] font-black text-[#0c9de8]"
              >
                {showAllLeaders
                  ? <><ChevronUp size={13} /> Show less</>
                  : <><ChevronDown size={13} /> Show all {leaderboard.length} referrers</>}
              </button>
            )}
          </section>
        )}

        {/* ── TEAM LEAGUE: unlocked ── (sprint only) */}
        {teamUnlocked && (
          <section className="rounded-2xl border border-indigo-100 bg-indigo-50 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-indigo-100/50">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Your Team</p>
              {data.team_league.current_team.rank && (
                <span className="text-[10px] font-black text-indigo-600">
                  Rank #{data.team_league.current_team.rank}
                </span>
              )}
            </div>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-200 text-xl font-black text-indigo-700">
                  {String(data.team_league.current_team.name || "T").charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900">{data.team_league.current_team.name}</p>
                  <p className="text-xs text-slate-500">
                    Your contribution: {data.team_league.current_team.contribution_percent || 0}%
                    {Number(data.team_league.current_team.sprint_referrals || 0) > 0
                      ? ` - ${data.team_league.current_team.sprint_referrals} team refs` : ""}
                  </p>
                  {data.team_league.current_team.mvp && (
                    <p className="mt-0.5 text-[10px] font-bold text-indigo-500">
                      MVP: {data.team_league.current_team.mvp.display_name}
                    </p>
                  )}
                </div>
              </div>

              {/* Team standings */}
              {(data?.team_league?.leaderboard || []).length > 0 && (
                <>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-indigo-400">Team Standings</p>
                  <div className="space-y-1.5">
                    {(showAllTeams
                      ? data.team_league.leaderboard
                      : data.team_league.leaderboard.slice(0, 3)
                    ).map((team: any) => (
                      <div key={team.team_id} className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-7 text-[11px] font-black text-indigo-400">#{team.rank}</span>
                          <span className="text-sm font-bold text-slate-800">{team.name}</span>
                        </div>
                        <span className="text-xs font-black text-emerald-600">{team.sprint_referrals} refs</span>
                      </div>
                    ))}
                  </div>
                  {data.team_league.leaderboard.length > 3 && (
                    <button
                      onClick={() => setShowAllTeams(v => !v)}
                      className="mt-2 flex w-full items-center justify-center gap-1 text-[10px] font-black text-indigo-500"
                    >
                      {showAllTeams
                        ? <><ChevronUp size={12} /> Show less</>
                        : <><ChevronDown size={12} /> Show all {data.team_league.leaderboard.length} teams</>}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* ── TEAM LEAGUE: locked ── (sprint only) */}
        {teamLocked && (
          <section className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-5 text-center">
            <p className="text-sm font-black text-slate-700">Team League</p>
            <p className="mt-1 text-xs text-slate-400">
              Unlock after{" "}
              <span className="font-bold text-indigo-600">{data.team_league.unlock_at || 10}</span>{" "}
              verified referrals - {data.team_league.referrals_needed || 0} more to go
            </p>
            <div className="mx-auto mt-3 max-w-[200px] h-1.5 rounded-full bg-indigo-100 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-indigo-400 transition-all"
                style={{
                  width: `${Math.min(100,
                    ((Math.max(0, (data.team_league.unlock_at || 10) - (data.team_league.referrals_needed || 0))) /
                      Math.max(1, data.team_league.unlock_at || 10)) * 100
                  )}%`,
                }}
              />
            </div>
          </section>
        )}

        {/* ── REFERRAL HISTORY ── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Referral History</p>
            {totalReferrals > 0 && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                {totalReferrals}
              </span>
            )}
          </div>

          {(!data?.referrals || data.referrals.length === 0) ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
              <Users size={30} className="mx-auto text-slate-200" />
              <p className="mt-4 text-sm font-bold text-slate-500">No referrals yet</p>
              <p className="mt-1 text-xs text-slate-400">Share your link above to start earning rewards.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.referrals.map((ref: any) => {
                const initials = String(ref.display_name || "?").replace(/[^A-Za-z0-9#]/g, "").slice(0, 2).toUpperCase() || "?";
                const earned   = Number(ref.reward_amount || 0);
                return (
                  <div key={ref.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3.5 shadow-sm">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-black text-[#0c9de8]">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">{ref.display_name}</p>
                      <p className="text-[10px] text-slate-400">
                        {new Date(ref.created_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <ReferralBadge status={ref.status} verificationStatus={ref.verification_status} />
                      {earned > 0 && (
                        <span className="text-[11px] font-black text-emerald-600">{money(earned)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </DashboardLayout>
  );
}
