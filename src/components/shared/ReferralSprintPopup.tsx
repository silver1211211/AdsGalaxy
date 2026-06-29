"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Gift, ShieldCheck, Sparkles, Trophy, UserPlus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { usePopupQueue } from "@/context/PopupQueueContext";

const LAST_SHOWN_KEY = "ag_sprint_popup_last_shown_at";

type SprintMeta = {
  referral_sprint_enabled?: boolean;
  referral_reward_amount?: number;
  referral_join_reward_amount?: number;
  referral_verification_reward_amount?: number;
  referral_sprint_popup_interval_seconds?: number;
  referral_sprint_popup_interval_hours?: number;
};

interface ReferralSprintPopupProps {
  onBlockingChange?: (isBlocking: boolean) => void;
}

export default function ReferralSprintPopup({ onBlockingChange }: ReferralSprintPopupProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [meta, setMeta] = useState<SprintMeta>({});
  const [dismissedAt, setDismissedAt] = useState(0);
  const isQueueActive = usePopupQueue(visible, "referral-sprint-popup");

  useEffect(() => {
    if (pathname === "/publisher/referral") {
      setVisible(false);
      onBlockingChange?.(false);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    onBlockingChange?.(true);

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
            onBlockingChange?.(false);
            return;
          }
          if (data.referral_sprint_enabled) {
            const intervalSeconds = Number(
              data.referral_sprint_popup_interval_seconds ??
                ((data.referral_sprint_popup_interval_hours ?? 24) * 3600),
            );
            const lastShownAt = Number(
              window.localStorage.getItem(LAST_SHOWN_KEY) || 0,
            );
            const intervalMs = Math.max(0, intervalSeconds) * 1000;
            const remainingMs = lastShownAt
              ? Math.max(0, intervalMs - (Date.now() - lastShownAt))
              : 0;
            if (remainingMs > 0) {
              onBlockingChange?.(false);
              timer = window.setTimeout(() => showPopup(data), remainingMs);
              return;
            }
            showPopup(data);
          }
        })
        .catch(() => {
          if (!cancelled) onBlockingChange?.(false);
        });
    }, 1500);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [dismissedAt, onBlockingChange, pathname]);

  function dismiss() {
    setVisible(false);
    onBlockingChange?.(false);
    setDismissedAt(Date.now());
  }

  function joinSprint() {
    dismiss();
    router.push("/publisher/referral");
  }

  useEffect(() => {
    onBlockingChange?.(visible && isQueueActive);
  }, [isQueueActive, onBlockingChange, visible]);

  const joinReward = Number(meta.referral_join_reward_amount ?? 0.005);
  const verificationReward = Number(meta.referral_verification_reward_amount ?? 0.01);
  const totalReward = Number(meta.referral_reward_amount ?? (joinReward + verificationReward));
  const formatReward = (value: number) => `$${value.toFixed(3)}`;

  return (
    <AnimatePresence>
      {visible && isQueueActive && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <motion.div
            key="sprint-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            onClick={dismiss}
            aria-hidden="true"
          />

          {/* Container */}
          <motion.div
            key="sprint-container"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient header band */}
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-[#13aef5] to-[#0b86d6]" />
            {/* Decorative circles */}
            <div className="pointer-events-none absolute -right-10 top-10 h-32 w-32 rounded-full border border-white/20" />
            <div className="pointer-events-none absolute -left-12 top-16 h-28 w-28 rounded-full border border-white/15" />

            {/* Close button */}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close Referral Sprint"
              className="absolute right-4 top-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
            >
              <X size={16} />
            </button>

            <div className="relative p-6 pt-7">
              {/* Header identity */}
              <div className="mb-7 flex items-center gap-3 pr-8">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#0c9de8] shadow-[0_4px_16px_rgba(12,157,232,0.18)]">
                  <Trophy size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">
                    Live Competition
                  </p>
                  <h3 className="text-2xl font-black text-white leading-tight">
                    Referral Sprint
                  </h3>
                </div>
              </div>

              {/* Earn per referral info */}
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 shrink-0 text-[#0c9de8]" size={18} />
                  <p className="text-sm font-medium leading-relaxed text-slate-700">
                    Invite friends, earn up to{" "}
                    <span className="font-black text-slate-900">
                      {formatReward(totalReward)}
                    </span>{" "}
                    per referral, and climb the sprint leaderboard for bonus prizes.
                  </p>
                </div>
              </div>

              {/* Reward breakdown */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
                    <UserPlus size={17} />
                  </div>
                  <p className="text-2xl font-black text-slate-900">
                    {formatReward(joinReward)}
                  </p>
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                    when your referral joins
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
                    <ShieldCheck size={17} />
                  </div>
                  <p className="text-2xl font-black text-slate-900">
                    {formatReward(verificationReward)}
                  </p>
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                    after channel verification
                  </p>
                </div>
              </div>

              {/* Actions */}
              <button
                type="button"
                onClick={joinSprint}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] py-3.5 text-sm font-black text-white shadow-[0_4px_16px_rgba(12,157,232,0.25)] transition-colors hover:bg-blue-600 active:scale-[0.98]"
              >
                <Gift size={17} />
                Join Sprint
                <ArrowRight size={17} />
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="mt-3 w-full rounded-2xl py-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-700"
              >
                Maybe later
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
