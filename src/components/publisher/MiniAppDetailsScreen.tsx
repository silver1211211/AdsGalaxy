"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Smartphone, CheckCircle2, Clock, XCircle, PauseCircle,
  Hash, Code2, Copy, ChevronDown, ExternalLink, ChevronLeft,
  Edit3, Play, Pause,
} from "lucide-react";
import { cn } from "@/lib/utils";

const appOrigin = (
  process.env.NEXT_PUBLIC_APP_URL
  || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL
  || "https://app.adsgalaxy.online"
).replace(/\/$/, "");

const sdkOrigin = (
  process.env.NEXT_PUBLIC_SDK_URL
  || process.env.NEXT_PUBLIC_APP_URL
  || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL
  || "https://app.adsgalaxy.online"
).replace(/\/$/, "");

const documentationUrl = `${appOrigin}/docs/publisher/miniapps#quick-start`;

interface MiniAppDetailsScreenProps {
  miniapp: {
    id: number | string;
    miniapp_name: string;
    miniapp_username?: string | null;
    status: string;
    total_impressions?: number | string | null;
    total_revenue?: number | string | null;
    bot_id?: number | string | null;
    webapp_url?: string | null;
    miniapp_url?: string | null;
    created_at: string;
  };
  onClose: () => void;
  onEdit?: () => void;
  onToggleStatus?: () => void;
  canToggleStatus?: boolean;
  isResuming?: boolean;
}

