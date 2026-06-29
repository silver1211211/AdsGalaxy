"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Tv, CheckCircle2, Clock, XCircle, PauseCircle, ChevronLeft,
  Edit3, Play, Pause, Lock, Copy, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 py-3.5">
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="flex-1 truncate text-sm font-black uppercase tracking-tight text-slate-900">
          Channel Details
        </p>
        <span className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
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

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
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
                  <p className="mt-0.5 text-sm font-bold text-[#0c9de8]">@{channel.username}</p>
                )}
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  {channel.subscriber_count?.toLocaleString() || "0"} subscribers
                </p>
              </div>
            </div>
          </div>

          {/* ── Status & Approval ── */}
          <div className={cn("overflow-hidden rounded-2xl border p-4", statusInfo.bg, statusInfo.border)}>
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 shrink-0", statusInfo.color)}>
                <statusInfo.Icon size={18} />
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-black", statusInfo.color)}>{statusInfo.label}</p>
                <p className={cn("mt-0.5 text-xs font-medium leading-relaxed opacity-80", statusInfo.color)}>
                  {statusInfo.message}
                </p>
              </div>
            </div>
            {(channel.paused_reason || channel.failure_reason || channel.suggested_fix) && (
              <div className="mt-3 rounded-xl bg-white/70 p-3 backdrop-blur-sm">
                {(channel.paused_reason || channel.failure_reason) && (
                  <p className="text-xs font-bold text-slate-800">
                    {channel.paused_reason || channel.failure_reason}
                  </p>
                )}
                {channel.suggested_fix && (
                  <p className="mt-1 text-xs font-medium text-slate-600">{channel.suggested_fix}</p>
                )}
              </div>
            )}
          </div>

          {/* ── General Information ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">General Information</p>
            </div>
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
                  <span className="text-sm font-bold text-[#0c9de8]">@{channel.username}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Chat ID</span>
                <span className="font-mono text-sm font-bold text-slate-900">{channel.chat_id}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Registered</span>
                <span className="text-sm font-bold text-slate-900">
                  {new Date(channel.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* ── Monetization Setup ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monetization Setup</p>
            </div>
            <div className="divide-y divide-slate-50">
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Ad Posts / Day</span>
                <span className="text-sm font-bold text-slate-900">{channel.posts_per_day ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Subscribers</span>
                <span className="text-sm font-bold text-slate-900">
                  {channel.subscriber_count?.toLocaleString() || "0"}
                </span>
              </div>
            </div>
          </div>

          {/* ── Categories ── */}
          {categories.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Categories</p>
              </div>
              <div className="flex flex-wrap gap-2 px-4 py-3.5">
                {categories.map((cat: string) => (
                  <span key={cat} className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Target Audience ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Target Audience</p>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3.5">
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

          {/* ── Actions ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Actions</p>
            </div>
            <div className="space-y-2.5 px-4 py-4">
              {(onEdit || (onToggleStatus && canToggleStatus)) && (
                <div className="grid grid-cols-2 gap-2.5">
                  {onEdit && (
                    <button
                      onClick={onEdit}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 active:scale-[0.98]"
                    >
                      <Edit3 size={14} />
                      Edit Channel
                    </button>
                  )}
                  {onToggleStatus && canToggleStatus && (
                    <button
                      onClick={onToggleStatus}
                      className={cn(
                        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black transition active:scale-[0.98]",
                        isResuming
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      )}
                    >
                      {isResuming ? <Play size={14} /> : <Pause size={14} />}
                      {isResuming ? "Resume" : "Pause"}
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-black text-white transition-colors hover:bg-slate-800 active:scale-[0.98]"
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
