"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, CheckCircle2, Clock, XCircle, PauseCircle,
  ChevronLeft, ChevronDown, ChevronUp, Code2, Copy, ExternalLink, Plug, Edit3, Play, Pause, UserPlus, Eye, EyeOff, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ManualAddUsersPopup from "@/components/publisher/ManualAddUsersPopup";
import TestIntegrationPopup from "@/components/publisher/TestIntegrationPopup";
import BotAnalyticsDashboard from "@/components/publisher/BotAnalyticsDashboard";

const appOrigin = (
  process.env.NEXT_PUBLIC_APP_URL
  || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL
  || "https://app.adsgalaxy.online"
).replace(/\/$/, "");

const setupGuideUrl = `${appOrigin}/docs/publisher/bots#integration`;

type PublisherBot = {
  id: number | string;
  bot_name: string;
  bot_username?: string | null;
  status: string;
  paused_reason?: string | null;
  failure_reason?: string | null;
  suggested_fix?: string | null;
  subscriber_count?: number;
  active_count?: number;
  blocked_count?: number;
  delivery_eligible_count?: number;
  successful_sends?: number;
  failed_sends?: number;
  publisher_revenue?: number;
  effective_cpm?: number;
  posts_per_day?: number;
  continents?: string | string[] | null;
  categories?: string | string[] | null;
  created_at: string;
};

type IntegrationDetails = {
  integration_url: string | null;
  integration_secret_masked: string | null;
  integration_status: "installed" | "not_installed" | "imported_pending_verification" | "active" | "error" | "disabled" | "rejected";
  integration_installed_at: string | null;
  integration_last_received_at: string | null;
  integration_last_user_id: string | null;
  integration_last_error_at: string | null;
  integration_last_error: string | null;
  integration_user_count: number;
  subscriber_count: number;
  active_count: number;
  blocked_count: number;
  delivery_eligible_count: number;
  successful_sends: number;
  failed_sends: number;
  publisher_revenue: number;
  effective_cpm: number;
  integration_events: Array<{ event_type: string; telegram_user_id: string | null; username: string | null; result: string; error: string | null; message: string; received_at: string }>;
};

type IntegrationStatus = IntegrationDetails["integration_status"];

function normalizeIntegrationStatus(value: unknown): IntegrationStatus {
  const status = String(value || "").trim().toLowerCase();
  if (status === "active" || status === "receiving_users") return "active";
  if (status === "installed") return "installed";
  if (status === "imported_pending_verification") return "imported_pending_verification";
  if (status === "error") return "error";
  if (status === "disabled") return "disabled";
  if (status === "rejected") return "rejected";
  return "not_installed";
}

