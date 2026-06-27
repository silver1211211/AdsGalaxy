"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Check, Clock, Copy, Gift, Medal, Share2, Sparkles, Target, TrendingUp, Trophy, UserPlus, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";

function money(value: unknown, digits = 2) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 3 })}`;
}

function Countdown({ endsAt }: { endsAt?: string }) {
  const [remaining, setRemaining] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const tick = () => {
      const target = endsAt ? new Date(endsAt).getTime() : 0;
      const diff = Math.max(0, target - Date.now());
      setRemaining({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {[
        ["Days", remaining.days],
        ["Hours", remaining.hours],
        ["Minutes", remaining.minutes],
        ["Seconds", remaining.seconds],
      ].map(([label, value]) => (
        <div key={label} className="rounded-xl bg-white px-3 py-2 shadow-sm">
          <p className="text-xl font-black text-slate-900">{String(value).padStart(2, "0")}</p>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        </div>
      ))}
    </div>
  );
}

export default function ReferralPage() {
  const { setTitle } = useHeader();
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const fallbackChannelUrl = `https://t.me/${process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News"}`;

  useEffect(() => {
    setTitle("Referral Sprint");
    fetchData();
  }, [setTitle]);

  const fetchData = async () => {
    try {
      const res = await apiFetch("/api/publisher/referrals");
      const json = await res.json();
      if (res.ok) setData(json);
    } catch (error) {
      console.error("Error fetching referrals:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!data?.referral_link) return;
    navigator.clipboard.writeText(data.referral_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
  };

  const handleShare = () => {
    if (!data?.referral_link) return;
    const text = encodeURIComponent(`Invite friends, earn verified referral rewards, and compete in the AdsGalaxy Referral Sprint.\n\n${data.referral_link}`);
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.referral_link)}&text=${text}`;
    const twa = (window as any).Telegram?.WebApp;
    if (twa?.openTelegramLink) twa.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <DashboardLayout type="publisher">
        <div className="space-y-6 animate-pulse">
          <div className="h-56 rounded-2xl bg-slate-100" />
          <div className="grid grid-cols-2 gap-4"><div className="h-24 rounded-2xl bg-slate-100" /><div className="h-24 rounded-2xl bg-slate-100" /></div>
          <div className="h-64 rounded-2xl bg-slate-100" />
        </div>
      </DashboardLayout>
    );
  }

  if (data?.mode === "classic") {
    return (
      <DashboardLayout type="publisher">
        <div className="space-y-6">
          <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
                <Gift size={24} />
              </div>
              <div>
                <h1 className="text-xl font-black uppercase tracking-tight">Invite Friends & Earn</h1>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-100">Classic referral mode</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Your Referral Link</p>
              <div className="truncate rounded-xl border border-white/20 bg-white/10 px-4 py-3 font-mono text-sm">{data?.referral_link}</div>
              <a href={data?.required_channel_url || fallbackChannelUrl} target="_blank" rel="noreferrer" className="block rounded-xl bg-white/10 px-4 py-3 text-xs font-bold text-blue-50 underline-offset-2 hover:underline">
                Channel join requirement: {data?.required_channel_url || fallbackChannelUrl}
              </a>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={copyToClipboard} className="flex items-center justify-center gap-2 rounded-xl bg-white py-4 text-sm font-black uppercase tracking-widest text-blue-600 transition-all active:scale-95">
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={handleShare} className="flex items-center justify-center gap-2 rounded-xl bg-white/20 py-4 text-sm font-black uppercase tracking-widest text-white transition-all active:scale-95">
                  <Share2 size={20} />
                  Share
                </button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Referral Count</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{data?.stats?.verified_referrals || 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Referral Earnings</p>
              <p className="mt-2 text-2xl font-black text-emerald-600">{money(data?.total_earnings || data?.stats?.referral_earnings || 0, 3)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reward Per Verified Referral</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{money(data?.reward_amount || 0.015, 3)}</p>
            </div>
          </section>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-8">
        <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <Gift size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Invite Friends & Earn</h1>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-100">Earn {money(data?.reward_amount || 0.015, 3)} per verified referral</p>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-2 text-center">
            {["Invite Friends", "Earn Rewards", "Compete"].map((label) => (
              <div key={label} className="rounded-xl bg-white/10 px-2 py-3 text-[10px] font-black uppercase tracking-widest text-blue-50">{label}</div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Your Referral Link</p>
            <div className="truncate rounded-xl border border-white/20 bg-white/10 px-4 py-3 font-mono text-sm">{data?.referral_link}</div>
            <a href={data?.required_channel_url || fallbackChannelUrl} target="_blank" rel="noreferrer" className="block rounded-xl bg-white/10 px-4 py-3 text-xs font-bold text-blue-50 underline-offset-2 hover:underline">
              Required channel for verified rewards: {data?.required_channel_url || fallbackChannelUrl}
            </a>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={copyToClipboard} className="flex items-center justify-center gap-2 rounded-xl bg-white py-4 text-sm font-black uppercase tracking-widest text-blue-600 transition-all active:scale-95">
                {copied ? <Check size={20} /> : <Copy size={20} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={handleShare} className="flex items-center justify-center gap-2 rounded-xl bg-white/20 py-4 text-sm font-black uppercase tracking-widest text-white transition-all active:scale-95">
                <Share2 size={20} />
                Share
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-700">
                <Trophy size={20} />
                <h2 className="text-lg font-black uppercase tracking-tight">Referral Sprint</h2>
              </div>
              <p className="text-sm font-semibold text-amber-800">Current rank: {data?.current_rank ? `#${data.current_rank}` : "Not ranked yet"}</p>
            </div>
            <Countdown endsAt={data?.sprint?.ends_at} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(data?.top_winners || []).map((winner: any) => (
              <div key={`winner-${winner.rank}`} className="rounded-xl bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-900">
                  <Medal size={18} className="text-amber-500" />
                  <p className="font-black">Place #{winner.rank}</p>
                </div>
                <p className="mt-2 text-sm font-bold text-slate-600">{winner.display_name || "Open spot"}</p>
                <p className="text-xs font-semibold text-slate-400">{Number(winner.referral_count || 0)} referrals / {money(winner.reward_amount)} bonus</p>
              </div>
            ))}
          </div>
        </section>

        {(data?.alerts || []).length > 0 && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <div className="mb-3 flex items-center gap-2 text-blue-700">
              <Sparkles size={18} />
              <h2 className="text-sm font-black uppercase tracking-tight">Growth Alerts</h2>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {data.alerts.map((alert: string) => (
                <div key={alert} className="rounded-xl bg-white px-4 py-3 text-xs font-bold text-slate-700 shadow-sm">{alert}</div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Target size={18} className="text-emerald-600" />
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Milestone Progress</h2>
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-2xl font-black text-slate-900">
                {data?.progress?.current_referrals || 0} / {data?.progress?.next_milestone?.threshold_count || "Max"} Referrals
              </p>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Reward: {data?.progress?.next_milestone ? money(data.progress.reward_available) : "All milestones complete"}
              </p>
            </div>
            <div className="h-3 min-w-0 flex-1 rounded-full bg-slate-100">
              <div
                className="h-3 rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, ((data?.progress?.current_referrals || 0) / Math.max(1, data?.progress?.next_milestone?.threshold_count || data?.progress?.current_referrals || 1)) * 100)}%` }}
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Users size={18} className="text-indigo-600" />
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Team League</h2>
          </div>
          {!data?.team_league?.unlocked ? (
            <div className="rounded-xl bg-slate-50 p-5">
              <p className="font-black text-slate-900">Unlocks after {data?.team_league?.unlock_at || 10} verified referrals</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">{data?.team_league?.referrals_needed || 0} more verified referrals to join a permanent team.</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl bg-indigo-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Current Team</p>
                <p className="mt-1 text-xl font-black text-slate-900">{data.team_league.current_team?.name}</p>
                <p className="text-xs font-bold text-slate-500">Rank #{data.team_league.current_team?.rank || "-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Team MVP</p>
                <p className="mt-1 text-xl font-black text-slate-900">{data.team_league.current_team?.mvp?.display_name || "Pending"}</p>
                <p className="text-xs font-bold text-slate-500">{data.team_league.current_team?.mvp?.sprint_referrals || 0} sprint referrals</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Your Contribution</p>
                <p className="mt-1 text-xl font-black text-slate-900">{data.team_league.current_team?.contribution_percent || 0}%</p>
                <p className="text-xs font-bold text-slate-500">of team sprint referrals</p>
              </div>
            </div>
          )}
          <div className="mt-4 space-y-2">
            {(data?.team_league?.leaderboard || []).slice(0, 5).map((team: any) => (
              <div key={team.team_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-sm font-black text-slate-900">#{team.rank} Team {team.name}</p>
                <p className="text-xs font-bold text-slate-500">{team.members} members / {team.sprint_referrals} sprint referrals</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {[
            ["Total Earned", money(data?.total_earnings || data?.stats?.referral_earnings || 0), TrendingUp],
            ["Total Referrals", data?.stats?.total_referrals || 0, Users],
            ["Today", data?.stats?.today_referrals || 0, UserPlus],
            ["This Week", data?.stats?.weekly_referrals || 0, Clock],
            ["Sprint", data?.stats?.sprint_referrals || 0, Trophy],
            ["Rank", data?.current_rank ? `#${data.current_rank}` : "-", Medal],
          ].map(([label, value, Icon]: any) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-slate-400"><Icon size={16} /><p className="text-[10px] font-black uppercase tracking-widest">{label}</p></div>
              <p className="text-xl font-black text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Trophy size={18} className="text-blue-600" />
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Top Referrers</h2>
          </div>
          <div className="space-y-2">
            {(data?.leaderboard || []).slice(0, 10).map((row: any) => (
              <div key={row.user_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-black text-slate-900">#{row.rank} {row.display_name || `User #${row.user_id}`}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{row.referral_count} verified referrals</p>
                </div>
                <p className="text-sm font-black text-emerald-600">{money(row.referral_rewards || 0, 3)}</p>
              </div>
            ))}
            {(!data?.leaderboard || data.leaderboard.length === 0) && <p className="py-6 text-center text-xs font-semibold text-slate-400">No verified referrals in this sprint yet.</p>}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
              <UserPlus size={18} />
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Referral History</h2>
          </div>

          {!data?.referrals || data.referrals.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
              <Users size={32} className="mx-auto text-slate-200" />
              <p className="mt-4 text-sm font-black uppercase tracking-tight text-slate-900">No Referrals Yet</p>
              <p className="mt-1 text-xs font-semibold text-slate-400">Share your link to start earning verified referral rewards.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.referrals.map((referral: any) => (
                <div key={referral.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-xl font-black text-blue-600">#</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-900">{referral.display_name}</p>
                    <p className="text-[10px] font-bold uppercase tracking-tight text-slate-400">
                      {referral.verification_status || "pending"} / {referral.reward_status || "pending"} / {new Date(referral.created_at).toLocaleDateString([], { dateStyle: "medium" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-emerald-600">{money(referral.reward_amount || 0, 3)}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{referral.status || "pending"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