type CopiedCode = "id" | "header" | "body" | null;

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
  if (telegram?.openLink) {
    telegram.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function IntegrationCodeBlock({
  title, code, copyLabel, copied, onCopy,
}: {
  title: string; code: string; copyLabel: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">{title}</p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-white transition active:scale-95"
        >
          {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied ? "Copied" : copyLabel}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-4 text-[11px] leading-5 text-blue-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

type StatusInfo = {
  color: string; label: string; message: string;
  bg: string; border: string; dot: string;
  Icon: React.ElementType;
};

function getStatusInfo(status: string): StatusInfo {
  switch (status) {
    case "active":
    case "approved":
      return { color: "text-emerald-700", label: "Active",         message: "Your Mini App is live and serving ads.",                              bg: "bg-emerald-50", border: "border-emerald-100", dot: "bg-emerald-500", Icon: CheckCircle2 };
    case "pending":
      return { color: "text-amber-700",   label: "Pending Review", message: "Under review. This usually takes 1–3 business days.",                 bg: "bg-amber-50",   border: "border-amber-100",   dot: "bg-amber-400",  Icon: Clock        };
    case "rejected":
      return { color: "text-red-700",     label: "Rejected",       message: "Not approved. Review the reason and update your details.",             bg: "bg-red-50",     border: "border-red-100",     dot: "bg-red-500",    Icon: XCircle      };
    case "paused":
      return { color: "text-slate-600",   label: "Paused",         message: "No ads are being served. Resume anytime to start earning again.",     bg: "bg-slate-50",   border: "border-slate-200",   dot: "bg-slate-400",  Icon: PauseCircle  };
    default:
      return { color: "text-slate-600",   label: "Pending",        message: "Status is being determined.",                                         bg: "bg-slate-50",   border: "border-slate-200",   dot: "bg-slate-400",  Icon: Clock        };
  }
}

export default function MiniAppDetailsScreen({
  miniapp, onClose, onEdit, onToggleStatus, canToggleStatus, isResuming,
}: MiniAppDetailsScreenProps) {
  const [showIntegrationCode, setShowIntegrationCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState<CopiedCode>(null);
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

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function copyCode(kind: Exclude<CopiedCode, null>, code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedCode(kind);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedCode(null), 1800);
  }

  const statusInfo = getStatusInfo(miniapp.status);
  const miniappId = Number(miniapp.id);
  const isValidMiniappId = Number.isInteger(miniappId) && miniappId > 0;
  const canUseIntegrationCode = isValidMiniappId && ["active", "approved"].includes(String(miniapp.status));
  const headerCode = `<script src="${sdkOrigin}/sdk.js?id=${miniappId}"></script>`;
  const bodyCode = `<button onclick="window.showAdsGalaxy({ miniappId: ${miniappId} })">\n  Watch Ad\n</button>`;
  const formattedRevenue = Number(miniapp.total_revenue || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

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
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black uppercase tracking-tight text-slate-900">
            {miniapp.miniapp_name}
          </p>
          {miniapp.miniapp_username && (
            <p className="text-[11px] font-medium text-emerald-600">@{miniapp.miniapp_username}</p>
          )}
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
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50">
                <Smartphone size={28} className="text-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-black text-slate-900">{miniapp.miniapp_name}</p>
                {miniapp.miniapp_username && (
                  <p className="mt-0.5 text-sm font-bold text-emerald-600">@{miniapp.miniapp_username}</p>
                )}
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  Mini App #{miniappId || "—"}
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
          </div>

          {/* ── Statistics ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-blue-600">Impressions</p>
              <p className="text-2xl font-black text-blue-700">
                {Number(miniapp.total_impressions || 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600">Revenue</p>
              <p className="truncate text-xl font-black text-emerald-700" title={`$${formattedRevenue}`}>
                ${formattedRevenue}
              </p>
            </div>
          </div>

          {/* ── Mini App ID ── */}
          <div className="overflow-hidden rounded-2xl border border-blue-100 bg-blue-50">
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-1.5 text-blue-600">
                  <Hash size={12} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Mini App ID</span>
                </div>
                <p className="font-mono text-2xl font-black text-blue-800">
                  {isValidMiniappId ? miniappId : "—"}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-blue-600">
                  Use this ID in your integration code.
                </p>
              </div>
              <button
                type="button"
                disabled={!isValidMiniappId}
                onClick={() => copyCode("id", String(miniappId))}
                aria-label="Copy Mini App ID"
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-2 text-[11px] font-black text-blue-700 shadow-sm transition active:scale-95 disabled:opacity-50"
              >
                {copiedCode === "id" ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                {copiedCode === "id" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* ── General Information ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">General Information</p>
            </div>
            <div className="divide-y divide-slate-50">
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Bot ID</span>
                <span className="font-mono text-sm font-bold text-slate-900">{miniapp.bot_id || "—"}</span>
              </div>
              {miniapp.webapp_url && (
                <div className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <span className="shrink-0 text-xs font-semibold text-slate-400">Web App URL</span>
                  <span className="min-w-0 break-all text-right text-sm font-bold text-slate-900">{miniapp.webapp_url}</span>
                </div>
              )}
              {miniapp.miniapp_url && (
                <div className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <span className="shrink-0 text-xs font-semibold text-slate-400">Mini App URL</span>
                  <span className="min-w-0 break-all text-right text-sm font-bold text-slate-900">{miniapp.miniapp_url}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-xs font-semibold text-slate-400">Registered</span>
                <span className="text-sm font-bold text-slate-900">
                  {new Date(miniapp.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* ── Integration ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setShowIntegrationCode(v => !v)}
              aria-expanded={showIntegrationCode}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Code2 size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-slate-900">Integration Code</span>
                <span className="block text-[11px] font-medium text-slate-500">Header and ad trigger snippets</span>
              </span>
              <ChevronDown
                size={18}
                className={cn("shrink-0 text-slate-400 transition-transform", showIntegrationCode && "rotate-180")}
              />
            </button>

            {showIntegrationCode && (
              <div className="space-y-3 border-t border-slate-100 p-4">
                {canUseIntegrationCode ? (
                  <>
                    <p className="text-xs leading-5 text-slate-600">
                      Copy the header code into your Mini App &lt;head&gt;, then place the body code where users should trigger an ad.
                    </p>
                    <IntegrationCodeBlock
                      title="Header Code"
                      code={headerCode}
                      copyLabel="Copy Header"
                      copied={copiedCode === "header"}
                      onCopy={() => copyCode("header", headerCode)}
                    />
                    <IntegrationCodeBlock
                      title="Body Code"
                      code={bodyCode}
                      copyLabel="Copy Body"
                      copied={copiedCode === "body"}
                      onCopy={() => copyCode("body", bodyCode)}
                    />
                  </>
                ) : (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm font-bold text-amber-700">
                    Integration code becomes available after your Mini App is approved.
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => openExternalUrl(documentationUrl)}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-black text-blue-700 transition active:scale-[0.98]"
                >
                  <ExternalLink size={14} />
                  View Full Documentation
                </button>
              </div>
            )}
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
                      Edit
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
