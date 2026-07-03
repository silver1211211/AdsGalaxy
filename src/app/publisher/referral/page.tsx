"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy referral API payload is dynamically shaped */

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2,
  ChevronDown, ChevronUp, Clock, Copy, Gift, Lock,
  Medal, Share2, Shield, Sparkles, Star,
  Trophy, Users, UserPlus, X, Zap, Calendar,
  Crown, Flame, Gauge, Rocket, Target, Bell,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { cn } from "@/lib/utils";
import { usePopupQueue } from "@/context/PopupQueueContext";

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

// ── Countdown (sprint end) ────────────────────────────────────────────────────

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

// ── Midnight countdown ────────────────────────────────────────────────────────

function MidnightCountdown({ inline = false }: { inline?: boolean }) {
  const [t, setT] = useState({ h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const mid = new Date(now); mid.setHours(24, 0, 0, 0);
      const diff = mid.getTime() - now.getTime();
      setT({ h: Math.floor(diff / 3600000), m: Math.floor((diff % 3600000) / 60000), s: Math.floor((diff % 60000) / 1000) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const str = `${String(t.h).padStart(2,"0")}:${String(t.m).padStart(2,"0")}:${String(t.s).padStart(2,"0")}`;
  if (inline) return <span className="tabular-nums font-black text-[#0c9de8]">{str}</span>;
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3 text-center">
      <p className="text-[9px] font-black uppercase tracking-widest text-white/60">Daily Reset</p>
      <p className="mt-1 tabular-nums text-xl font-black text-white">{str}</p>
    </div>
  );
}

// ── Referral status badge ─────────────────────────────────────────────────────

function ReferralBadge({ status, verificationStatus }: { status?: string; verificationStatus?: string }) {
  if (status === "rejected" || verificationStatus === "rejected")
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-bold text-red-600">Rejected</span>;
  if (verificationStatus === "verified")
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700"><Check size={9} />Verified</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700"><Clock size={9} />Pending</span>;
}

// ── Reward Details Modal ──────────────────────────────────────────────────────

function RewardDetailsModal({ data, onClose }: { data: any; onClose: () => void }) {
  const isQueueActive = usePopupQueue(true, "referral-reward-details");
  const { joinReward, verificationReward, totalReward } = rewardBreakdown(data);
  const fallback = `https://t.me/${process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News"}`;
  if (!isQueueActive) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 pt-16 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4 lg:pl-64 lg:pt-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg flex-1 sm:flex-none sm:max-h-[90vh] bg-white sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50">
              <Gift size={18} className="text-emerald-500" />
            </div>
            <h2 className="text-base font-black text-slate-900">Reward Details</h2>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">How You Earn</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-xl bg-blue-50 px-5 py-4">
                <div>
                  <p className="text-sm font-black text-slate-900">Friend Joins</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">Paid instantly to withdrawable balance</p>
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
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Verification Requirement</p>
            <a href={data?.required_channel_url || fallback} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 transition-colors hover:bg-slate-100">
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

// ── Success Popup ─────────────────────────────────────────────────────────────

function SuccessPopup({ amount, settlementDate, onClose }: { amount: string; settlementDate: string; onClose: () => void }) {
  const isQueueActive = usePopupQueue(true, `referral-success:${amount}:${settlementDate}`);
  if (!isQueueActive) return null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-black text-slate-900">Congratulations</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">Your sprint reward has been confirmed</p>
          <div className="my-6 rounded-2xl bg-slate-50 px-6 py-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Amount Credited</p>
            <p className="mt-2 text-3xl font-black text-emerald-600">{amount}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-400">USDT</p>
          </div>
          <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-slate-500">
              <Calendar size={14} />
              <span className="text-xs font-medium">Settlement Date</span>
            </div>
            <span className="text-xs font-black text-slate-900">{settlementDate}</span>
          </div>
          <button onClick={onClose} className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-black text-white transition-all hover:bg-slate-800 active:scale-95">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Fraud Popup ──────────────────────────────────────────────────────────────

function FraudPopup({ reward, reason, reviewDate, onClose }: {
  reward: string; reason: string; reviewDate: string; onClose: () => void;
}) {
  const isQueueActive = usePopupQueue(true, `referral-fraud:${reward}:${reason}:${reviewDate}`);
  if (!isQueueActive) return null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="border-b border-red-50 bg-red-50 px-6 py-5 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Shield size={26} className="text-red-500" />
          </div>
          <h2 className="text-base font-black text-slate-900">Sprint Review Failed</h2>
          <p className="mt-1 text-xs font-medium text-slate-500">Daily sprint reward was not approved</p>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-xs font-medium text-slate-500">Reward</span>
            <span className="text-xs font-black text-slate-900">{reward}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-xs font-medium text-slate-500">Status</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-bold text-red-600">Fraud Detected</span>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Reason</p>
            <p className="text-xs font-medium text-slate-700">{reason}</p>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-xs font-medium text-slate-500">Review Date</span>
            <span className="text-xs font-black text-slate-900">{reviewDate}</span>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
            <p className="text-xs font-medium text-blue-700">Your regular referral commissions are not affected by this review.</p>
          </div>
          <button onClick={onClose} className="w-full rounded-2xl bg-slate-900 py-3 text-xs font-black text-white transition-all hover:bg-slate-800 active:scale-95">
            Close
          </button>
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
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [successPopup, setSuccessPopup] = useState<{ amount: string; settlementDate: string } | null>(null);
  const [fraudPopup, setFraudPopup]   = useState<{ reward: string; reason: string; reviewDate: string } | null>(null);

  useEffect(() => {
    setTitle("Referral");
    apiFetch("/api/publisher/referrals")
      .then(r => r.json())
      .then(json => setData(json))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [setTitle]);

  useEffect(() => {
    const closeOverlaysForNavigation = () => {
      setShowRewards(false);
      setSuccessPopup(null);
      setFraudPopup(null);
    };
    window.addEventListener("adsgalaxy:navigation-start", closeOverlaysForNavigation);
    return () => window.removeEventListener("adsgalaxy:navigation-start", closeOverlaysForNavigation);
  }, []);

  useEffect(() => {
    const notification = (data?.notifications || []).find((item: any) =>
      item?.status === "unread"
      && ["referral_settlement_paid", "referral_settlement_fraud"].includes(item?.notification_type)
    );
    if (!notification) return;

    const meta = notification.metadata || {};
    const settlementDate = meta.settlement_date
      ? new Date(meta.settlement_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
      : new Date(notification.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

    const popupTimer = window.setTimeout(() => {
      if (notification.notification_type === "referral_settlement_paid") {
        setSuccessPopup({ amount: money(meta.amount || 0), settlementDate });
      } else {
        setFraudPopup({
          reward: money(meta.amount || 0),
          reason: meta.reason || notification.message || "Less than 3% publisher conversion.",
          reviewDate: settlementDate,
        });
      }
    }, 0);

    apiFetch("/api/publisher/referrals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: notification.id }),
    }).catch(console.error);

    return () => window.clearTimeout(popupTimer);
  }, [data]);

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

  if (isLoading) {
    return (
      <DashboardLayout type="publisher">
        <div className="animate-pulse space-y-4">
          <div className="h-52 rounded-3xl bg-slate-100" />
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-2xl bg-slate-100" />)}
          </div>
          <div className="h-36 rounded-2xl bg-slate-100" />
          <div className="h-48 rounded-3xl bg-slate-100" />
          <div className="h-48 rounded-2xl bg-slate-100" />
        </div>
      </DashboardLayout>
    );
  }

  const { joinReward, verificationReward, totalReward } = rewardBreakdown(data);
  const isSprint          = data?.mode === "sprint";
  const totalReferrals    = data?.stats?.total_referrals    || 0;
  const verifiedReferrals = data?.stats?.verified_referrals || 0;
  const todayRefs         = data?.stats?.today_verified_referrals ?? data?.stats?.today_referrals ?? 0;
  const teamUnlocked      = isSprint && data?.team_league?.unlocked && data?.team_league?.current_team;
  const leaderboard       = (data?.leaderboard || []) as any[];
  const visibleLeaders    = showAllLeaders ? leaderboard : leaderboard.slice(0, 5);
  const referrals         = (data?.referrals || []) as any[];
  const visibleRefs       = showAllHistory ? referrals : referrals.slice(0, 5);
  const pendingTotal      = Number(data?.pending_rewards_total || 0);
  const nextSettlement    = data?.next_settlement_date
    ? new Date(data.next_settlement_date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : "Rolling weekly";
  const dailyMilestones   = ((data?.daily_milestones || []) as any[]);
  const nextMilestone     = dailyMilestones.find((ms: any) => !ms.completed_today) || dailyMilestones[dailyMilestones.length - 1];
  const dailyTarget       = Number(nextMilestone?.threshold || Math.max(todayRefs, 1));
  const dailyProgress     = Math.min(100, Math.round((todayRefs / Math.max(1, dailyTarget)) * 100));
  const currentRank       = Number(data?.current_rank || 0);
  const settlementHistory = ((data?.settlement_history || []) as any[]);
  const lastSettlement    = settlementHistory[0];
  const hasBoost          = isSprint && Number(data?.boost?.multiplier || 1) > 1;
  const boostEvents       = ((data?.boost?.events || []) as any[]);
  const team              = teamUnlocked ? (data.team_league.current_team as any) : null;
  const teamLeaderboard   = ((data?.team_league?.leaderboard || []) as any[]);
  const teamProgressNow   = teamUnlocked
    ? Number(team?.sprint_referrals || 0)
    : Math.max(0, Number(data?.team_league?.unlock_at || 0) - Number(data?.team_league?.referrals_needed || 0));
  const teamProgressGoal  = teamUnlocked ? Math.max(1, Number(team?.sprint_referrals || 1)) : Math.max(1, Number(data?.team_league?.unlock_at || 1));
  const teamProgressPct   = teamUnlocked ? 100 : Math.min(100, Math.round((teamProgressNow / teamProgressGoal) * 100));
  const qualitySignals = [
    verifiedReferrals > 0 ? "Verified referrals are counted for sprint rewards." : "Get your first verified referral to activate reward momentum.",
    pendingTotal > 0 ? "Your highest daily milestone is pending for midnight settlement." : "No daily milestone reward is pending yet.",
    teamUnlocked ? "Team league is unlocked — your referrals now push team rank." : "Team league unlocks with more verified referrals.",
  ];

  return (
    <DashboardLayout type="publisher">
      {showRewards  && <RewardDetailsModal data={data} onClose={() => setShowRewards(false)} />}
      {successPopup && <SuccessPopup amount={successPopup.amount} settlementDate={successPopup.settlementDate} onClose={() => setSuccessPopup(null)} />}
      {fraudPopup   && <FraudPopup reward={fraudPopup.reward} reason={fraudPopup.reason} reviewDate={fraudPopup.reviewDate} onClose={() => setFraudPopup(null)} />}

      <div className="space-y-4">

        <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-2xl shadow-blue-950/20">
          <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#0c9de8]/40 blur-3xl" />
          <div className="absolute -bottom-24 left-8 h-48 w-48 rounded-full bg-violet-500/30 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.16),transparent_28%),linear-gradient(135deg,rgba(12,157,232,0.95),rgba(15,23,42,0.92)_55%,rgba(88,28,135,0.88))]" />

          <div className="relative px-5 py-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/80 backdrop-blur">
                <span className={cn("h-2 w-2 rounded-full", isSprint ? "animate-pulse bg-emerald-300" : "bg-slate-400")} />
                {isSprint ? "Sprint Live" : "Referral Engine"}
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/15 px-3 py-1.5 text-[10px] font-black text-amber-100">
                <Crown size={12} />
                {currentRank ? `Rank #${currentRank}` : "No rank yet"}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-100/70">Referral Command Center</p>
              <h1 className="text-3xl font-black leading-tight tracking-tight">
                Turn quality invites into settled rewards.
              </h1>
              <p className="max-w-xl text-sm font-medium leading-6 text-white/70">
                Share once, track every verified referral, climb the daily sprint, and push your team toward the pool.
              </p>
            </div>

            <div className="mt-5 rounded-3xl border border-white/15 bg-white/10 p-3 shadow-inner shadow-white/5 backdrop-blur">
              <p className="mb-2 px-1 text-[9px] font-black uppercase tracking-widest text-white/50">Your referral link</p>
              <div className="flex items-center gap-2 rounded-2xl bg-slate-950/45 px-3 py-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-cyan-50">{data?.referral_link || "—"}</span>
                <button onClick={copyToClipboard} className="rounded-xl bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-950 active:scale-95">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-xs font-black uppercase tracking-wide text-slate-950 shadow-lg shadow-white/10 active:scale-95"
                >
                  <Rocket size={15} />
                  Launch Invite
                </button>
                <button
                  onClick={() => setShowRewards(true)}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 py-3 text-xs font-black uppercase tracking-wide text-white active:scale-95"
                >
                  <Gift size={15} />
                  Rewards
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: "Today", value: todayRefs, sub: "verified path", Icon: Flame },
                { label: "Pending", value: money(pendingTotal), sub: "settlement", Icon: Clock },
                { label: "Reset", value: <MidnightCountdown inline />, sub: "daily sprint", Icon: Calendar },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
                  <item.Icon size={14} className="mb-2 text-cyan-100" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-white/45">{item.label}</p>
                  <p className="mt-1 truncate text-sm font-black text-white">{item.value}</p>
                  <p className="mt-0.5 truncate text-[9px] font-semibold text-white/45">{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 1. REFERRAL LINK HERO ── */}
        <section
          className="hidden rounded-3xl overflow-hidden shadow-lg shadow-blue-100"
          style={{ background: "linear-gradient(135deg, #0c9de8 0%, #0b80cb 100%)" }}
        >
          {isSprint && (
            <div className="flex items-center justify-between px-6 pt-5">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Sprint Active
              </div>
              {data?.current_rank && (
                <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[10px] font-black text-white">
                  <Trophy size={11} className="text-amber-300" />
                  Rank #{data.current_rank}
                </div>
              )}
            </div>
          )}
          <div className="px-6 pt-5 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-2">Your Referral Link</p>
            <div className="flex items-center rounded-2xl border border-white/20 bg-white/10 px-4 py-3 min-w-0">
              <span className="flex-1 truncate font-mono text-sm text-white/90">{data?.referral_link || "—"}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 px-6 pb-6 pt-3">
            <button
              onClick={copyToClipboard}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-black uppercase tracking-wide text-[#0c9de8] shadow-sm transition-all active:scale-95"
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? "Copied" : "Copy Link"}
            </button>
            <button
              onClick={handleShare}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white/20 py-3.5 text-sm font-black uppercase tracking-wide text-white transition-all hover:bg-white/30 active:scale-95"
            >
              <Share2 size={17} />
              Share
            </button>
          </div>
        </section>

        {/* ── 2. REFERRAL SUMMARY ── */}
        <section>
          <p className="mb-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Referral Summary</p>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "Total Referrals", value: String(totalReferrals),    sub: "all time",  Icon: Users,        iconBg: "bg-blue-50",   iconCls: "text-[#0c9de8]",   valCls: "text-slate-900" },
              { label: "Verified",        value: String(verifiedReferrals), sub: "referrals", Icon: CheckCircle2, iconBg: "bg-emerald-50", iconCls: "text-emerald-500", valCls: "text-emerald-600" },
              { label: "Total Earned",    value: money(data?.total_earnings || data?.stats?.referral_earnings || 0), sub: "USDT", Icon: Sparkles, iconBg: "bg-amber-50", iconCls: "text-amber-500", valCls: "text-amber-600" },
              { label: "Today",           value: String(todayRefs),         sub: "referrals", Icon: Zap,          iconBg: "bg-violet-50", iconCls: "text-violet-500",  valCls: todayRefs > 0 ? "text-violet-700" : "text-slate-900" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", item.iconBg)}>
                  <item.Icon size={16} className={item.iconCls} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-tight">{item.label}</p>
                  <p className={cn("mt-0.5 text-lg font-black leading-none", item.valCls)}>{item.value}</p>
                  <p className="text-[9px] font-medium text-slate-300">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 3. PENDING REFERRAL REWARDS ── */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl border border-cyan-100 bg-white p-5 shadow-sm">
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-100 blur-2xl" />
            <div className="relative">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-500">Daily Sprint Mission</p>
                  <p className="mt-1 text-xl font-black text-slate-950">{todayRefs}/{dailyTarget} verified</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600">
                  <Target size={20} />
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-600 transition-all" style={{ width: `${dailyProgress}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-slate-400">
                <span>{dailyProgress}% complete</span>
                <span>Resets <MidnightCountdown inline /></span>
              </div>
              <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold leading-5 text-slate-500">
                {nextMilestone
                  ? `Next milestone: ${nextMilestone.label || `${nextMilestone.threshold} referrals`} for ${money(nextMilestone.reward)}.`
                  : "All daily milestones are cleared. Keep stacking verified referrals before settlement."}
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-violet-100 bg-slate-950 p-5 text-white shadow-sm">
            <div className="absolute -left-10 -top-10 h-28 w-28 rounded-full bg-violet-500/40 blur-2xl" />
            <div className="absolute -bottom-10 right-0 h-24 w-24 rounded-full bg-[#0c9de8]/30 blur-2xl" />
            <div className="relative">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-200/70">Team League</p>
                  <p className="mt-1 text-xl font-black">{teamUnlocked ? team?.name : "Locked"}</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-violet-100">
                  {teamUnlocked ? <Crown size={20} /> : <Lock size={20} />}
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-3 rounded-full bg-gradient-to-r from-violet-300 to-cyan-300 transition-all" style={{ width: `${teamProgressPct}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-white/45">
                <span>{teamUnlocked ? `${team?.sprint_referrals || 0} team refs` : `${teamProgressNow}/${teamProgressGoal} unlock`}</span>
                <span>{teamUnlocked && team?.rank ? `Rank #${team.rank}` : "Quality referrals only"}</span>
              </div>
              <p className="mt-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs font-semibold leading-5 text-white/65">
                {teamUnlocked
                  ? `Your contribution is ${team?.contribution_percent || 0}%. Push together to capture the team pool.`
                  : `${data?.team_league?.referrals_needed || 0} more verified referrals to enter team rewards.`}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Gauge size={16} />
              </div>
              <div>
                <p className="text-sm font-black text-slate-950">Quality & Settlement Radar</p>
                <p className="text-[10px] font-semibold text-slate-400">Built to reward real publishers, not empty traffic.</p>
              </div>
            </div>
            {hasBoost && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-black text-orange-600">
                <Flame size={11} />
                {data.boost.multiplier}x
              </span>
            )}
          </div>
          <div className="grid gap-2">
            {qualitySignals.map((signal) => (
              <div key={signal} className="flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                <p className="text-xs font-semibold leading-5 text-slate-600">{signal}</p>
              </div>
            ))}
            {lastSettlement && (
              <div className="flex items-start gap-2 rounded-2xl bg-blue-50 px-3 py-2.5">
                <Bell size={14} className="mt-0.5 shrink-0 text-[#0c9de8]" />
                <p className="text-xs font-semibold leading-5 text-slate-600">
                  Last settlement: <span className="font-black">{lastSettlement.status}</span> · {money(lastSettlement.amount)}.
                </p>
              </div>
            )}
            {hasBoost && boostEvents.length > 0 && (
              <div className="rounded-2xl bg-orange-50 px-3 py-2.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">Active boosts</p>
                <p className="mt-1 text-xs font-semibold text-orange-700">{boostEvents.map((event: any) => event.name).join(", ")}</p>
              </div>
            )}
          </div>
        </section>

        {/* ── 4. DAILY REFERRAL SPRINT ── */}
        {isSprint && (data?.daily_milestones || []).length > 0 && (
          <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50">
                  <Star size={15} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">Daily Referral Sprint</p>
                  <p className="text-[10px] font-medium text-slate-400">
                    Resets in <MidnightCountdown inline />
                  </p>
                </div>
              </div>
              <div className="rounded-full bg-blue-50 px-3 py-1">
                <span className="text-[10px] font-black text-[#0c9de8]">{todayRefs} today</span>
              </div>
            </div>

            <div className="divide-y divide-slate-50">
              {(data.daily_milestones as any[]).map((ms: any, idx: number) => {
                const prevThreshold = idx === 0 ? 0 : (data.daily_milestones as any[])[idx - 1].threshold;
                const pct           = Math.min(100, (todayRefs / Math.max(1, ms.threshold)) * 100);
                const done          = ms.completed_today;
                const isActive      = !done && todayRefs >= prevThreshold && todayRefs < ms.threshold;
                const isLocked      = !done && !isActive;
                const payoutStatus  = ms.payout_status || ms.status;
                const isPaid        = payoutStatus === "paid";
                const isFraudMs     = payoutStatus === "fraud";

                return (
                  <div
                    key={ms.id ?? idx}
                    className={cn(
                      "px-5 py-4 transition-colors",
                      isPaid    && "bg-emerald-50/30",
                      isFraudMs && "bg-red-50/20",
                      done && !isPaid && !isFraudMs && "bg-amber-50/20",
                      isActive  && "bg-blue-50/20",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                          isPaid     ? "bg-emerald-100 text-emerald-700"
                          : isFraudMs ? "bg-red-100 text-red-600"
                          : done     ? "bg-amber-100 text-amber-700"
                          : isActive  ? "bg-blue-100 text-[#0c9de8]"
                          : "bg-slate-100 text-slate-400"
                        )}>
                          {isPaid ? <Check size={13} />
                            : isFraudMs ? <AlertTriangle size={11} />
                            : done ? <Check size={13} />
                            : ms.threshold}
                        </div>
                        <div>
                          <p className={cn(
                            "text-sm font-black",
                            isPaid     ? "text-emerald-700"
                            : isFraudMs ? "text-red-600"
                            : done     ? "text-amber-700"
                            : isActive  ? "text-slate-900"
                            : "text-slate-400"
                          )}>
                            {ms.label || `${ms.threshold} Referrals`}
                          </p>
                          <p className="text-[10px] font-medium text-slate-400">{ms.threshold} refs required</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={cn(
                          "text-sm font-black",
                          isPaid     ? "text-emerald-600"
                          : isFraudMs ? "text-red-300 line-through"
                          : done     ? "text-amber-600"
                          : isActive  ? "text-[#0c9de8]"
                          : "text-slate-300"
                        )}>
                          +{money(ms.reward)}
                        </span>
                        {isPaid && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700">Paid</span>}
                        {isFraudMs && (
                          <button
                            onClick={() => setFraudPopup({
                              reward: money(ms.reward),
                              reason: ms.fraud_reason || "Suspicious activity detected",
                              reviewDate: ms.review_date || nextSettlement,
                            })}
                            className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black text-red-600 hover:bg-red-100 transition-colors"
                          >
                            Fraud
                          </button>
                        )}
                        {done && !isPaid && !isFraudMs && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">Pending</span>}
                        {isActive && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black text-[#0c9de8]">In Progress</span>}
                        {isLocked && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-400">Locked</span>}
                      </div>
                    </div>
                    {!isPaid && !isFraudMs && (
                      <>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn("h-1.5 rounded-full transition-all duration-500",
                              done ? "bg-amber-400" : isActive ? "bg-[#0c9de8]" : "bg-slate-200")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[9px] font-medium text-slate-400">
                          {Math.min(todayRefs, ms.threshold)} / {ms.threshold}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 5. TEAM SPRINT — always visible in sprint mode ── */}
        {isSprint && data?.team_league && (
          <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50">
                  <Users size={15} className="text-violet-600" />
                </div>
                <p className="text-sm font-black text-slate-900">Team Sprint</p>
              </div>
              {teamUnlocked && (data.team_league.current_team as any)?.rank && (
                <span className="rounded-full bg-violet-50 px-3 py-1 text-[10px] font-black text-violet-600">
                  Rank #{(data.team_league.current_team as any).rank}
                </span>
              )}
            </div>

            {teamUnlocked ? (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-xl font-black text-violet-700">
                    {String((data.team_league.current_team as any).name || "T").charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900">{(data.team_league.current_team as any).name}</p>
                    <p className="text-xs text-slate-500">
                      Your contribution:{" "}
                      <span className="font-black text-violet-600">{(data.team_league.current_team as any).contribution_percent || 0}%</span>
                      {Number((data.team_league.current_team as any).sprint_referrals || 0) > 0
                        && ` · ${(data.team_league.current_team as any).sprint_referrals} refs`}
                    </p>
                    {(data.team_league.current_team as any).mvp && (
                      <p className="mt-0.5 text-[10px] font-bold text-violet-500">
                        MVP: {(data.team_league.current_team as any).mvp.display_name}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] font-bold text-emerald-600">
                      Projected team pool: {money((data.team_league.current_team as any).projected_reward_pool || 0)} · Your projected cut: {money((data.team_league.current_team as any).projected_member_reward || 0)}
                    </p>
                  </div>
                </div>

                {teamLeaderboard.length > 0 && (
                  <>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Team Standings</p>
                    <div className="space-y-1.5">
                      {(showAllTeams ? teamLeaderboard : teamLeaderboard.slice(0, 3)).map((team: any) => (
                        <div key={team.team_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black",
                              team.rank === 1 ? "bg-amber-100 text-amber-700"
                              : team.rank === 2 ? "bg-slate-200 text-slate-600"
                              : team.rank === 3 ? "bg-orange-100 text-orange-600"
                              : "bg-slate-100 text-slate-400"
                            )}>
                              {team.rank}
                            </span>
                            <span className="text-sm font-bold text-slate-800">{team.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="block text-xs font-black text-emerald-600">{team.sprint_referrals} refs</span>
                            <span className="block text-[9px] font-bold text-violet-500">Pool {money(team.projected_reward_pool || 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {teamLeaderboard.length > 3 && (
                      <button onClick={() => setShowAllTeams(v => !v)} className="flex w-full items-center justify-center gap-1 text-[10px] font-black text-[#0c9de8]">
                        {showAllTeams
                          ? <><ChevronUp size={12} /> Show less</>
                          : <><ChevronDown size={12} /> Show all {teamLeaderboard.length} teams</>}
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                    <Lock size={16} className="text-slate-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Unlock Team League</p>
                    <p className="text-xs text-slate-400">
                      {data.team_league.referrals_needed || 0} more verified referrals to qualify
                    </p>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1.5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Qualification Progress</p>
                    <p className="text-[10px] font-black text-slate-500">
                      {Math.max(0, (data.team_league.unlock_at || 20) - (data.team_league.referrals_needed || 0))}
                      /{data.team_league.unlock_at || 20}
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-violet-400 transition-all"
                      style={{
                        width: `${Math.min(100,
                          ((Math.max(0, (data.team_league.unlock_at || 20) - (data.team_league.referrals_needed || 0)))
                            / Math.max(1, data.team_league.unlock_at || 20)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Unlock at{" "}
                    <span className="font-black text-violet-600">{data.team_league.unlock_at || 20}</span>{" "}
                    verified referrals — keep inviting quality friends.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── 6. COUNTDOWN AREA ── */}
        {isSprint && data?.sprint?.ends_at && (
          <section
            className="rounded-3xl overflow-hidden shadow-lg shadow-blue-50"
            style={{ background: "linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%)" }}
          >
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-white">
                  <Trophy size={18} />
                  <p className="text-sm font-black uppercase tracking-wide">Sprint Countdown</p>
                </div>
                {data?.sprint?.name && (
                  <span className="rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold text-white">
                    {data.sprint.name}
                  </span>
                )}
              </div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-white/60">Sprint Ends In</p>
              <Countdown endsAt={data.sprint.ends_at} dark />
              <div className="mt-4 flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
                <div className="flex items-center gap-2 text-white text-xs font-black">
                  <Clock size={13} />
                  Daily Reset
                </div>
                <MidnightCountdown inline />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-px bg-white/10">
              {[
                { label: "Sprint Total", value: data?.stats?.sprint_referrals || 0 },
                { label: "This Week",   value: data?.stats?.weekly_referrals  || 0 },
                { label: "Today",       value: todayRefs },
              ].map(item => (
                <div key={item.label} className="bg-black/20 px-3 py-3 text-center">
                  <p className="text-lg font-black text-white">{item.value}</p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-white/50">{item.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 7. HOW YOU EARN ── */}
        <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">How You Earn</p>
            <button onClick={() => setShowRewards(true)} className="flex items-center gap-1 text-[10px] font-black text-[#0c9de8]">
              <Gift size={11} />
              Full Details
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { Icon: UserPlus,     label: "Friend Joins",       amount: money(joinReward),         desc: "Paid instantly to withdrawable balance", iconBg: "bg-blue-50",   iconCls: "text-[#0c9de8]",   amtCls: "text-[#0c9de8]" },
              { Icon: CheckCircle2, label: "Friend Verifies",    amount: money(verificationReward), desc: "After joining the required channel",     iconBg: "bg-emerald-50",iconCls: "text-emerald-500", amtCls: "text-emerald-600" },
              { Icon: Sparkles,     label: "Total Per Referral", amount: money(totalReward),        desc: "Maximum combined reward per person",     iconBg: "bg-slate-900", iconCls: "text-white",        amtCls: "text-slate-900" },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3 px-5 py-4">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", row.iconBg)}>
                  <row.Icon size={16} className={row.iconCls} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">{row.label}</p>
                  <p className="text-[10px] text-slate-400">{row.desc}</p>
                </div>
                <span className={cn("shrink-0 text-sm font-black", row.amtCls)}>
                  {row.amount} <span className="text-[10px] font-medium opacity-50">USDT</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── SPRINT LEADERBOARD ── */}
        {isSprint && leaderboard.length > 0 && (
          <section className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
              <div className="flex items-center gap-2">
                <Trophy size={14} className="text-amber-500" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sprint Leaderboard</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                {leaderboard.length}
              </span>
            </div>
            <div className="divide-y divide-slate-50">
              {visibleLeaders.map((row: any) => (
                <div key={row.user_id} className="flex items-center gap-3 px-5 py-3">
                  <div className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                    row.rank === 1 ? "bg-amber-100 text-amber-700"
                    : row.rank === 2 ? "bg-slate-100 text-slate-600"
                    : row.rank === 3 ? "bg-orange-100 text-orange-600"
                    : "bg-slate-50 text-slate-400"
                  )}>
                    {row.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-800 truncate block">
                      {row.display_name || `User #${row.user_id}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {row.rank <= 3 && (
                      <Medal size={12} className={
                        row.rank === 1 ? "text-amber-400" : row.rank === 2 ? "text-slate-400" : "text-orange-400"
                      } />
                    )}
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
                  : <><ChevronDown size={13} /> Show all {leaderboard.length}</>}
              </button>
            )}
          </section>
        )}

        {/* ── 8. REFERRAL HISTORY ── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Referral History</p>
            {totalReferrals > 0 && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                {totalReferrals}
              </span>
            )}
          </div>

          {referrals.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50">
                <Users size={24} className="text-slate-300" />
              </div>
              <p className="text-sm font-bold text-slate-500">No referrals yet</p>
              <p className="mt-1 text-xs text-slate-400">Share your link to start earning rewards.</p>
              <button
                onClick={handleShare}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#0c9de8] px-5 py-2.5 text-xs font-black text-white shadow-md shadow-blue-100 active:scale-95 transition-all"
              >
                <Share2 size={13} />
                Share Referral Link
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleRefs.map((ref: any) => {
                const initials   = String(ref.display_name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
                const earned     = Number(ref.reward_amount || 0);
                const isFraudRef = ref.status === "fraud" || ref.verification_status === "fraud";
                const isVerified = ref.verification_status === "verified";

                return (
                  <div
                    key={ref.id}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border bg-white px-4 py-3.5 shadow-sm",
                      isFraudRef ? "border-red-100" : "border-slate-100"
                    )}
                  >
                    <div className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black",
                      isFraudRef ? "bg-red-50 text-red-400"
                      : isVerified ? "bg-emerald-50 text-emerald-600"
                      : "bg-blue-50 text-[#0c9de8]"
                    )}>
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
                      {earned > 0 && !isFraudRef && (
                        <span className="text-[11px] font-black text-emerald-600">{money(earned)}</span>
                      )}
                      {isFraudRef && (
                        <button
                          onClick={() => setFraudPopup({
                            reward: money(earned),
                            reason: ref.fraud_reason || "Suspicious activity detected",
                            reviewDate: ref.review_date || nextSettlement,
                          })}
                          className="text-[10px] font-black text-red-500 hover:text-red-700 transition-colors"
                        >
                          Details
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {referrals.length > 5 && (
                <button
                  onClick={() => setShowAllHistory(v => !v)}
                  className="flex w-full items-center justify-center gap-1 rounded-2xl border border-slate-100 bg-white py-3 text-[11px] font-black text-[#0c9de8] shadow-sm"
                >
                  {showAllHistory
                    ? <><ChevronUp size={13} /> Show less</>
                    : <><ChevronDown size={13} /> Show all {referrals.length} referrals</>}
                </button>
              )}
            </div>
          )}
        </section>

      </div>
    </DashboardLayout>
  );
}
