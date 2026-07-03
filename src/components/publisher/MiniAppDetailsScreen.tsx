"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Clock, XCircle, PauseCircle,
  Hash, Code2, Copy, ChevronDown, ExternalLink, ChevronLeft,
  Edit3, Play, Pause, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MiniAppAnalyticsDashboard from "@/components/publisher/MiniAppAnalyticsDashboard";

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
    total_requests?: number | string | null;
    fill_rate?: number | string | null;
    average_cpm?: number | string | null;
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

type CopiedCode = "id" | "header" | "body" | "bot_url" | "miniapp_url" | "webapp_url" | null;
type HelpField = "bot_url" | "miniapp_url" | "webapp_url" | null;

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

function miniAppBotUrl(username?: string | null) {
  const cleaned = String(username || "").trim().replace(/^@/, "");
  return cleaned ? `https://t.me/${cleaned}` : "";
}

function UrlInfoRow({
  label, url, helpText, isHelpOpen, onToggleHelp, copied, onCopy,
}: {
  label: string; url: string; helpText: string;
  isHelpOpen: boolean; onToggleHelp: () => void;
  copied: boolean; onCopy: () => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold text-slate-500">
          {label}
          <button
            type="button"
            onClick={onToggleHelp}
            aria-label={`What is ${label}?`}
            aria-expanded={isHelpOpen}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition",
              isHelpOpen ? "bg-blue-100 text-[#0c9de8]" : "text-slate-300 hover:text-slate-500"
            )}
          >
            <Info size={13} />
          </button>
        </span>
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 break-all text-right text-sm font-bold text-slate-900">{url}</span>
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${label}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition active:scale-95"
          >
            {copied ? <CheckCircle2 size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {isHelpOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-slate-500">
              {helpText}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
  const [showGeneralInfo, setShowGeneralInfo] = useState(false);
  const [copiedCode, setCopiedCode] = useState<CopiedCode>(null);
  const [openHelp, setOpenHelp] = useState<HelpField>(null);
  const botUrl = miniAppBotUrl(miniapp.miniapp_username);
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
            {miniapp.miniapp_name}
          </p>
          {miniapp.miniapp_username && (
            <p className="text-[11px] font-semibold text-emerald-600">@{miniapp.miniapp_username}</p>
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

          {/* ── Daily Performance ── */}
          {isValidMiniappId && <MiniAppAnalyticsDashboard miniappId={miniappId} />}

          {/* ── Integration ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
            <button
              type="button"
              onClick={() => setShowIntegrationCode(v => !v)}
              aria-expanded={showIntegrationCode}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#0c9de8] ring-1 ring-inset ring-blue-100">
                <Code2 size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-slate-900">Integration Code</span>
                <span className="block text-[11px] font-semibold text-slate-500">Mini App ID, header, and ad trigger snippets</span>
              </span>
              <ChevronDown
                size={18}
                className={cn("shrink-0 text-slate-400 transition-transform duration-200", showIntegrationCode && "rotate-180")}
              />
            </button>

            <AnimatePresence initial={false}>
              {showIntegrationCode && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-slate-100 p-4">
                    <div className="overflow-hidden rounded-2xl border border-blue-100 bg-blue-50">
                      <div className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <div className="mb-1 flex items-center gap-1.5 text-[#0c9de8]">
                            <Hash size={12} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Mini App ID</span>
                          </div>
                          <p className="font-mono text-2xl font-black text-[#0c9de8]">
                            {isValidMiniappId ? miniappId : "—"}
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold text-[#0c9de8]">
                            Use this ID in your integration code.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!isValidMiniappId}
                          onClick={() => copyCode("id", String(miniappId))}
                          aria-label="Copy Mini App ID"
                          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-2 text-[11px] font-black text-[#0c9de8] shadow-sm transition active:scale-95 disabled:opacity-50"
                        >
                          {copiedCode === "id" ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                          {copiedCode === "id" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {canUseIntegrationCode ? (
                      <>
                        <p className="text-xs font-medium leading-5 text-slate-600">
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
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-black text-[#0c9de8] transition hover:bg-blue-100 active:scale-[0.98]"
                    >
                      <ExternalLink size={14} />
                      View Full Documentation
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── General Information ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
            <button
              type="button"
              onClick={() => setShowGeneralInfo(v => !v)}
              aria-expanded={showGeneralInfo}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                <Info size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-slate-900">General Information</span>
                <span className="block text-[11px] font-semibold text-slate-500">Bot ID, URLs, and registration date</span>
              </span>
              <ChevronDown
                size={18}
                className={cn("shrink-0 text-slate-400 transition-transform duration-200", showGeneralInfo && "rotate-180")}
              />
            </button>

            <AnimatePresence initial={false}>
              {showGeneralInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="divide-y divide-slate-50 border-t border-slate-100">
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <span className="text-xs font-semibold text-slate-500">Bot ID</span>
                      <span className="font-mono text-sm font-bold text-slate-900">{miniapp.bot_id || "—"}</span>
                    </div>
                    {botUrl && (
                      <UrlInfoRow
                        label="Bot URL"
                        url={botUrl}
                        helpText="The Telegram bot users interact with."
                        isHelpOpen={openHelp === "bot_url"}
                        onToggleHelp={() => setOpenHelp(v => (v === "bot_url" ? null : "bot_url"))}
                        copied={copiedCode === "bot_url"}
                        onCopy={() => copyCode("bot_url", botUrl)}
                      />
                    )}
                    {miniapp.miniapp_url && (
                      <UrlInfoRow
                        label="Telegram Mini App URL"
                        url={miniapp.miniapp_url}
                        helpText="The Telegram launch link for your Mini App."
                        isHelpOpen={openHelp === "miniapp_url"}
                        onToggleHelp={() => setOpenHelp(v => (v === "miniapp_url" ? null : "miniapp_url"))}
                        copied={copiedCode === "miniapp_url"}
                        onCopy={() => copyCode("miniapp_url", miniapp.miniapp_url as string)}
                      />
                    )}
                    {miniapp.webapp_url && (
                      <UrlInfoRow
                        label="Web App URL"
                        url={miniapp.webapp_url}
                        helpText="The HTTPS website configured as your Mini App in BotFather. This is the URL required by AdsGram and most Telegram Mini App ad networks."
                        isHelpOpen={openHelp === "webapp_url"}
                        onToggleHelp={() => setOpenHelp(v => (v === "webapp_url" ? null : "webapp_url"))}
                        copied={copiedCode === "webapp_url"}
                        onCopy={() => copyCode("webapp_url", miniapp.webapp_url as string)}
                      />
                    )}
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <span className="text-xs font-semibold text-slate-500">Registered</span>
                      <span className="text-sm font-bold text-slate-900">
                        {new Date(miniapp.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {onEdit && (
                      <div className="px-4 py-3.5">
                        <button
                          onClick={onEdit}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 active:scale-[0.98]"
                        >
                          <Edit3 size={14} />
                          Edit Mini App
                        </button>
                      </div>
                    )}
                  </div>
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
