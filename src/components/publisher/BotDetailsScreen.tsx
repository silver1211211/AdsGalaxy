"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot, CheckCircle2, Clock, XCircle, PauseCircle,
  ChevronLeft, Copy, ExternalLink, Webhook, Edit3, Play, Pause,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

const appOrigin = (
  process.env.NEXT_PUBLIC_APP_URL
  || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL
  || "https://app.adsgalaxy.online"
).replace(/\/$/, "");

const setupGuideUrl = `${appOrigin}/docs/publisher/bots#webhook-setup`;

type PublisherBot = {
  id: number | string;
  bot_name: string;
  bot_username?: string | null;
  status: string;
  paused_reason?: string | null;
  failure_reason?: string | null;
  suggested_fix?: string | null;
  active_count?: number;
  blocked_count?: number;
  posts_per_day?: number;
  continents?: string | string[] | null;
  categories?: string | string[] | null;
  created_at: string;
};

type WebhookDetails = {
  webhook_url: string | null;
  webhook_status: "configured" | "not_configured" | "receiving_users";
  webhook_last_update_at: string | null;
};

type TelegramWebApp = {
  openLink?: (url: string) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
};

function getTelegramWebApp() {
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

function openExternalUrl(url: string) {
  const telegram = getTelegramWebApp();
  if (telegram?.openLink) { telegram.openLink(url); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}

function parseStringArray(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

interface BotDetailsScreenProps {
  bot: PublisherBot;
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
      return { color: "text-emerald-700", label: "Active", message: "Your bot is live and ready to broadcast.", bg: "bg-emerald-50", border: "border-emerald-100", dot: "bg-emerald-500", Icon: CheckCircle2 };
    case "pending":
      return { color: "text-amber-700", label: "Pending Review", message: "Under review. This usually takes 1–3 business days.", bg: "bg-amber-50", border: "border-amber-100", dot: "bg-amber-400", Icon: Clock };
    case "rejected":
      return { color: "text-red-700", label: "Rejected", message: "Not approved. Contact support for more details.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "paused":
      return { color: "text-slate-600", label: "Paused", message: "Paused. No broadcasts are being sent. Resume anytime.", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400", Icon: PauseCircle };
    case "token_invalid":
      return { color: "text-red-700", label: "Token Invalid", message: "Bot token is invalid. Update your bot token to continue.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "bot_deleted":
      return { color: "text-red-700", label: "Bot Deleted", message: "This bot has been deleted on Telegram.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    case "unreachable":
      return { color: "text-red-700", label: "Unreachable", message: "Bot is unreachable. Check your bot's status on Telegram.", bg: "bg-red-50", border: "border-red-100", dot: "bg-red-500", Icon: XCircle };
    default:
      return { color: "text-slate-600", label: "Unknown", message: "Status is being determined.", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400", Icon: Clock };
  }
}

export default function BotDetailsScreen({
  bot, onClose, onEdit, onToggleStatus, canToggleStatus, isResuming,
}: BotDetailsScreenProps) {
  const [webhookDetails, setWebhookDetails] = useState<WebhookDetails | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const twa = getTelegramWebApp();
    if (twa?.BackButton) {
      twa.BackButton.show();
      twa.BackButton.onClick(onClose);
      return () => {
        twa.BackButton.offClick(onClose);
        twa.BackButton.hide();
      };
    }
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/publisher/bots/${bot.id}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load webhook details");
        if (!cancelled) setWebhookDetails(data as WebhookDetails);
      })
      .catch(() => { if (!cancelled) setWebhookDetails(null); })
      .finally(() => { if (!cancelled) setWebhookLoading(false); });
    return () => { cancelled = true; };
  }, [bot.id]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function copyWebhookUrl() {
    const webhookUrl = webhookDetails?.webhook_url;
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = webhookUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1800);
  }

  const statusInfo = getStatusInfo(bot.status);
  const continents = parseStringArray(bot.continents);
  const categories = parseStringArray(bot.categories);

  const webhookStatus = webhookDetails?.webhook_status || "not_configured";
  const webhookStatusInfo = webhookStatus === "receiving_users"
    ? { label: "Receiving users", className: "bg-emerald-50 text-emerald-700 border-emerald-100", dot: "bg-emerald-500" }
    : webhookStatus === "configured"
      ? { label: "Configured", className: "bg-blue-50 text-blue-700 border-blue-100", dot: "bg-blue-500" }
      : { label: "Not configured", className: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-400" };

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
          Bot Details
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
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-4 p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50">
                <Bot size={28} className="text-[#0c9de8]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-black text-slate-900">{bot.bot_name}</p>
                {bot.bot_username && (
                  <p className="mt-0.5 text-sm font-bold text-[#0c9de8]">@{bot.bot_username}</p>
                )}
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  {(bot.active_count ?? 0).toLocaleString()} active users
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
            {(bot.paused_reason || bot.failure_reason || bot.suggested_fix) && (
              <div className="mt-3 rounded-xl bg-white/70 p-3 backdrop-blur-sm">
                {(bot.paused_reason || bot.failure_reason) && (
                  <p className="text-xs font-bold text-slate-800">
                    {bot.paused_reason || bot.failure_reason}
                  </p>
                )}
                {bot.suggested_fix && (
                  <p className="mt-1 text-xs font-medium text-slate-600">{bot.suggested_fix}</p>
                )}
              </div>
            )}
          </div>

          {/* ── User Statistics ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600">Active Users</p>
              <p className="text-2xl font-black text-emerald-700">
                {(bot.active_count ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-red-600">Blocked</p>
              <p className="text-2xl font-black text-red-700">
                {(bot.blocked_count ?? 0).toLocaleString()}
              </p>
            </div>
          </div>

          {/* ── Webhook Setup ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Webhook size={15} className="text-[#0c9de8]" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Webhook Setup</p>
              </div>
              {!webhookLoading && (
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold", webhookStatusInfo.className)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", webhookStatusInfo.dot)} />
                  {webhookStatusInfo.label}
                </span>
              )}
            </div>
            <div className="space-y-3 p-4">
              <p className="text-xs leading-5 text-slate-600">
                Copy this webhook URL and set it as your Telegram bot webhook so AdsGalaxy can track users and deliver sponsored broadcasts.
              </p>

              {webhookLoading ? (
                <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ) : webhookDetails?.webhook_url ? (
                <div className="rounded-xl border border-slate-200 bg-slate-950 p-3">
                  <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Bot Webhook URL</p>
                  <code className="block break-all text-[11px] leading-5 text-blue-100">{webhookDetails.webhook_url}</code>
                </div>
              ) : (
                <div className="rounded-xl bg-red-50 px-3 py-3 text-xs font-bold text-red-700">
                  Webhook URL is unavailable. Contact support.
                </div>
              )}

              {webhookDetails?.webhook_last_update_at && (
                <p className="text-[11px] font-medium text-slate-500">
                  Last received update:{" "}
                  <span className="font-bold text-slate-700">
                    {new Date(webhookDetails.webhook_last_update_at).toLocaleString()}
                  </span>
                </p>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!webhookDetails?.webhook_url}
                  onClick={copyWebhookUrl}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0c9de8] px-3 py-3 text-xs font-black text-white transition active:scale-[0.98] disabled:opacity-50"
                >
                  {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy Webhook URL"}
                </button>
                <button
                  type="button"
                  onClick={() => openExternalUrl(setupGuideUrl)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs font-black text-[#0c9de8] transition active:scale-[0.98]"
                >
                  <ExternalLink size={15} />
                  View Setup Guide
                </button>
              </div>
            </div>
          </div>

          {/* ── General Information ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">General Information</p>
            </div>
            <div className="divide-y divide-slate-50">
              {bot.bot_username && (
                <div className="flex items-center justify-between px-4 py-3.5">
                  <span className="text-xs font-semibold text-slate-400">Username</span>
                  <span className="text-sm font-bold text-[#0c9de8]">@{bot.bot_username}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Registered</span>
                <span className="text-sm font-bold text-slate-900">
                  {new Date(bot.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* ── Monetization ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monetization</p>
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="text-xs font-semibold text-slate-400">Ad Posts / Day</span>
              <span className="text-sm font-bold text-slate-900">{bot.posts_per_day ?? "—"}</span>
            </div>
          </div>

          {/* ── Categories ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Categories</p>
            </div>
            <div className="px-4 py-3.5">
              {categories.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <span key={cat} className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700">
                      {cat}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-semibold italic text-slate-400">No categories selected</p>
              )}
            </div>
          </div>

          {/* ── Audience Coverage ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Audience Coverage</p>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3.5">
              {continents.length > 0 ? (
                continents.map((cont) => (
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
                      Edit Bot
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