function parseIntegrationDetails(value: unknown): IntegrationDetails {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    integration_url: typeof data.integration_url === "string" ? data.integration_url : null,
    integration_secret_masked: typeof data.integration_secret_masked === "string" ? data.integration_secret_masked : null,
    integration_status: normalizeIntegrationStatus(data.integration_status),
    integration_installed_at: typeof data.integration_installed_at === "string" ? data.integration_installed_at : null,
    integration_last_received_at: typeof data.integration_last_received_at === "string" ? data.integration_last_received_at : null,
    integration_last_user_id: typeof data.integration_last_user_id === "string" ? data.integration_last_user_id : null,
    integration_last_error_at: typeof data.integration_last_error_at === "string" ? data.integration_last_error_at : null,
    integration_last_error: typeof data.integration_last_error === "string" ? data.integration_last_error : null,
    integration_user_count: Number(data.integration_user_count || 0),
    subscriber_count: Number(data.subscriber_count || 0),
    active_count: Number(data.active_count || 0),
    blocked_count: Number(data.blocked_unreachable_count || data.blocked_count || 0),
    delivery_eligible_count: Number(data.delivery_eligible_count || 0),
    successful_sends: Number(data.successful_sends || data.successful_paid_deliveries || data.delivered_sends || 0),
    failed_sends: Number(data.failed_sends || 0),
    publisher_revenue: Number(data.publisher_revenue || data.total_revenue || 0),
    effective_cpm: Number(data.effective_cpm || 0),
    integration_events: Array.isArray(data.integration_events) ? data.integration_events as IntegrationDetails["integration_events"] : [],
  };
}

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
  const [integrationDetails, setIntegrationDetails] = useState<IntegrationDetails | null>(null);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [statusModal, setStatusModal] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [addUsersOpen, setAddUsersOpen] = useState(false);
  const [testPopupOpen, setTestPopupOpen] = useState(false);
  const [integrationGuideOpen, setIntegrationGuideOpen] = useState(false);
  const [generalInfoOpen, setGeneralInfoOpen] = useState(false);
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const integrationRequestId = useRef(0);

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
    const loadIntegrationDetails = () => {
      const requestId = ++integrationRequestId.current;
      return apiFetch(`/api/publisher/bots/${bot.id}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load integration details");
        if (!cancelled && requestId === integrationRequestId.current) {
          setIntegrationDetails(parseIntegrationDetails(data));
          setIntegrationError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && requestId === integrationRequestId.current) {
          setIntegrationError(error instanceof Error ? error.message : "Failed to load integration details");
        }
      })
      .finally(() => { if (!cancelled) setIntegrationLoading(false); });
    };

    void loadIntegrationDetails();
    const refreshTimer = window.setInterval(loadIntegrationDetails, 15000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadIntegrationDetails();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [bot.id, detailsRefreshKey]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function copyIntegrationUrl() {
    const integrationUrl = integrationDetails?.integration_url;
    if (!integrationUrl) return;
    try {
      await navigator.clipboard.writeText(integrationUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = integrationUrl;
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

  async function copyIntegrationSecret() {
    const url = integrationDetails?.integration_url;
    if (!url) return;
    const secret = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "";
    await navigator.clipboard.writeText(secret);
    setSecretCopied(true);
    window.setTimeout(() => setSecretCopied(false), 1800);
  }

  const integrationSnippet = `await fetch(process.env.ADSGALAXY_INTEGRATION_URL, {\n  method: "POST",\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify({\n    bot_id: "${bot.id}",\n    telegram_user_id: ctx.from.id,\n    chat_id: ctx.chat.id,\n    timestamp: Math.floor(Date.now() / 1000),\n    request_id: crypto.randomUUID()\n  })\n});`;

  async function copyIntegrationSnippet() {
    await navigator.clipboard.writeText(integrationSnippet);
    setSnippetCopied(true);
    window.setTimeout(() => setSnippetCopied(false), 1800);
  }

  async function regenerateSecret() {
    if (!window.confirm("Regenerate this Integration Secret? Existing Integration URLs will stop working.")) return;
    setRegenerating(true);
    try {
      const response = await apiFetch(`/api/publisher/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "regenerate_integration_secret" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Secret regeneration failed");
      const url = String(result.integration_url || "");
      setIntegrationDetails((current) => current ? {
        ...current,
        integration_url: url,
        integration_secret_masked: `••••••••••••${url.slice(-6)}`,
        integration_status: "not_installed",
        integration_installed_at: null,
        integration_last_received_at: null,
        integration_last_user_id: null,
      } : current);
      setStatusModal({ type: "success", title: "Secret Regenerated", message: "Integration secret regenerated" });
    } catch (error: unknown) {
      setStatusModal({ type: "error", title: "Secret Regeneration Failed", message: error instanceof Error ? error.message : "Secret regeneration failed" });
    } finally {
      setRegenerating(false);
    }
  }

  const statusInfo = getStatusInfo(bot.status);
  const continents = parseStringArray(bot.continents);
  const categories = parseStringArray(bot.categories);
  const activeUsers = integrationDetails?.active_count ?? bot.active_count ?? 0;
  const totalUsers = integrationDetails?.subscriber_count ?? bot.subscriber_count ?? 0;
  const inactiveUsers = Math.max(totalUsers - activeUsers, 0);

  const integrationStatus = normalizeIntegrationStatus(integrationDetails?.integration_status);
  const integrationStatusInfo = {
    active: { label: "Integrated", className: "bg-emerald-50 text-emerald-700 border-emerald-100", dot: "bg-emerald-500" },
    installed: { label: "Pending Verification", className: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-400" },
    imported_pending_verification: { label: "Pending Verification", className: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-400" },
    not_installed: { label: "Not Integrated", className: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-400" },
    error: { label: "Integration Error", className: "bg-red-50 text-red-700 border-red-100", dot: "bg-red-500" },
    disabled: { label: "Disabled", className: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
    rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-100", dot: "bg-red-500" },
  } satisfies Record<IntegrationStatus, { label: string; className: string; dot: string }>;
  const currentIntegrationStatusInfo = {
    ...integrationStatusInfo[integrationStatus],
    label: integrationStatus === "imported_pending_verification" ? "Pending Verification" : integrationStatusInfo[integrationStatus].label,
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black uppercase tracking-tight text-slate-900">{bot.bot_name}</p>
          {bot.bot_username && <p className="text-[11px] font-semibold text-emerald-600">@{bot.bot_username}</p>}
        </div>
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
                  {totalUsers.toLocaleString()} total users
                </p>
              </div>
            </div>
          </div>

          {/* ── Status & Approval ── */}
          {bot.status !== "active" && (
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
          )}

          {/* ── User Statistics ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600">Active Users</p>
              <p className="text-2xl font-black text-emerald-700">
                {activeUsers.toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-red-600">Inactive Users</p>
              <p className="text-2xl font-black text-red-700">
                {inactiveUsers.toLocaleString()}
              </p>
            </div>
          </div>

          <BotAnalyticsDashboard botId={bot.id} />

          {/* Bot integration guide (collapsible) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setIntegrationGuideOpen((open) => !open)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
                <Code2 size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900">Integration Code</p>
                <p className="mt-0.5 text-xs font-medium text-slate-400">Secure /start registration setup</p>
              </span>
              {integrationGuideOpen ? <ChevronUp size={18} className="shrink-0 text-slate-400" /> : <ChevronDown size={18} className="shrink-0 text-slate-400" />}
            </button>

            <AnimatePresence initial={false}>
              {integrationGuideOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-slate-100 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Plug size={15} className="text-[#0c9de8]" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Integration</p>
                      </div>
                      {!integrationLoading && (
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold", currentIntegrationStatusInfo.className)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", currentIntegrationStatusInfo.dot)} />
                          {currentIntegrationStatusInfo.label}
                        </span>
                      )}
                    </div>

                    {integrationDetails?.integration_secret_masked && (
                      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Integration Secret</p>
                          <code className="mt-1 block break-all text-xs font-bold text-slate-700">
                            {secretVisible ? new URL(integrationDetails.integration_url || "https://invalid").pathname.split("/").filter(Boolean).at(-1) : integrationDetails.integration_secret_masked}
                          </code>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setSecretVisible((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-600">
                            {secretVisible ? <EyeOff size={13} /> : <Eye size={13} />}{secretVisible ? "Hide" : "Show"}
                          </button>
                          <button type="button" onClick={copyIntegrationSecret} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-[10px] font-black text-blue-600">
                            <Copy size={13} />{secretCopied ? "Copied" : "Copy Secret"}
                          </button>
                          <button type="button" disabled={regenerating} onClick={regenerateSecret} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-[10px] font-black text-red-600 disabled:opacity-50">
                            {regenerating ? "Regenerating..." : "Regenerate"}
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="text-xs leading-5 text-slate-600">
                      Add this integration to your existing /start handler. Your webhook and bot logic stay exactly as they are.
                    </p>

                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Node.js / Telegraf</span>
                        <button type="button" onClick={copyIntegrationSnippet} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[10px] font-black text-white"><Copy size={12} />{snippetCopied ? "Copied" : "Copy code"}</button>
                      </div>
                      <pre className="overflow-x-auto p-3 text-[10px] leading-5 text-blue-100"><code>{integrationSnippet}</code></pre>
                    </div>

                    {integrationLoading ? (
                      <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                    ) : integrationDetails?.integration_url ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-950 p-3">
                        <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Integration URL</p>
                        <code className="block break-all text-[11px] leading-5 text-blue-100">{integrationDetails.integration_url}</code>
                      </div>
                    ) : integrationError ? (
                      <div className="rounded-xl bg-red-50 px-3 py-3 text-xs font-bold text-red-700">
                        {integrationError}
                      </div>
                    ) : (
                      <div className="rounded-xl bg-red-50 px-3 py-3 text-xs font-bold text-red-700">
                        Integration URL is unavailable. Contact support.
                      </div>
                    )}

                    {integrationDetails?.integration_last_received_at && (
                      <p className="text-[11px] font-medium text-slate-500">
                        Last user received:{" "}
                        <span className="font-bold text-slate-700">
                          {new Date(integrationDetails.integration_last_received_at).toLocaleString()}
                        </span>
                      </p>
                    )}

                    {integrationDetails?.integration_last_user_id && (
                      <p className="text-[11px] font-medium text-slate-500">
                        Last received user: <span className="font-bold text-slate-700">{integrationDetails.integration_last_user_id}</span>
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-blue-50 p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-blue-500">Total Users Received</p>
                        <p className="mt-1 text-xl font-black text-blue-700">{integrationDetails?.integration_user_count.toLocaleString() || "0"}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Last Activity</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-700">{integrationDetails?.integration_events[0]?.received_at ? new Date(integrationDetails.integration_events[0].received_at).toLocaleString() : "No activity"}</p>
                      </div>
                    </div>

                    {integrationDetails?.integration_last_error && (
                      <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-[11px] text-red-700">
                        <p className="font-black">Last error</p>
                        <p className="mt-1">{integrationDetails.integration_last_error}</p>
                        {integrationDetails.integration_last_error_at && <p className="mt-1 opacity-70">{new Date(integrationDetails.integration_last_error_at).toLocaleString()}</p>}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!integrationDetails?.integration_url}
                        onClick={copyIntegrationUrl}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0c9de8] px-3 py-3 text-xs font-black text-white transition active:scale-[0.98] disabled:opacity-50"
                      >
                        {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                        {copied ? "Copied" : "Copy Integration URL"}
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

                    {integrationDetails?.integration_events.length ? (
                      <div className="space-y-2 overflow-hidden border-t border-slate-100 pt-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Recent integration events</p>
                        <div className="overflow-x-auto rounded-xl border border-slate-100">
                          <table className="w-full min-w-[560px] text-left text-[10px]">
                            <thead className="bg-slate-50 text-slate-400"><tr><th className="p-2">Time</th><th className="p-2">Telegram User ID</th><th className="p-2">Username</th><th className="p-2">Result</th><th className="p-2">Error</th></tr></thead>
                            <tbody>{integrationDetails.integration_events.map((event, index) => <tr key={`${event.received_at}-${index}`} className="border-t border-slate-100"><td className="p-2 text-slate-500">{new Date(event.received_at).toLocaleString()}</td><td className="p-2 font-bold text-slate-700">{event.telegram_user_id || "—"}</td><td className="p-2 text-slate-600">{event.username || "—"}</td><td className="p-2 font-bold text-slate-700">{event.result}</td><td className="p-2 text-red-600">{event.error || "—"}</td></tr>)}</tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Installation Checklist</p>
                      <div className="mt-2 grid gap-2 text-[11px] font-bold text-slate-600 sm:grid-cols-2">
                        <span>{bot.status === "active" ? "☑" : "☐"} Bot approved</span>
                        <span>{copied ? "☑" : "☐"} Integration copied</span>
                        <span>{integrationDetails?.integration_last_received_at ? "☑" : "☐"} First user received</span>
                        <span>{bot.status === "active" && integrationDetails?.integration_last_received_at ? "☑" : "☐"} Ready for Broadcast</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Bot Users ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bot Users</p>
            </div>
            <div className="grid grid-cols-1 gap-2 p-4">
              <button
                type="button"
                onClick={() => setAddUsersOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-xs font-black text-indigo-700 transition active:scale-[0.98]"
              >
                <UserPlus size={15} />
                Manually Add Users
              </button>
              <button
                type="button"
                disabled={!integrationDetails?.integration_url}
                onClick={() => setTestPopupOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-black text-emerald-700 transition active:scale-[0.98] disabled:opacity-50"
              >
                <CheckCircle2 size={15} />
                Test Integration
              </button>
            </div>
          </div>

          {/* ── General Information ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
            <button type="button" onClick={() => setGeneralInfoOpen((open) => !open)} aria-expanded={generalInfoOpen} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200"><Info size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-slate-900">General Information</span>
                <span className="block text-[11px] font-semibold text-slate-500">Username and registration date</span>
              </span>
              <ChevronDown size={18} className={cn("shrink-0 text-slate-400 transition-transform duration-200", generalInfoOpen && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
            {generalInfoOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="divide-y divide-slate-50 overflow-hidden border-t border-slate-100">
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
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Ad Posts / Day</span>
                <span className="text-sm font-bold text-slate-900">{bot.posts_per_day ?? "—"}</span>
              </div>
              <div className="px-4 py-3.5">
                <span className="mb-2 block text-xs font-semibold text-slate-400">Categories</span>
                {categories.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {categories.map((cat) => (
                      <span key={cat} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
                        {cat}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-semibold italic text-slate-400">No categories selected</p>
                )}
              </div>
              <div className="px-4 py-3.5">
                <span className="mb-2 block text-xs font-semibold text-slate-400">Audience Coverage</span>
                <div className="flex flex-wrap gap-2">
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
              {onEdit && <div className="px-4 py-3.5"><button onClick={onEdit} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 active:scale-[0.98]"><Edit3 size={14} />Edit Bot</button></div>}
            </motion.div>}
            </AnimatePresence>
          </div>

          {/* ── Actions ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
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

      <Modal
        isOpen={!!statusModal}
        onClose={() => setStatusModal(null)}
        type={statusModal?.type || "info"}
        title={statusModal?.title}
      >
        {statusModal?.message}
      </Modal>

      <ManualAddUsersPopup
        isOpen={addUsersOpen}
        onClose={() => setAddUsersOpen(false)}
        botId={bot.id}
        onAdded={() => setDetailsRefreshKey((value) => value + 1)}
      />

      <TestIntegrationPopup
        isOpen={testPopupOpen}
        onClose={() => setTestPopupOpen(false)}
        integrationUrl={integrationDetails?.integration_url ?? null}
        botId={bot.id}
        onSuccess={() => setIntegrationDetails((current) => current
          ? { ...current, integration_status: current.integration_status === "active" ? "active" : "installed" }
          : current)}
      />
    </motion.div>
  );
}
