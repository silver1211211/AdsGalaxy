"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Gift, ShieldCheck, Sparkles, Trophy, UserPlus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

const LAST_SHOWN_KEY = "ag_sprint_popup_last_shown_at";

type SprintMeta = {
  referral_sprint_enabled?: boolean;
  referral_reward_amount?: number;
  referral_join_reward_amount?: number;
  referral_verification_reward_amount?: number;
  referral_sprint_popup_interval_seconds?: number;
  referral_sprint_popup_interval_hours?: number;
};

export default function ReferralSprintPopup() {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [meta, setMeta] = useState<SprintMeta>({});
  const [dismissedAt, setDismissedAt] = useState(0);

  useEffect(() => {
    if (pathname === "/publisher/referral") return;

    let cancelled = false;
    let timer: number | undefined;

    const showPopup = (data: SprintMeta) => {
      if (cancelled) return;
      setMeta(data);
      window.localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      setVisible(true);
    };

    timer = window.setTimeout(() => {
      apiFetch("/api/publisher/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: SprintMeta | null) => {
          if (cancelled || !data) return;
          if (!data.referral_sprint_enabled) {
            setVisible(false);
            setMeta(data);
            return;
          }
          if (data.referral_sprint_enabled) {
            const intervalSeconds = Number(data.referral_sprint_popup_interval_seconds ?? ((data.referral_sprint_popup_interval_hours ?? 24) * 3600));
            const lastShownAt = Number(window.localStorage.getItem(LAST_SHOWN_KEY) || 0);
            const intervalMs = Math.max(0, intervalSeconds) * 1000;
            const remainingMs = lastShownAt ? Math.max(0, intervalMs - (Date.now() - lastShownAt)) : 0;
            if (remainingMs > 0) {
              timer = window.setTimeout(() => showPopup(data), remainingMs);
              return;
            }
            showPopup(data);
          }
        })
        .catch(() => {});
    }, 1500);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pathname, dismissedAt]);

  function dismiss() {
    setVisible(false);
    setDismissedAt(Date.now());
  }

  function joinSprint() {
    dismiss();
    router.push("/publisher/referral");
  }

  if (!visible) return null;

  const joinReward = Number(meta.referral_join_reward_amount ?? 0.005);
  const verificationReward = Number(meta.referral_verification_reward_amount ?? 0.01);
  const totalReward = Number(meta.referral_reward_amount ?? (joinReward + verificationReward));
  const formatReward = (value: number) => `$${value.toFixed(3)}`;

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-blue-100 bg-white text-slate-950 shadow-2xl shadow-[#0c9de8]/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-[#13aef5] to-[#0b86d6]" />
        <div className="absolute -right-10 top-10 h-32 w-32 rounded-full border border-white/25" />
        <div className="absolute -left-12 top-16 h-28 w-28 rounded-full border border-white/20" />

        <button
          onClick={dismiss}
          aria-label="Close Referral Sprint popup"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          <X size={16} />
        </button>

        <div className="relative p-6 pt-7">
          <div className="mb-8 flex items-center gap-3 pr-10">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#0c9de8] shadow-lg shadow-blue-950/15">
              <Trophy size={24} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-50">Live Competition</p>
              <h3 className="text-2xl font-black uppercase text-white">Referral Sprint</h3>
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm shadow-blue-100/70">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 shrink-0 text-[#0c9de8]" size={20} />
              <p className="text-sm font-semibold leading-6 text-slate-700">
                Invite friends, earn up to <span className="font-black text-slate-950">{formatReward(totalReward)}</span> per referral, and climb the sprint leaderboard for bonus prizes.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-blue-100 bg-white p-4 text-slate-950 shadow-sm shadow-blue-100/60">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
                <UserPlus size={18} />
              </div>
              <p className="text-2xl font-black">{formatReward(joinReward)}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-500">when your referral joins</p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-white p-4 text-slate-950 shadow-sm shadow-blue-100/60">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
                <ShieldCheck size={18} />
              </div>
              <p className="text-2xl font-black">{formatReward(verificationReward)}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-500">after channel verification</p>
            </div>
          </div>

          <button
            onClick={joinSprint}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] py-4 text-sm font-black uppercase text-white shadow-lg shadow-[#0c9de8]/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Gift size={18} />
            Join Sprint
            <ArrowRight size={18} />
          </button>

          <button
            onClick={dismiss}
            className="mt-3 w-full rounded-2xl py-2 text-xs font-bold text-slate-500 transition-colors hover:text-[#0c9de8]"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
