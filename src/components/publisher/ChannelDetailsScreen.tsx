"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Tv, CheckCircle2, Clock, XCircle, PauseCircle, ChevronLeft, ChevronDown,
  Edit3, Play, Pause, Lock, Copy, ShieldCheck, Info, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ChannelAnalyticsDashboard from "@/components/publisher/ChannelAnalyticsDashboard";
import { publicChannelUrl } from "@/lib/telegramChannelInput";

interface ChannelDetailsScreenProps {
  channel: any;
  onClose: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  canToggleStatus?: boolean;
  isResuming?: boolean;
}

type StatusInfo = {
  color: string;
  label: string;
  message: string;
  bg: string;
  border: string;
  dot: string;
  Icon: React.ElementType;
};

function getStatusInfo(status: string): StatusInfo {
  switch (status) {
    case "active":
      return { color: "text-emerald-700", label: "Active", message: "Your channel is live and serving ads.", bg: "bg-emerald-50", border: "border-emerald-100", dot: "bg-emerald-500", Icon: CheckCircle2 };
    case "pending":
      return { color: "text-amber-700", label: "Pending Review", message: "Under review. This usually takes 1–3 business days.", bg: "bg-amber-50", border: "border-amber-100", dot: "bg-amber-400", Icon: Clock };
    case "rejected":
      return { color: "text-red-700", label: "Rejected", message: "Not approved. Review the reason below and edit your channel.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "paused":
      return { color: "text-slate-600", label: "Paused", message: "No ads are being served. Resume anytime to start earning.", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400", Icon: PauseCircle };
    case "bot_removed":
      return { color: "text-red-700", label: "Bot Removed", message: "AdsGalaxy Bot was removed from your channel. Re-add it as admin.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "channel_not_found":
      return { color: "text-red-700", label: "Channel Not Found", message: "Channel could not be found. Verify it still exists.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "permission_missing":
      return { color: "text-red-700", label: "Permission Missing", message: "Bot permissions are missing. Re-add the bot as admin with the correct permissions.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "deleted":
      return { color: "text-red-700", label: "Deleted", message: "This channel has been removed from AdsGalaxy.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    default:
      return { color: "text-slate-600", label: "Unknown", message: "Status is being determined.", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400", Icon: Clock };
  }
}

export default function ChannelDetailsScreen({
  channel, onClose, onEdit, onToggleStatus, canToggleStatus, isResuming,
}: ChannelDetailsScreenProps) {
  const [liveSubscriberCount, setLiveSubscriberCount] = useState<number | null>(null);
  const subscriberCount = liveSubscriberCount ?? (Number(channel.subscriber_count) || 0);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const twa = window.Telegram?.WebApp;
    if (twa?.BackButton) {
      twa.BackButton.show();
      twa.BackButton.onClick(onClose);
      return () => {
        twa.BackButton.offClick(onClose);
        twa.BackButton.hide();
      };
    }
  }, [onClose]);

  const statusInfo = getStatusInfo(channel.status);
  const continents: string[] = (() => {
    try { return JSON.parse(channel.audience_continents || "[]"); } catch { return []; }
  })();
  const categories: string[] = (() => {
    if (!channel.categories) return [];
    if (typeof channel.categories === "string") {
      try { return JSON.parse(channel.categories); } catch { return []; }
    }
    return channel.categories;
  })();
  const isPrivate = !channel.username || channel.channel_type === "private";
  const telegramUrl = !isPrivate ? publicChannelUrl(channel.username) : null;
  const rawTrackingStatus = String(channel.tracking_account_status || "");
  const trackingStatus = rawTrackingStatus === "active"
    ? "active"
    : channel.status === "active" && rawTrackingStatus === "pending_manual"
      ? "pending_manual"
      : "limited";
  const manualUsernames: Array<{ account: number; username: string }> = Array.isArray(channel.tracking_manual_usernames)
    ? channel.tracking_manual_usernames
    : [];
  const copyTrackingUsername = (username: string) => {
    navigator.clipboard?.writeText(`@${username}`).catch(() => null);
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed top-16 left-0 right-0 bottom-0 z-[55] flex flex-col bg-[#f8f9fb]"
    >
      {/* ── Top bar ── */}
      <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 py-3.5 shadow-sm">
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black uppercase tracking-tight text-slate-900">
            {channel.title}
          </p>
          {telegramUrl && (
            <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0c9de8] hover:underline">
              @{channel.username}<ExternalLink size={10} />
            </a>
          )}
        </div>
        <span className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm ring-1 ring-inset ring-black/[0.03]",
          statusInfo.bg, statusInfo.color,
        )}>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusInfo.dot)} />
          {statusInfo.label}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 p-4 pb-8">

          {/* ── Asset Overview ── */}
          {isPrivate && (
            <div className={cn(
              "overflow-hidden rounded-2xl border p-4",
              trackingStatus === "active" ? "border-emerald-100 bg-emerald-50"
              : trackingStatus === "pending_manual" ? "border-blue-100 bg-blue-50"
              : "border-slate-200 bg-slate-50"
            )}>
              <div className="flex items-start gap-3">
                <span className={cn(
                  "mt-0.5 shrink-0",
                  trackingStatus === "active" ? "text-emerald-600" : trackingStatus === "pending_manual" ? "text-[#0c9de8]" : "text-slate-500"
                )}>
                  {trackingStatus === "active" ? <ShieldCheck size={18} /> : <Clock size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "text-sm font-black",
                    trackingStatus === "active" ? "text-emerald-700" : trackingStatus === "pending_manual" ? "text-blue-700" : "text-slate-700"
                  )}>
                    {trackingStatus === "active" ? "Tracking Active" : trackingStatus === "pending_manual" ? "Pending Manual Setup" : "Limited"}
                  </p>
                  <p className={cn(
                    "mt-0.5 text-xs font-medium leading-relaxed",
                    trackingStatus === "active" ? "text-emerald-700/80" : trackingStatus === "pending_manual" ? "text-blue-700/80" : "text-slate-600"
                  )}>
                    {trackingStatus === "active"
                      ? `Tracking account ${channel.tracking_account || ""} is connected for private-channel view checks.`
                      : trackingStatus === "pending_manual"
                        ? "Add one AdsGalaxy tracking account to this private channel so view checks can become fully available."
                        : "Private view tracking will be completed after approval and tracking setup."}
                  </p>
                  {trackingStatus === "pending_manual" && manualUsernames.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {manualUsernames.map((item) => (
                        <div key={`${item.account}-${item.username}`} className="flex items-center gap-2 rounded-xl bg-white/75 p-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">@{item.username}</span>
                          <button
                            type="button"
                            onClick={() => copyTrackingUsername(item.username)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0c9de8] text-white active:scale-95"
                            aria-label={`Copy @${item.username}`}
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
            <div className="flex items-center gap-4 p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50">
                <Tv size={28} className="text-[#0c9de8]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-black text-slate-900">{channel.title}</p>
                {isPrivate ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                    <Lock size={10} />
                    Private Channel
                  </span>
                ) : (
                  <a href={telegramUrl!} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm font-bold text-[#0c9de8] hover:underline">
                    @{channel.username}<ExternalLink size={12} />
                  </a>
                )}
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  {subscriberCount.toLocaleString()} subscribers
                </p>
              </div>
            </div>
          </div>

          {/* ── Status issue (only shown when there's something to act on) ── */}
          {(channel.paused_reason || channel.failure_reason || channel.suggested_fix) && (
            <div className={cn("overflow-hidden rounded-2xl border p-4", statusInfo.bg, statusInfo.border)}>
              {(channel.paused_reason || channel.failure_reason) && (
                <p className={cn("text-xs font-bold", statusInfo.color)}>
                  {channel.paused_reason || channel.failure_reason}
                </p>
              )}
              {channel.suggested_fix && (
                <p className={cn("mt-1 text-xs font-medium opacity-80", statusInfo.color)}>{channel.suggested_fix}</p>
              )}
            </div>
          )}

          {/* ── Channel Analytics ── */}
          <ChannelAnalyticsDashboard channelId={channel.id} onSubscriberCount={setLiveSubscriberCount} />

          {/* ── Details (General Info + Monetization Setup + Categories + Target Audience) ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100"
              aria-expanded={detailsOpen}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                <Info size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-slate-900">General Information</span>
                <span className="block text-[11px] font-semibold text-slate-500">Channel type, username, and registration date</span>
              </span>
              <ChevronDown size={18} className={cn("shrink-0 text-slate-400 transition-transform duration-200", detailsOpen && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {detailsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-slate-100"
                >
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <span className="text-xs font-semibold text-slate-400">Channel Type</span>
                      <span className="text-sm font-bold text-slate-900">
                        {isPrivate ? "Private" : "Public"}
                      </span>
                    </div>
                    {!isPrivate && (
                      <div className="flex items-center justify-between px-4 py-3.5">
                        <span className="text-xs font-semibold text-slate-400">Username</span>
                        <a href={telegramUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-[#0c9de8] hover:underline">
                          @{channel.username}<ExternalLink size={12} />
                        </a>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <span className="text-xs font-semibold text-slate-400">Registered</span>
                      <span className="text-sm font-bold text-slate-900">
                        {new Date(channel.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <span className="text-xs font-semibold text-slate-400">Ad Posts / Day</span>
                      <span className="text-sm font-bold text-slate-900">{channel.posts_per_day ?? "—"}</span>
                    </div>
                  </div>

                  {categories.length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-3.5">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Categories</p>
                      <div className="flex flex-wrap gap-2">
                        {categories.map((cat: string) => (
                          <span key={cat} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-slate-100 px-4 py-3.5">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Target Audience</p>
                    <div className="flex flex-wrap gap-2">
                      {continents.length > 0 ? (
                        continents.map((cont: string) => (
                          <span key={cont} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
                            {cont}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-500">Global</span>
                      )}
                    </div>
                  </div>

                  {onEdit && (
                    <div className="border-t border-slate-100 px-4 py-3.5">
                      <button
                        onClick={onEdit}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 active:scale-[0.98]"
                      >
                        <Edit3 size={14} />
                        Edit Channel
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Actions ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Actions</p>
            </div>
            <div className="space-y-2.5 px-4 py-4">
              {onToggleStatus && canToggleStatus && (
                <button
                  onClick={onToggleStatus}
                  className={cn(
                    "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black shadow-sm transition hover:shadow active:scale-[0.98]",
                    isResuming
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  )}
                >
                  {isResuming ? <Play size={14} /> : <Pause size={14} />}
                  {isResuming ? "Resume" : "Pause"}
                </button>
              )}
              <button
                onClick={onClose}
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-black text-white shadow-md shadow-slate-900/10 transition-all hover:bg-slate-800 hover:shadow-lg active:scale-[0.98]"
              >
                Close
              </button>
            </div>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
