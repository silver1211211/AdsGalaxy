"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- legacy publisher monetize flow keeps large inline forms and loose API rows */

import React, { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Plus, Tv, Bot, Smartphone, CheckCircle2, Clock, XCircle, PauseCircle,
  Loader2, Users, X, ChevronLeft, Search, ExternalLink, TrendingUp, MoreVertical,
  Eye, Pause, Play, FileText, Edit3, Sparkles, ShieldCheck, Info,
} from "lucide-react";
import ChannelDetailsScreen from "@/components/publisher/ChannelDetailsScreen";
import AddChannelScreen from "@/components/publisher/AddChannelScreen";
import BotDetailsScreen from "@/components/publisher/BotDetailsScreen";
import AddBotScreen from "@/components/publisher/AddBotScreen";
import MiniAppDetailsScreen from "@/components/publisher/MiniAppDetailsScreen";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Toast from "@/components/ui/Toast";
import {
  getDefaultPostingTimes,
  normalizePostingTimes,
  POSTING_TIME_OPTIONS,
} from "@/lib/postingTimes";
import {
  validateMiniAppSubmission,
  MiniAppSubmissionValidationError,
} from "@/lib/miniappSubmissionValidation";
import {
  normalizePrivateInviteLink,
  normalizePublicChannelUsername,
  publicChannelUrl,
} from "@/lib/telegramChannelInput";
import { logPrivateChannelDiagnostic } from "@/lib/privateChannelDiagnostics";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "Crypto", "Finance", "NSFW +18", "Tech", "Gambling",
  "Entertainment", "Education", "Shopping", "Other",
];
const CONTINENTS = [
  { name: "Global",        countries: "All countries" },
  { name: "Africa",        countries: "Nigeria, South Africa, Egypt, Kenya" },
  { name: "Asia",          countries: "India, China, Japan, Indonesia" },
  { name: "Europe",        countries: "UK, Germany, France, Italy, Spain" },
  { name: "North America", countries: "USA, Canada, Mexico" },
  { name: "South America", countries: "Brazil, Argentina, Colombia" },
  { name: "Oceania",       countries: "Australia, New Zealand" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Status    = "active" | "approved" | "pending" | "rejected" | "paused" | string;
type AddType   = "channel" | "miniapp" | "bot";
type FlowStep  = "select" | "channel-privacy" | "channel-1" | "channel-verifying" | "channel-2" | "bot-1" | "bot-2" | "miniapp-1";

// ── Add options ───────────────────────────────────────────────────────────────

const ADD_OPTIONS: {
  label: string; desc: string;
  icon: React.ElementType; iconCls: string; iconBg: string;
  hoverCls: string;
  action: AddType;
}[] = [
  {
    label: "Channel", desc: "Earn from ads shown to your Telegram channel subscribers.",
    icon: Tv, iconCls: "text-[#0c9de8]", iconBg: "bg-blue-50",
    hoverCls: "hover:border-blue-200 hover:bg-blue-50/60",
    action: "channel",
  },
  {
    label: "Mini App", desc: "Integrate rewarded ads directly inside your Mini App.",
    icon: Smartphone, iconCls: "text-emerald-500", iconBg: "bg-emerald-50",
    hoverCls: "hover:border-emerald-200 hover:bg-emerald-50/60",
    action: "miniapp",
  },
  {
    label: "Bot", desc: "Broadcast sponsored ads to your bot's user base.",
    icon: Bot, iconCls: "text-violet-500", iconBg: "bg-violet-50",
    hoverCls: "hover:border-violet-200 hover:bg-violet-50/60",
    action: "bot",
  },
];

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    active:   { label: "Active",   cls: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
    approved: { label: "Active",   cls: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
    pending:  { label: "Pending",  cls: "bg-amber-100 text-amber-700",     dot: "bg-amber-400"  },
    rejected: { label: "Rejected", cls: "bg-red-100 text-red-600",         dot: "bg-red-500"    },
    paused:   { label: "Paused",   cls: "bg-slate-100 text-slate-500",     dot: "bg-slate-400"  },
  };
  const c = map[status] ?? map.pending;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
      c.cls,
    )}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n: number | string | undefined): string {
  const num = Number(n || 0);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000)     return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "No activity";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value)) return value as unknown as T;
  if (typeof value === "string") { try { return JSON.parse(value) as T; } catch {} }
  return fallback;
}

// ── Slide variants ────────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: `${dir * 100}%` }),
  center: { x: 0 },
  exit:  (dir: number) => ({ x: `${dir * -100}%` }),
};

// ── MaForm ────────────────────────────────────────────────────────────────────
// Defined outside FlowModal so React never treats it as a new component type on
// state changes, which would destroy input focus.

function getMaErrors(maName: string, maUsername: string, maBotId: string, maWebUrl: string, maMaUrl: string) {
  const u = maUsername.replace(/^@/, "").trim();
  const normUsername = u.toLowerCase();

  const name = maName.length > 0
    ? (maName.trim().length < 3 ? "Minimum 3 characters required"
      : maName.trim().length > 50 ? "Maximum 50 characters allowed" : "") : "";

  const username = maUsername.length > 0
    ? (!maUsername.trim().startsWith("@") ? "Username must start with @ (e.g. @MyAppBot)"
      : u.length < 3 ? "Minimum 3 characters required (without @)"
      : u.length > 32 ? "Must be at most 32 characters (without @)"
      : !/^[A-Za-z][A-Za-z0-9_]*$/.test(u) ? "Letters, numbers & underscores only; must start with a letter"
      : !/bot$/i.test(u) ? "Username must end with 'bot' (e.g. @MyAppBot)" : "") : "";

  const botId = maBotId.length > 0
    ? (!/^\d{9,20}$/.test(maBotId.trim()) ? "Must be a numeric Bot ID (9–20 digits)" : "") : "";

  const webUrl = maWebUrl.length > 0 ? (() => {
    try {
      const p = new URL(maWebUrl.trim());
      if (p.protocol !== "https:" || !p.hostname.includes(".")) return "Must be a valid HTTPS URL";
      const host = p.hostname.toLowerCase();
      if (host === "t.me" || host === "telegram.me" || host.endsWith(".t.me") || host.endsWith(".telegram.me")) {
        return "This must be your website's HTTPS URL from BotFather, not a t.me/telegram.me link";
      }
      return "";
    } catch { return "Must be a valid HTTPS URL"; }
  })() : "";

  const maUrl = maMaUrl.length > 0 ? (() => {
    try {
      const p = new URL(maMaUrl.trim());
      const isTme = p.protocol === "https:" && (p.hostname === "t.me" || p.hostname === "telegram.me");
      const isTg  = p.protocol === "tg:" && p.hostname === "resolve";
      if (!isTme && !isTg) return "Must be a t.me/BotName/app or tg:// link";
      if (isTme) {
        const parts = p.pathname.split("/").filter(Boolean);
        const domain = (parts[0] || "").toLowerCase();
        const hasAppPath = parts.length >= 2;
        const hasStartApp = p.searchParams.has("startapp");
        if (!domain || (!hasAppPath && !hasStartApp)) return "Format: https://t.me/MyAppBot/AppName";
        if (normUsername && domain !== normUsername) return "URL must match the Mini App Username";
      }
      return "";
    } catch { return "Must be a valid Mini App link"; }
  })() : "";

  return { name, username, botId, webUrl, maUrl };
}

type BotVerifyStatus = "idle" | "loading" | "ok" | "mismatch" | "notfound" | "error";

function MaForm({ maName, setMaName, maUsername, setMaUsername, maBotId, setMaBotId, maWebUrl, setMaWebUrl, maMaUrl, setMaMaUrl, isLoading, onSubmit }: {
  maName: string; setMaName: (v: string) => void;
  maUsername: string; setMaUsername: (v: string) => void;
  maBotId: string; setMaBotId: (v: string) => void;
  maWebUrl: string; setMaWebUrl: (v: string) => void;
  maMaUrl: string; setMaMaUrl: (v: string) => void;
  isLoading: boolean; onSubmit: () => void;
}) {
  const errs = getMaErrors(maName, maUsername, maBotId, maWebUrl, maMaUrl);
  const anyErr = Object.values(errs).some(Boolean);
  const allFilled = !!(maName.trim() && maUsername.trim() && maBotId.trim() && maWebUrl.trim() && maMaUrl.trim());

  const [botVerify, setBotVerify] = useState<{ status: BotVerifyStatus; message: string }>({ status: "idle", message: "" });
  const [urlVerify, setUrlVerify]   = useState<{ status: BotVerifyStatus; message: string }>({ status: "idle", message: "" });
  const [maUrlVerify, setMaUrlVerify] = useState<{ status: BotVerifyStatus; message: string }>({ status: "idle", message: "" });
  const verifyTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlVerifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maUrlVerifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bot ID verification
  useEffect(() => {
    if (verifyTimer.current) clearTimeout(verifyTimer.current);

    const u = maUsername.replace(/^@/, "").trim();
    const idOk = /^\d{9,20}$/.test(maBotId.trim());
    const userOk = u.length >= 3 && u.length <= 32 && /^[A-Za-z][A-Za-z0-9_]*$/.test(u) && /bot$/i.test(u);

    if (!userOk || !idOk) {
      setBotVerify({ status: "idle", message: "" });
      return;
    }

    setBotVerify({ status: "loading", message: "" });
    verifyTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/telegram/verify-bot?username=${encodeURIComponent(u)}`);
        const data = await res.json();
        if (!res.ok) {
          setBotVerify({ status: "notfound", message: data.error || "Bot not found on Telegram" });
          return;
        }
        if (String(data.id) !== maBotId.trim()) {
          setBotVerify({ status: "mismatch", message: `Bot ID doesn't match @${data.username || u}` });
          return;
        }
        setBotVerify({ status: "ok", message: `Verified: @${data.username || u}` });
      } catch {
        setBotVerify({ status: "error", message: "Could not reach verification service" });
      }
    }, 700);

    return () => { if (verifyTimer.current) clearTimeout(verifyTimer.current); };
  }, [maUsername, maBotId]);

  // Web App URL reachability check
  useEffect(() => {
    if (urlVerifyTimer.current) clearTimeout(urlVerifyTimer.current);

    let parsed: URL | null = null;
    try { parsed = new URL(maWebUrl.trim()); } catch { /* invalid url */ }

    const urlOk = parsed && parsed.protocol === "https:" && parsed.hostname.includes(".");
    if (!urlOk || !maWebUrl.trim()) {
      setUrlVerify({ status: "idle", message: "" });
      return;
    }

    setUrlVerify({ status: "loading", message: "" });
    urlVerifyTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/verify-url?url=${encodeURIComponent(maWebUrl.trim())}`);
        const data = await res.json();
        if (!res.ok) {
          setUrlVerify({ status: "notfound", message: data.error || "URL is not reachable" });
          return;
        }
        setUrlVerify({ status: "ok", message: "URL is reachable" });
      } catch {
        setUrlVerify({ status: "error", message: "Could not check URL" });
      }
    }, 900);

    return () => { if (urlVerifyTimer.current) clearTimeout(urlVerifyTimer.current); };
  }, [maWebUrl]);

  // Direct Mini App URL reachability check
  useEffect(() => {
    if (maUrlVerifyTimer.current) clearTimeout(maUrlVerifyTimer.current);

    let parsed: URL | null = null;
    try { parsed = new URL(maMaUrl.trim()); } catch { /* invalid url */ }

    const urlOk = parsed && parsed.protocol === "https:" && parsed.hostname.includes(".");
    if (!urlOk || !maMaUrl.trim()) {
      setMaUrlVerify({ status: "idle", message: "" });
      return;
    }

    setMaUrlVerify({ status: "loading", message: "" });
    maUrlVerifyTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/verify-url?url=${encodeURIComponent(maMaUrl.trim())}`);
        const data = await res.json();
        if (!res.ok) {
          setMaUrlVerify({ status: "notfound", message: data.error || "URL is not reachable" });
          return;
        }
        setMaUrlVerify({ status: "ok", message: "URL is reachable" });
      } catch {
        setMaUrlVerify({ status: "error", message: "Could not check URL" });
      }
    }, 900);

    return () => { if (maUrlVerifyTimer.current) clearTimeout(maUrlVerifyTimer.current); };
  }, [maMaUrl]);

  const botVerifyOk  = botVerify.status === "ok" || botVerify.status === "error";
  const urlVerifyOk  = urlVerify.status === "ok" || urlVerify.status === "error";
  const maUrlVerifyOk = maUrlVerify.status === "ok" || maUrlVerify.status === "error";
  const canSubmit = allFilled && !anyErr && !isLoading && botVerifyOk && urlVerifyOk && maUrlVerifyOk;

  const inputCls = (err: string, verified?: boolean) => cn(
    "w-full px-4 py-3 bg-slate-50 rounded-2xl focus:bg-white transition-all outline-none text-sm font-semibold text-slate-900 border",
    err ? "border-red-300 focus:ring-2 focus:ring-red-300/30"
      : verified ? "border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
      : "border-transparent focus:ring-2 focus:ring-emerald-500/20"
  );

  const botIdBorderErr  = errs.botId || botVerify.status === "mismatch" || botVerify.status === "notfound" ? "err" : "";
  const urlBorderErr    = errs.webUrl || urlVerify.status === "notfound" ? "err" : "";
  const maUrlBorderErr  = errs.maUrl || maUrlVerify.status === "notfound" ? "err" : "";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mini App Name</label>
        <input type="text" value={maName} onChange={e => setMaName(e.target.value)} placeholder="e.g. My Awesome App" className={inputCls(errs.name)} />
        {errs.name && <p className="text-[11px] font-bold text-red-500 pl-1">{errs.name}</p>}
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bot Username</label>
        <input type="text" value={maUsername} onChange={e => setMaUsername(e.target.value)} placeholder="e.g. @MyAppBot" className={inputCls(errs.username)} />
        {errs.username && <p className="text-[11px] font-bold text-red-500 pl-1">{errs.username}</p>}
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bot ID</label>
        <div className="relative">
          <input
            type="text"
            value={maBotId}
            onChange={e => setMaBotId(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 987654321"
            className={inputCls(botIdBorderErr, botVerify.status === "ok")}
          />
          {botVerify.status === "loading" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 size={16} className="animate-spin text-slate-400" />
            </span>
          )}
          {botVerify.status === "ok" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs font-black">✓</span>
          )}
        </div>
        {errs.botId && <p className="text-[11px] font-bold text-red-500 pl-1">{errs.botId}</p>}
        {!errs.botId && botVerify.status === "ok" && (
          <p className="text-[11px] font-bold text-emerald-600 pl-1">{botVerify.message}</p>
        )}
        {!errs.botId && (botVerify.status === "mismatch" || botVerify.status === "notfound") && (
          <p className="text-[11px] font-bold text-red-500 pl-1">{botVerify.message}</p>
        )}
        {!errs.botId && botVerify.status === "error" && (
          <p className="text-[11px] font-bold text-amber-500 pl-1">{botVerify.message} — check ID manually</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Web App URL
          <span title="The HTTPS website configured as your Mini App in BotFather. This is the URL required by AdsGram and most Telegram Mini App ad networks.">
            <Info size={12} className="text-slate-300" />
          </span>
        </label>
        <div className="relative">
          <input
            type="url"
            value={maWebUrl}
            onChange={e => setMaWebUrl(e.target.value)}
            placeholder="e.g. https://myapp.example.com"
            className={inputCls(urlBorderErr, urlVerify.status === "ok")}
          />
          {urlVerify.status === "loading" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 size={16} className="animate-spin text-slate-400" />
            </span>
          )}
          {urlVerify.status === "ok" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs font-black">✓</span>
          )}
        </div>
        {errs.webUrl && <p className="text-[11px] font-bold text-red-500 pl-1">{errs.webUrl}</p>}
        {!errs.webUrl && urlVerify.status === "ok" && (
          <p className="text-[11px] font-bold text-emerald-600 pl-1">{urlVerify.message}</p>
        )}
        {!errs.webUrl && urlVerify.status === "notfound" && (
          <p className="text-[11px] font-bold text-red-500 pl-1">{urlVerify.message}</p>
        )}
        {!errs.webUrl && urlVerify.status === "error" && (
          <p className="text-[11px] font-bold text-amber-500 pl-1">{urlVerify.message} — check manually</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Telegram Mini App URL
          <span title="The Telegram launch link for your Mini App.">
            <Info size={12} className="text-slate-300" />
          </span>
        </label>
        <div className="relative">
          <input
            type="url"
            value={maMaUrl}
            onChange={e => setMaMaUrl(e.target.value)}
            placeholder="e.g. https://t.me/MyAppBot/MyAppBot"
            className={inputCls(maUrlBorderErr, maUrlVerify.status === "ok")}
          />
          {maUrlVerify.status === "loading" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 size={16} className="animate-spin text-slate-400" />
            </span>
          )}
          {maUrlVerify.status === "ok" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs font-black">✓</span>
          )}
        </div>
        {errs.maUrl && <p className="text-[11px] font-bold text-red-500 pl-1">{errs.maUrl}</p>}
        {!errs.maUrl && maUrlVerify.status === "ok" && (
          <p className="text-[11px] font-bold text-emerald-600 pl-1">{maUrlVerify.message}</p>
        )}
        {!errs.maUrl && maUrlVerify.status === "notfound" && (
          <p className="text-[11px] font-bold text-red-500 pl-1">{maUrlVerify.message}</p>
        )}
        {!errs.maUrl && maUrlVerify.status === "error" && (
          <p className="text-[11px] font-bold text-amber-500 pl-1">{maUrlVerify.message} — check manually</p>
        )}
      </div>
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className={cn("w-full py-3.5 font-black rounded-2xl flex items-center justify-center gap-2 text-sm mt-2", canSubmit ? "shiny-btn text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed")}
      >
        {isLoading && <Loader2 className="animate-spin" size={20} />}
        Submit for Review
      </button>
    </div>
  );
}

// ── FlowModal ─────────────────────────────────────────────────────────────────

function FlowModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  // navigation
  const [step, setStep]         = useState<FlowStep>("select");
  const [slideDir, setSlideDir] = useState<1 | -1>(1);

  // channel state
  const [chIsPrivate, setChIsPrivate] = useState(false);
  const [chUsername,  setChUsername]  = useState("");
  const [chInviteLink, setChInviteLink] = useState("");
  const [chInfo,      setChInfo]      = useState<any>(null);
  const [chVerifyState, setChVerifyState] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [chVerifyError, setChVerifyError] = useState("");
  const [chTitle,     setChTitle]     = useState("");
  const [chPPD,       setChPPD]       = useState(1);
  const [chTimes,     setChTimes]     = useState<string[]>(() => getDefaultPostingTimes(1));
  const [chTimesOrd,  setChTimesOrd]  = useState<string[]>(() => getDefaultPostingTimes(1));
  const [chTimesErr,  setChTimesErr]  = useState("");
  const [chCats,      setChCats]      = useState<string[]>([]);
  const [chConts,     setChConts]     = useState<string[]>([]);

  // bot state
  const [botToken,    setBotToken]    = useState("");
  const [botInfo,     setBotInfo]     = useState<any>(null);
  const [botPPD,      setBotPPD]      = useState(1);
  const [botCats,     setBotCats]     = useState<string[]>([]);
  const [botConts,    setBotConts]    = useState<string[]>([]);
  const [tokenVerify, setTokenVerify] = useState<{ status: "idle" | "loading" | "ok" | "error"; message: string }>({ status: "idle", message: "" });
  const tokenVerifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // miniapp state
  const [maName,      setMaName]      = useState("");
  const [maUsername,  setMaUsername]  = useState("");
  const [maBotId,     setMaBotId]     = useState("");
  const [maWebUrl,    setMaWebUrl]    = useState("");
  const [maMaUrl,     setMaMaUrl]     = useState("");

  // channel input validation (computed)
  const normalizedChInviteLink = normalizePrivateInviteLink(chInviteLink);
  const normalizedChUsername = normalizePublicChannelUsername(chUsername);
  const chInviteLinkErr = chInviteLink.length > 0 && !normalizedChInviteLink
    ? "Must be a valid invite link (e.g. https://t.me/+xxxxxxxxxxxx)"
    : "";
  const chUsernameErr = chUsername.length > 0 && !normalizedChUsername
    ? "Enter a username, @username, or https://t.me/username"
    : "";

  // shared UI
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error"; title: string; message: string;
  } | null>(null);
  const [permModal, setPermModal] = useState({ isOpen: false, message: "" });

  // channel-1 bot-admin pre-check ("idle"|"checking"|"ok"|"failed")
  const [botAdminCheck, setBotAdminCheck] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [botAdminError, setBotAdminError] = useState("");
  const [botPermissions, setBotPermissions] = useState<{
    is_admin?: boolean;
    can_post_messages?: boolean;
    can_delete_messages?: boolean;
    can_invite_users?: boolean;
    can_access?: boolean;
  } | null>(null);
  const [privateVerificationToken, setPrivateVerificationToken] = useState<string | null>(null);

  useEffect(() => {
    setPrivateVerificationToken(null);
  }, [chIsPrivate, normalizedChInviteLink]);

  // Bot token inline auto-verify (debounced)
  useEffect(() => {
    if (tokenVerifyTimer.current) clearTimeout(tokenVerifyTimer.current);
    const trimmed = botToken.trim();
    if (!trimmed || !/^\d+:[A-Za-z0-9_-]{10,}$/.test(trimmed)) {
      setTokenVerify({ status: "idle", message: "" });
      return;
    }
    setTokenVerify({ status: "loading", message: "" });
    tokenVerifyTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://api.telegram.org/bot${trimmed}/getMe`);
        const data = await res.json();
        if (!data.ok) {
          setTokenVerify({ status: "error", message: data.description || "Invalid bot token" });
          return;
        }
        setTokenVerify({ status: "ok", message: `@${data.result.username} — ${data.result.first_name}` });
      } catch {
        setTokenVerify({ status: "error", message: "Could not reach Telegram to verify" });
      }
    }, 700);
    return () => { if (tokenVerifyTimer.current) clearTimeout(tokenVerifyTimer.current); };
  }, [botToken]);

  // Auto-verify bot admin status in channel-1 step.
  // Starts polling (8 s interval) as soon as the user provides valid input.
  // Stops automatically when the bot is confirmed as admin.
  useEffect(() => {
    if (step !== "channel-1") {
      setBotAdminCheck("idle");
      setBotAdminError("");
      setBotPermissions(null);
      return;
    }

    const rawInput = chIsPrivate ? normalizedChInviteLink : normalizedChUsername;
    const inputValid = Boolean(rawInput);

    if (!rawInput || !inputValid) {
      setBotAdminCheck("idle");
      setBotAdminError("");
      setBotPermissions(null);
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    const checkBotAdmin = async () => {
      if (cancelled) return;
      setBotAdminCheck("checking");
      setBotAdminError("");
      try {
        const res = chIsPrivate
          ? await apiFetch("/api/telegram/chat-info", {
              method: "POST",
              body: JSON.stringify({ invite_link: rawInput }),
              timeoutMs: 20000,
            })
          : await apiFetch(`/api/telegram/chat-info?username=${encodeURIComponent(rawInput)}`);
        const data = await res.json();
        if (cancelled) return;
        setBotPermissions(data.permissions || null);
        if (res.ok) {
          if (chIsPrivate && data.verification_token) {
            setPrivateVerificationToken(data.verification_token);
          }
          if (chIsPrivate) {
            logPrivateChannelDiagnostic("frontend_poll_response", {
              token_received: Boolean(data.verification_token),
              token_valid: Boolean(data.verification_token),
              token_error_code: data.verification_token ? "none" : "token_missing_from_response",
              token_has_chat_id: Boolean(data.id),
              digest_match: Boolean(data.verification_token),
              submit_channel_type: "private",
              normalized_input_type: normalizedChInviteLink ? "private_invite" : "invalid_private_invite",
              final_reject_reason: data.verification_token ? "none" : "token_missing_from_response",
            });
          }
          setBotAdminCheck("ok");
          setBotAdminError("");
        } else {
          setBotAdminCheck("failed");
          setBotAdminError(data.message || data.error || "Could not verify the channel setup.");
          if (!cancelled) pollTimer = window.setTimeout(checkBotAdmin, 8000);
        }
      } catch {
        if (!cancelled) {
          setBotAdminCheck("failed");
          setBotAdminError("Verification request failed. Retrying automatically.");
          pollTimer = window.setTimeout(checkBotAdmin, 8000);
        }
      }
    };

    // Debounce initial trigger (1.2 s after the last input change)
    pollTimer = window.setTimeout(checkBotAdmin, 1200);

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [step, chIsPrivate, normalizedChInviteLink, normalizedChUsername]);

  const isSelect = step === "select";

  function go(next: FlowStep, dir: 1 | -1 = 1) {
    setSlideDir(dir);
    setStep(next);
  }

  function goBack() {
    if (step === "select")               { onClose(); return; }
    if (step === "channel-privacy" || step === "bot-1" || step === "miniapp-1") go("select", -1);
    else if (step === "channel-1" || step === "channel-verifying") go("channel-privacy", -1);
    else if (step === "channel-2")       go("channel-1", -1);
    else if (step === "bot-2")           go("bot-1", -1);
  }

  function handleSelectType(action: AddType) {
    go(action === "channel" ? "channel-privacy" : action === "bot" ? "bot-1" : "miniapp-1");
  }

  // ── Channel logic ─────────────────────────────────────────────────────────

  async function handleChFetch() {
    const canFetch = chIsPrivate ? normalizedChInviteLink : normalizedChUsername;
    if (!canFetch || isLoading) return;
    if (chIsPrivate && !normalizedChInviteLink) {
      setChVerifyState("error");
      setChVerifyError("Invalid private invite link");
      setToast({ type: "error", title: "Invalid Invite Link", message: "Use a valid Telegram invite link like https://t.me/+xxxxxxxxxxxx." });
      return;
    }
    setIsLoading(true);
    setToast(null);
    setChVerifyState("checking");
    setChVerifyError("");
    go("channel-verifying");
    try {
      const res = chIsPrivate
        ? await apiFetch("/api/telegram/chat-info", {
            method: "POST",
            body: JSON.stringify({ invite_link: normalizedChInviteLink }),
            timeoutMs: 20000,
          })
        : await apiFetch(`/api/telegram/chat-info?username=${encodeURIComponent(normalizedChUsername!)}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "PERMISSION_REQUIRED") {
          setChVerifyState("error");
          setChVerifyError(data.message || "Bot is not an administrator");
          setPermModal({ isOpen: true, message: data.message });
          return;
        }
        throw new Error(data.error || "Failed to fetch channel info");
      }
      setChInfo(data);
      if (chIsPrivate && data.verification_token) {
        setPrivateVerificationToken(data.verification_token);
      }
      if (chIsPrivate) {
        logPrivateChannelDiagnostic("frontend_verification_response", {
          token_received: Boolean(data.verification_token),
          token_valid: Boolean(data.verification_token),
          token_error_code: data.verification_token ? "none" : "token_missing_from_response",
          token_has_chat_id: Boolean(data.id),
          digest_match: Boolean(data.verification_token),
          submit_channel_type: "private",
          normalized_input_type: normalizedChInviteLink ? "private_invite" : "invalid_private_invite",
          final_reject_reason: data.verification_token ? "none" : "token_missing_from_response",
        });
      }
      setChTitle(data.title);
      setChVerifyState("success");
      window.setTimeout(() => go("channel-2"), 550);
    } catch (err: any) {
      const message = err.message || (chIsPrivate ? "Unable to access channel" : "Invalid public username");
      setChVerifyState("error");
      setChVerifyError(message);
      setToast({ type: "error", title: "Verification Failed", message });
    } finally {
      setIsLoading(false);
    }
  }

  function toggleChCat(cat: string) {
    setChCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat)
      : prev.length >= 3 ? prev
      : [...prev, cat],
    );
  }

  function toggleChCont(name: string) {
    setChConts(prev => {
      if (name === "Global") return prev.includes("Global") ? [] : CONTINENTS.map(c => c.name);
      let next = prev.includes(name)
        ? prev.filter(c => c !== name && c !== "Global")
        : [...prev, name];
      if (next.length === CONTINENTS.length - 1) next = CONTINENTS.map(c => c.name);
      return next;
    });
  }

  function handleChPPDChange(val: number) {
    setChPPD(val);
    setChTimesErr("");
    const allowed = Math.min(val, 3);
    const next    = chTimes.slice(0, allowed);
    const eff     = next.length > 0 ? next : getDefaultPostingTimes(val);
    setChTimes(eff);
    setChTimesOrd(eff);
  }

  function toggleChTime(time: string) {
    if (chTimes.includes(time)) {
      if (chTimes.length === 1) { setChTimesErr("Select at least 1 posting time"); return; }
      const next = chTimes.filter(t => t !== time);
      setChTimesErr("");
      setChTimes(next);
      setChTimesOrd(chTimesOrd.filter(t => t !== time && next.includes(t)));
      return;
    }
    const max = Math.min(chPPD, 3);
    if (chPPD === 1) { setChTimesErr(""); setChTimes([time]); setChTimesOrd([time]); return; }
    if (chTimes.length >= max) {
      setChTimesErr("");
      const cur  = chTimesOrd.filter(t => chTimes.includes(t));
      const next = [...cur.slice(1), time];
      setChTimesOrd(next);
      setChTimes(normalizePostingTimes(next, chPPD));
      return;
    }
    const next = [...chTimesOrd.filter(t => chTimes.includes(t)), time];
    setChTimesErr("");
    setChTimesOrd(next);
    setChTimes(normalizePostingTimes(next, chPPD));
  }

  async function handleChSubmit() {
    const title = chTitle.trim();
    if (title.length < 3)  { setToast({ type: "error", title: "Registration Failed", message: "Channel name must be at least 3 characters." }); return; }
    if (title.length > 50) { setToast({ type: "error", title: "Registration Failed", message: "Channel name must be at most 50 characters." }); return; }
    const verifiedChannelType = chInfo?.channel_type === "private" ? "private" : chIsPrivate ? "private" : "public";
    setIsLoading(true);
    setToast(null);
    try {
      const verificationToken = verifiedChannelType === "private"
        ? (chInfo.verification_token || privateVerificationToken)
        : null;
      if (verifiedChannelType === "private") {
        logPrivateChannelDiagnostic("frontend_channel_submit", {
          token_received: Boolean(verificationToken),
          token_valid: Boolean(verificationToken),
          token_error_code: verificationToken ? "none" : "token_missing_before_submit",
          token_has_chat_id: Boolean(chInfo.id),
          digest_match: Boolean(verificationToken && normalizedChInviteLink),
          submit_channel_type: "private",
          normalized_input_type: normalizedChInviteLink ? "private_invite" : "invalid_private_invite",
          final_reject_reason: verificationToken ? "none" : "token_missing_before_submit",
        });
      }
      const res = await apiFetch("/api/publisher/channels", {
        method: "POST",
        body: JSON.stringify({
          chat_id: chInfo.id,
          username: verifiedChannelType === "private" ? (chInfo.username || null) : chInfo.username,
          channel_type: verifiedChannelType,
          invite_link: verifiedChannelType === "private" ? normalizedChInviteLink : null,
          verification_token: verificationToken,
          subscriber_count: chInfo.subscriber_count,
          title,
          posts_per_day: chPPD,
          posting_times: chTimes,
          audience_continents: chConts,
          categories: chCats,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to add channel"); }
      onSuccess();
    } catch (err: any) {
      setToast({ type: "error", title: "Registration Failed", message: err.message });
    } finally {
      setIsLoading(false);
    }
  }

  // ── Bot logic ─────────────────────────────────────────────────────────────

  async function handleBotValidate() {
    if (!botToken || isLoading) return;
    setIsLoading(true);
    setToast(null);
    try {
      const res  = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await res.json();
      if (!data.ok) throw new Error("Invalid bot token");
      setBotInfo({ username: data.result.username, first_name: data.result.first_name });
      go("bot-2");
    } catch (err: any) {
      setToast({ type: "error", title: "Validation Failed", message: err.message });
    } finally {
      setIsLoading(false);
    }
  }

  function toggleBotCat(cat: string) {
    setBotCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat)
      : prev.length >= 3 ? prev
      : [...prev, cat],
    );
  }

  function toggleBotCont(name: string) {
    setBotConts(prev => {
      if (name === "Global") return prev.includes("Global") ? [] : CONTINENTS.map(c => c.name);
      let next = prev.includes(name)
        ? prev.filter(c => c !== name && c !== "Global")
        : [...prev, name];
      if (next.length === CONTINENTS.length - 1) next = CONTINENTS.map(c => c.name);
      return next;
    });
  }

  async function handleBotSubmit() {
    setIsLoading(true);
    setToast(null);
    try {
      const res = await apiFetch("/api/publisher/bots", {
        method: "POST",
        body: JSON.stringify({
          bot_token: botToken,
          posts_per_day: botPPD,
          continents: botConts,
          categories: botCats,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to add bot"); }
      onSuccess();
    } catch (err: any) {
      setToast({ type: "error", title: "Registration Failed", message: err.message });
    } finally {
      setIsLoading(false);
    }
  }

  // ── Mini App logic ────────────────────────────────────────────────────────

  async function handleMaSubmit() {
    setToast(null);
    try {
      validateMiniAppSubmission({
        miniapp_name: maName,
        miniapp_username: maUsername,
        bot_id: maBotId,
        webapp_url: maWebUrl,
        miniapp_url: maMaUrl,
      });
    } catch (err: any) {
      setToast({
        type: "error",
        title: err instanceof MiniAppSubmissionValidationError ? "Invalid Details" : "Validation Failed",
        message: err.message,
      });
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/publisher/miniapps", {
        method: "POST",
        body: JSON.stringify({
          miniapp_name: maName,
          miniapp_username: maUsername,
          bot_id: maBotId,
          webapp_url: maWebUrl,
          miniapp_url: maMaUrl,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to submit Mini App"); }
      onSuccess();
    } catch (err: any) {
      setToast({ type: "error", title: "Submission Failed", message: err.message });
    } finally {
      setIsLoading(false);
    }
  }

  const botAdminLink = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot"}?startchannel&admin=post_messages+edit_messages+delete_messages+invite_users`;

  return (
    <>
      <style>{`
        .shiny-btn {
          background: linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%);
          box-shadow: 0 4px 16px rgba(12,157,232,0.32);
          transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
        }
        .shiny-btn:hover {
          background: linear-gradient(135deg, #3dbfff 0%, #0c9de8 100%);
          box-shadow: 0 6px 24px rgba(12,157,232,0.52);
          transform: translateY(-1px);
        }
        .shiny-btn:active {
          transform: translateY(0);
          box-shadow: 0 2px 8px rgba(12,157,232,0.28);
        }
      `}</style>

      {/* ── Overlay ── */}
      <div
        className="fixed inset-0 z-50 flex flex-col justify-end items-center"
        onClick={isSelect ? onClose : undefined}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        {/* ── SELECT bottom sheet ── */}
        <AnimatePresence>
          {isSelect && (
            <motion.div
              key="select-panel"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="relative z-10 w-full max-w-lg rounded-t-3xl bg-white px-5 pt-5 pb-8 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-base font-black uppercase tracking-tight text-slate-900">Add Asset</h2>
                <button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
              <p className="mb-5 text-xs text-slate-400">Choose what you want to monetize</p>
              <div className="grid grid-cols-3 gap-3">
                {ADD_OPTIONS.map(opt => (
                  <button
                    key={opt.action}
                    onClick={() => handleSelectType(opt.action)}
                    className={cn(
                      "group flex flex-col items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition-all active:scale-[0.97]",
                      opt.hoverCls,
                    )}
                  >
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", opt.iconBg)}>
                      <opt.icon size={22} className={opt.iconCls} />
                    </div>
                    <p className="text-[13px] font-black text-slate-900">{opt.label}</p>
                    <p className="text-[10px] leading-relaxed text-slate-400">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── FORM panel (channel / bot steps) ── */}
        <AnimatePresence>
          {!isSelect && (
            <motion.div
              key="form-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="relative z-10 w-full max-w-lg h-[92vh] bg-white rounded-t-3xl flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0 border-b border-slate-100">
                <button
                  onClick={goBack}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex-1" />
                <button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Sliding content area */}
              <div className="relative flex-1 overflow-hidden">
                <AnimatePresence initial={false} custom={slideDir}>
                  <motion.div
                    key={step}
                    custom={slideDir}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: "spring", damping: 28, stiffness: 250 }}
                    className="absolute inset-0 overflow-y-auto"
                  >

                    {/* ──────── CHANNEL PRIVACY PICKER ──────── */}
                    {step === "channel-privacy" && (
                      <div className="p-6 space-y-6">
                        <div className="space-y-3">
                          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                            <Tv size={28} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">Channel Type</h2>
                            <p className="text-sm text-slate-500">Choose how AdsGalaxy should connect to your Telegram channel.</p>
                          </div>
                        </div>

                        <div className="grid gap-3 pt-2">
                          {[
                            {
                              isPrivate: false,
                              title: "Public Telegram Channel",
                              desc: "Has a @username - searchable and open to everyone.",
                              Icon: Users,
                            },
                            {
                              isPrivate: true,
                              title: "Private Telegram Channel",
                              desc: "Invite-only - connect securely using your invite link.",
                              Icon: TrendingUp,
                            },
                          ].map(({ isPrivate, title, desc, Icon }) => (
                            <button
                              key={title}
                              onClick={() => { setChIsPrivate(isPrivate); go("channel-1"); }}
                              className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                            >
                              <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                                <Icon size={20} />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{title}</p>
                                <p className="text-xs text-slate-400 font-medium mt-0.5">{desc}</p>
                              </div>
                              <ChevronLeft size={16} className="text-slate-300 group-hover:text-[#0c9de8] rotate-180 shrink-0 transition-colors" />
                            </button>
                          ))}
                        </div>

                        <p className="text-center text-[11px] text-slate-400 font-medium pt-2">
                          Both public and private channels can earn from ads. AdsGalaxy keeps channel type private from advertisers.
                        </p>
                      </div>
                    )}

                    {/* ──────── CHANNEL STEP 1 ──────── */}
                    {step === "channel-1" && (
                      <div className="p-6 space-y-8">
                        <div className="space-y-4">
                          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                            <Tv size={28} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">
                              {chIsPrivate ? "Connect Private Channel" : "Connect Public Channel"}
                            </h2>
                            <p className="text-sm text-slate-500">
                              {chIsPrivate
                                ? "Paste your private Telegram channel invite link. AdsGalaxy uses this only to verify and connect your channel."
                                : "Enter a username, @username, or full t.me link for your public Telegram channel."}
                            </p>
                          </div>
                          <div className="space-y-2 pt-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                              {chIsPrivate ? "Private channel invite link" : "Public channel username or link"}
                            </label>
                            {chIsPrivate ? (
                              <>
                                <input
                                  type="url"
                                  value={chInviteLink}
                                  onChange={e => setChInviteLink(e.target.value)}
                                  placeholder="https://t.me/+xxxxxxxxxxxx"
                                  className={cn(
                                    "w-full px-4 py-3 bg-slate-50 rounded-2xl focus:bg-white transition-all outline-none font-bold text-base text-slate-900 border",
                                    chInviteLinkErr
                                      ? "border-red-300 focus:ring-2 focus:ring-red-300/30"
                                      : chInviteLink && !chInviteLinkErr
                                        ? "border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                                        : "border-transparent focus:ring-2 focus:ring-violet-500/20"
                                  )}
                                />
                                {chInviteLinkErr && (
                                  <p className="text-[11px] font-bold text-red-500 pl-1 mt-1">{chInviteLinkErr}</p>
                                )}
                                {chInviteLink && !chInviteLinkErr && (
                                  <p className="text-[11px] font-bold text-emerald-600 pl-1 mt-1">Valid invite link</p>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="relative">
                                  <input
                                    type="text"
                                    value={chUsername}
                                    onChange={e => setChUsername(e.target.value)}
                                    placeholder="yourchannel, @yourchannel, or https://t.me/yourchannel"
                                    className={cn(
                                      "w-full px-4 py-3 bg-slate-50 rounded-2xl focus:bg-white transition-all outline-none font-bold text-base text-slate-900 border",
                                      chUsernameErr
                                        ? "border-red-300 focus:ring-2 focus:ring-red-300/30"
                                        : chUsername && !chUsernameErr
                                          ? "border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                                          : "border-transparent focus:ring-2 focus:ring-blue-500/20"
                                    )}
                                  />
                                </div>
                                {chUsernameErr && (
                                  <p className="text-[11px] font-bold text-red-500 pl-1 mt-1">{chUsernameErr}</p>
                                )}
                                {chUsername && !chUsernameErr && (
                                  <p className="text-[11px] font-bold text-emerald-600 pl-1 mt-1">Valid username</p>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* ── Setup Checklist (live bot-admin verification) ── */}
                        {(() => {
                          const items = chIsPrivate
                            ? [
                                "Add AdsGalaxy Bot as administrator",
                                "Allow posting messages",
                                "Allow deleting messages",
                                "Invite link must be valid",
                                "Allow adding members for view tracking",
                                "Bot must be able to access the private channel",
                              ]
                            : [
                                "Add AdsGalaxy Bot as administrator",
                                "Allow posting messages",
                                "Allow deleting messages",
                                "Channel must be accessible by username",
                              ];

                          type ItemStatus = "idle" | "checking" | "ok" | "failed";
                          const getStatus = (index: number): ItemStatus => {
                            // "Invite link must be valid" is verified client-side
                            if (chIsPrivate && index === 3) {
                              if (!chInviteLink.trim()) return "idle";
                              return chInviteLinkErr ? "failed" : "ok";
                            }
                            const permissionKey = chIsPrivate
                              ? (["is_admin", "can_post_messages", "can_delete_messages", null, "can_invite_users", "can_access"] as const)[index]
                              : (["is_admin", "can_post_messages", "can_delete_messages", "can_access"] as const)[index];
                            if (!permissionKey) return "idle";

                            const value = botPermissions?.[permissionKey];
                            if (value === true) return "ok";
                            if (value === false && botAdminCheck === "failed") return "failed";
                            if (botAdminCheck === "checking") return "checking";
                            return "idle";
                          };

                          return (
                            <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                              <div>
                                <p className="font-black text-xs uppercase tracking-widest text-[#0c9de8]">
                                  Setup Checklist
                                </p>
                                <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                                  Add AdsGalaxy Bot as admin. Permissions are verified automatically.
                                </p>
                              </div>

                              <div className="grid gap-2">
                                {items.map((item, index) => {
                                  const s = getStatus(index);
                                  return (
                                    <div
                                      key={item}
                                      className={cn(
                                        "flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold transition-colors",
                                        s === "ok"                    && "text-emerald-700",
                                        s === "failed"                && "text-red-600",
                                        (s === "idle" || s === "checking") && "text-slate-600",
                                      )}
                                    >
                                      {s === "idle"     && <div className="h-[15px] w-[15px] shrink-0 rounded-full border-2 border-slate-200" />}
                                      {s === "checking" && <Loader2 size={15} className="text-[#0c9de8] animate-spin shrink-0" />}
                                      {s === "ok"       && <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
                                      {s === "failed"   && <XCircle size={15} className="text-red-500 shrink-0" />}
                                      {item}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Status hint below list */}
                              {botAdminCheck === "checking" && (
                                <p className="text-[11px] font-medium text-slate-400">
                                  Checking bot permissions…
                                </p>
                              )}
                              {botAdminCheck === "failed" && (
                                <p className="text-[11px] font-bold text-red-500">
                                  {botAdminError || "Could not verify the channel setup."} We&apos;ll recheck automatically every 8 seconds.
                                </p>
                              )}
                              {botAdminCheck === "ok" && (
                                <p className="text-[11px] font-bold text-emerald-600">
                                  Bot admin confirmed. You can now proceed.
                                </p>
                              )}

                              <a
                                href={botAdminLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 w-full py-3 bg-[#0c9de8] text-white rounded-2xl text-sm font-black hover:bg-blue-600 transition-all"
                              >
                                Add Bot as Admin <ExternalLink size={16} />
                              </a>
                            </div>
                          );
                        })()}

                        {/* Verify button — gated on confirmed bot admin status */}
                        {(() => {
                          const inputMissing = chIsPrivate
                            ? !chInviteLink.trim() || !!chInviteLinkErr
                            : !chUsername.trim() || !!chUsernameErr;
                          const isDisabled = isLoading || inputMissing || botAdminCheck !== "ok";
                          const label = isLoading
                            ? "Verifying…"
                            : botAdminCheck === "checking"
                              ? "Checking Bot Admin…"
                              : botAdminCheck === "failed"
                                ? "Fix Channel Setup"
                                : chIsPrivate
                                  ? "Verify Private Channel"
                                  : "Verify Public Channel";
                          return (
                            <button
                              onClick={handleChFetch}
                              disabled={isDisabled}
                              className={cn(
                                "w-full py-3.5 font-black rounded-2xl flex items-center justify-center gap-2 text-sm",
                                isDisabled ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "shiny-btn text-white",
                              )}
                            >
                              {isLoading || botAdminCheck === "checking"
                                ? <Loader2 className="animate-spin" size={20} />
                                : <Search size={20} />
                              }
                              {label}
                            </button>
                          );
                        })()}
                      </div>
                    )}

                    {/* ──────── CHANNEL STEP 2 ──────── */}
                    {step === "channel-verifying" && (
                      <div className="p-6 space-y-8">
                        <div className="space-y-4">
                          <div className={cn(
                            "w-14 h-14 rounded-2xl flex items-center justify-center",
                            chVerifyState === "success" ? "bg-emerald-50 text-emerald-600" :
                            chVerifyState === "error" ? "bg-red-50 text-red-600" : "bg-blue-50 text-[#0c9de8]"
                          )}>
                            {chVerifyState === "success" ? <CheckCircle2 size={28} /> :
                              chVerifyState === "error" ? <XCircle size={28} /> :
                              <Loader2 size={28} className="animate-spin" />}
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">Verifying Channel</h2>
                            <p className="text-sm text-slate-500">
                              {chVerifyState === "success"
                                ? "Channel connected successfully"
                                : chVerifyState === "error"
                                  ? chVerifyError || "Unable to access channel"
                                  : "Checking your channel setup and bot permissions."}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          {[
                            "Checking channel access",
                            "Confirming bot admin permissions",
                            "Validating posting permissions",
                            "Preparing monetization setup",
                          ].map((item, index) => {
                            const done = chVerifyState === "success";
                            const failed = chVerifyState === "error" && index === 0;
                            return (
                              <div key={item} className="flex items-center gap-3 rounded-xl bg-white px-3 py-3 text-sm font-bold text-slate-600">
                                {failed ? (
                                  <XCircle size={17} className="text-red-500" />
                                ) : done ? (
                                  <CheckCircle2 size={17} className="text-emerald-500" />
                                ) : (
                                  <Loader2 size={17} className="animate-spin text-[#0c9de8]" />
                                )}
                                {item}
                              </div>
                            );
                          })}
                        </div>

                        {chVerifyState === "error" && (
                          <button
                            onClick={() => go("channel-1", -1)}
                            className="w-full py-3.5 bg-slate-900 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                          >
                            Back to Channel Setup
                          </button>
                        )}
                      </div>
                    )}

                    {step === "channel-2" && (
                      <div className="p-6 space-y-8 pb-12">
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                            <CheckCircle2 size={28} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">Configure</h2>
                            <p className="text-sm text-slate-500">
                              {chInfo?.username ? `Reviewing @${chInfo.username}` : `Reviewing "${chInfo?.title || "Private Channel"}"`}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Display Name</label>
                            <input
                              type="text"
                              value={chTitle}
                              onChange={e => setChTitle(e.target.value)}
                              className="w-full px-4 py-2.5 bg-slate-50 border-none rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/20 outline-none transition-all font-bold text-slate-900"
                            />
                          </div>
                          <div className="space-y-1 opacity-60">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chat ID</label>
                            <div className="px-4 py-2.5 bg-slate-100 rounded-xl font-mono text-xs font-bold text-slate-600 truncate">
                              {chInfo?.id}
                            </div>
                          </div>
                        </div>

                        {/* PPD slider */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block text-center">Post Frequency (Per Day)</label>
                          <div className="relative w-full max-w-[320px] h-10 bg-slate-100 p-1 rounded-full flex items-center mx-auto">
                            <motion.div
                              className="absolute h-8 bg-white rounded-full shadow-sm"
                              initial={false}
                              animate={{
                                left: `${(chPPD - 1) * 33.333}%`,
                                width: "33.333%",
                                x: chPPD === 1 ? 4 : chPPD === 2 ? 0 : -4,
                              }}
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            />
                            {[1, 2, 3].map(n => (
                              <button
                                key={n}
                                onClick={() => handleChPPDChange(n)}
                                className={cn(
                                  "relative z-10 flex-1 h-full flex items-center justify-center font-black text-xs transition-colors duration-300",
                                  chPPD === n ? "text-[#0c9de8]" : "text-slate-400",
                                )}
                              >
                                {n} {n === 1 ? "post" : "posts"}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] font-bold tracking-tighter text-center">
                            <span className="text-[#0c9de8]">Tip:</span>{" "}
                            <span className="text-slate-400">1–2 posts for maximum engagement</span>
                          </p>
                        </div>

                        {/* Posting times */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Posting Times</label>
                          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                            {POSTING_TIME_OPTIONS.map(time => (
                              <button
                                key={time}
                                onClick={() => toggleChTime(time)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all border",
                                  chTimes.includes(time)
                                    ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                    : "bg-white border-slate-200 text-slate-400 hover:border-blue-200",
                                )}
                              >
                                {time}
                              </button>
                            ))}
                          </div>
                          <p className={cn("text-[10px] font-bold tracking-tighter", chTimesErr ? "text-red-500" : "text-slate-400")}>
                            {chTimesErr || `Select ${chPPD === 1 ? "1 time" : `up to ${chPPD} times`} in 30-minute intervals.`}
                          </p>
                        </div>

                        {/* Categories */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Channel Categories (Max 3)</label>
                          <div className="flex flex-wrap gap-2">
                            {CATEGORIES.map(cat => (
                              <button
                                key={cat}
                                onClick={() => toggleChCat(cat)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all border",
                                  chCats.includes(cat)
                                    ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                    : "bg-white border-slate-200 text-slate-400 hover:border-blue-200",
                                )}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Audience */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Audience</label>
                          <div className="grid grid-cols-1 gap-2">
                            {CONTINENTS.map(cont => (
                              <button
                                key={cont.name}
                                onClick={() => toggleChCont(cont.name)}
                                className={cn(
                                  "px-5 py-3 text-sm font-bold rounded-2xl transition-all flex flex-col items-start gap-1 text-left border-2",
                                  chConts.includes(cont.name)
                                    ? "bg-blue-50 border-blue-500/30 text-blue-700"
                                    : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100",
                                )}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="font-black text-base">{cont.name}</span>
                                  {chConts.includes(cont.name) && <CheckCircle2 size={18} />}
                                </div>
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-wider",
                                  chConts.includes(cont.name) ? "text-blue-400" : "text-slate-400",
                                )}>
                                  {cont.countries}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          onClick={handleChSubmit}
                          disabled={
                            isLoading ||
                            chConts.length === 0 ||
                            chCats.length === 0 ||
                            chTimes.length === 0 ||
                            chTimes.length > chPPD
                          }
                          className="w-full py-3.5 bg-[#0c9de8] hover:bg-blue-600 disabled:bg-slate-200 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                        >
                          {isLoading && <Loader2 className="animate-spin" size={20} />}
                          Complete Registration
                        </button>
                      </div>
                    )}

                    {/* ──────── BOT STEP 1 ──────── */}
                    {step === "bot-1" && (
                      <div className="p-6 space-y-8">
                        <div className="space-y-4">
                          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-[#0c9de8]">
                            <Bot size={28} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">Add your Bot</h2>
                            <p className="text-sm text-slate-500">Monetize your Telegram bot by serving ads.</p>
                          </div>
                          <div className="space-y-2 pt-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Bot API Token</label>
                            <div className="relative">
                              <input
                                type="text"
                                value={botToken}
                                onChange={e => setBotToken(e.target.value)}
                                placeholder="123456789:ABCDefGhIjKlMnOpQrStUvWxYz"
                                className={cn(
                                  "w-full px-4 py-3 pr-10 bg-slate-50 rounded-2xl focus:bg-white transition-all outline-none font-mono text-sm text-slate-900 border",
                                  tokenVerify.status === "error"
                                    ? "border-red-300 focus:ring-2 focus:ring-red-300/30"
                                    : tokenVerify.status === "ok"
                                      ? "border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                                      : "border-transparent focus:ring-2 focus:ring-blue-500/20"
                                )}
                              />
                              {tokenVerify.status === "loading" && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                                  <Loader2 size={16} className="animate-spin text-slate-400" />
                                </span>
                              )}
                              {tokenVerify.status === "ok" && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-500">✓</span>
                              )}
                              {tokenVerify.status === "error" && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-red-500">✕</span>
                              )}
                            </div>
                            {tokenVerify.status === "ok" && (
                              <p className="text-[11px] font-bold text-emerald-600 pl-1">✓ {tokenVerify.message}</p>
                            )}
                            {tokenVerify.status === "error" && (
                              <p className="text-[11px] font-bold text-red-500 pl-1">{tokenVerify.message}</p>
                            )}
                            {tokenVerify.status === "idle" && (
                              <p className="text-[10px] text-slate-400 font-medium">
                                Get this token from{" "}
                                <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-[#0c9de8] underline">
                                  @BotFather
                                </a>.
                              </p>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={handleBotValidate}
                          disabled={!botToken || isLoading}
                          className={cn(
                            "w-full py-3.5 font-black rounded-2xl flex items-center justify-center gap-2 text-sm",
                            (!botToken || isLoading)
                              ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                              : "shiny-btn text-white"
                          )}
                        >
                          {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                          Continue to Configuration
                        </button>
                      </div>
                    )}

                    {/* ──────── MINI APP STEP 1 ──────── */}
                    {step === "miniapp-1" && (
                      <div className="p-6 space-y-6 pb-12">
                        <div className="space-y-3">
                          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                            <Smartphone size={28} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">Add Mini App</h2>
                            <p className="text-sm text-slate-500">Submit your Telegram Mini App for monetization review.</p>
                          </div>
                        </div>

                        <MaForm
                          maName={maName} setMaName={setMaName}
                          maUsername={maUsername} setMaUsername={setMaUsername}
                          maBotId={maBotId} setMaBotId={setMaBotId}
                          maWebUrl={maWebUrl} setMaWebUrl={setMaWebUrl}
                          maMaUrl={maMaUrl} setMaMaUrl={setMaMaUrl}
                          isLoading={isLoading} onSubmit={handleMaSubmit}
                        />
                      </div>
                    )}

                    {/* ──────── BOT STEP 2 ──────── */}
                    {step === "bot-2" && (
                      <div className="p-6 space-y-8 pb-12">
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                            <CheckCircle2 size={28} />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">{botInfo?.first_name || "Configure Bot"}</h2>
                            <p className="text-sm text-slate-500">@{botInfo?.username}</p>
                          </div>
                        </div>

                        {/* PPD slider */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block text-center">Post Frequency (Per Day)</label>
                          <div className="relative w-full max-w-[320px] h-10 bg-slate-100 p-1 rounded-full flex items-center mx-auto">
                            <motion.div
                              className="absolute h-8 bg-white rounded-full shadow-sm"
                              initial={false}
                              animate={{
                                left: `${(botPPD - 1) * 33.333}%`,
                                width: "33.333%",
                                x: botPPD === 1 ? 4 : botPPD === 2 ? 0 : -4,
                              }}
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            />
                            {[1, 2, 3].map(n => (
                              <button
                                key={n}
                                onClick={() => setBotPPD(n)}
                                className={cn(
                                  "relative z-10 flex-1 h-full flex items-center justify-center font-black text-xs transition-colors duration-300",
                                  botPPD === n ? "text-[#0c9de8]" : "text-slate-400",
                                )}
                              >
                                {n} {n === 1 ? "post" : "posts"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Categories */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bot Categories (Max 3)</label>
                          <div className="flex flex-wrap gap-2">
                            {CATEGORIES.map(cat => (
                              <button
                                key={cat}
                                onClick={() => toggleBotCat(cat)}
                                className={cn(
                                  "px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all border",
                                  botCats.includes(cat)
                                    ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                    : "bg-white border-slate-200 text-slate-400 hover:border-blue-200",
                                )}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Audience */}
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Audience</label>
                          <div className="grid grid-cols-1 gap-2">
                            {CONTINENTS.map(cont => (
                              <button
                                key={cont.name}
                                onClick={() => toggleBotCont(cont.name)}
                                className={cn(
                                  "px-5 py-3 text-sm font-bold rounded-2xl transition-all flex flex-col items-start gap-1 text-left border-2",
                                  botConts.includes(cont.name)
                                    ? "bg-blue-50 border-blue-500/30 text-blue-700"
                                    : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100",
                                )}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="font-black text-base">{cont.name}</span>
                                  {botConts.includes(cont.name) && <CheckCircle2 size={18} />}
                                </div>
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-wider",
                                  botConts.includes(cont.name) ? "text-blue-400" : "text-slate-400",
                                )}>
                                  {cont.countries}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          onClick={handleBotSubmit}
                          disabled={isLoading || botConts.length === 0 || botCats.length === 0}
                          className="w-full py-3.5 bg-[#0c9de8] hover:bg-blue-600 disabled:bg-slate-200 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                        >
                          {isLoading && <Loader2 className="animate-spin" size={20} />}
                          Complete Registration
                        </button>
                      </div>
                    )}

                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modals rendered outside the overlay so they sit above z-50 */}
      <ConfirmationModal
        isOpen={permModal.isOpen}
        onClose={() => setPermModal(p => ({ ...p, isOpen: false }))}
        onConfirm={() => setPermModal(p => ({ ...p, isOpen: false }))}
        title="Admin Required"
        message={permModal.message}
        confirmBtnText="I've added the bot"
        closeBtnText="Close"
      />
      <Toast
        isOpen={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || "success"}
        title={toast?.title || ""}
        message={toast?.message || ""}
      />
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MonetizePage() {
  const { setTitle } = useHeader();
  const [channels,  setChannels]  = useState<any[]>([]);
  const [miniapps,  setMiniapps]  = useState<any[]>([]);
  const [bots,      setBots]      = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showFlow,  setShowFlow]  = useState(false);
  const [openMenu,     setOpenMenu]     = useState<string | null>(null);
  const [viewingChannel,  setViewingChannel]  = useState<any | null>(null);
  const [editingChannel,  setEditingChannel]  = useState<any | null>(null);
  const [viewingBot,      setViewingBot]      = useState<any | null>(null);
  const [editingBot,      setEditingBot]      = useState<any | null>(null);
  const [viewingMiniApp,  setViewingMiniApp]  = useState<any | null>(null);
  const [editingMiniApp,  setEditingMiniApp]  = useState<any | null>(null);

  // mini app edit form state
  const [maEditName,    setMaEditName]    = useState("");
  const [maEditUser,    setMaEditUser]    = useState("");
  const [maEditBotId,   setMaEditBotId]   = useState("");
  const [maEditWebUrl,  setMaEditWebUrl]  = useState("");
  const [maEditMaUrl,   setMaEditMaUrl]   = useState("");
  const [maEditLoading, setMaEditLoading] = useState(false);
  const [processingId,   setProcessingId]   = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);

  async function handleToggleChannelStatus(ch: any) {
    const key = `ch-${ch.id}`;
    setProcessingId(key);
    setOpenMenu(null);
    try {
      const res = await apiFetch(`/api/publisher/channels/${ch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "toggle_status" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      refetch();
      setToast({ type: "success", title: "Status Updated", message: "Channel status updated successfully." });
    } catch (err: any) {
      setToast({ type: "error", title: "Update Failed", message: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleToggleBotStatus(bot: any) {
    const key = `bt-${bot.id}`;
    setProcessingId(key);
    setOpenMenu(null);
    try {
      const res  = await apiFetch(`/api/publisher/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ action: "toggle_status" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      refetch();
      setToast({ type: "success", title: "Status Updated", message: "Bot status updated successfully." });
    } catch (err: any) {
      setToast({ type: "error", title: "Update Failed", message: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleToggleMiniAppStatus(app: any) {
    const key = `ma-${app.id}`;
    setProcessingId(key);
    setOpenMenu(null);
    try {
      const res  = await apiFetch(`/api/publisher/miniapps/${app.id}`, { method: "PATCH", body: JSON.stringify({ action: "toggle_status" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      refetch();
      setToast({ type: "success", title: "Status Updated", message: "Mini App status updated successfully." });
    } catch (err: any) {
      setToast({ type: "error", title: "Update Failed", message: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleMaUpdate() {
    if (!editingMiniApp) return;
    setMaEditLoading(true);
    try {
      const res  = await apiFetch(`/api/publisher/miniapps/${editingMiniApp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ miniapp_name: maEditName, miniapp_username: maEditUser, bot_id: maEditBotId, webapp_url: maEditWebUrl, miniapp_url: maEditMaUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update Mini App");
      setEditingMiniApp(null);
      refetch();
      setToast({ type: "success", title: "Updated", message: "Mini App updated and resubmitted for review." });
    } catch (err: any) {
      setToast({ type: "error", title: "Update Failed", message: err.message });
    } finally {
      setMaEditLoading(false);
    }
  }

  useEffect(() => {
    if (editingMiniApp) {
      setMaEditName(editingMiniApp.miniapp_name || "");
      setMaEditUser(editingMiniApp.miniapp_username || "");
      setMaEditBotId(String(editingMiniApp.bot_id || ""));
      setMaEditWebUrl(editingMiniApp.webapp_url || "");
      setMaEditMaUrl(editingMiniApp.miniapp_url || "");
    }
  }, [editingMiniApp]);

  const canReactivate = (status: string) =>
    ["paused", "bot_removed", "channel_not_found", "permission_missing"].includes(status);

  function refetch() {
    Promise.all([
      apiFetch("/api/publisher/channels").then(r => r.ok ? r.json() : []).catch(() => []),
      apiFetch("/api/publisher/miniapps").then(r => r.ok ? r.json() : []).catch(() => []),
      apiFetch("/api/publisher/bots").then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([ch, ma, bt]) => {
      setChannels(Array.isArray(ch) ? ch : []);
      setMiniapps(Array.isArray(ma) ? ma : []);
      setBots(Array.isArray(bt) ? bt : []);
    });
  }

  useEffect(() => {
    setTitle("Monetize");
    Promise.all([
      apiFetch("/api/publisher/channels").then(r => r.ok ? r.json() : []).catch(() => []),
      apiFetch("/api/publisher/miniapps").then(r => r.ok ? r.json() : []).catch(() => []),
      apiFetch("/api/publisher/bots").then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([ch, ma, bt]) => {
      setChannels(Array.isArray(ch) ? ch : []);
      setMiniapps(Array.isArray(ma) ? ma : []);
      setBots(Array.isArray(bt) ? bt : []);
      setLoading(false);
    });
  }, []);

  const isEmpty    = !loading && !channels.length && !miniapps.length && !bots.length;
  const total      = channels.length + miniapps.length + bots.length;
  const totalActive = !loading
    ? channels.filter(c => ["active","approved"].includes(c.status)).length
    + miniapps.filter(m => ["approved", "monetized"].includes(m.status)).length
    + bots.filter(b => b.status === "active").length
    : 0;
  const totalPending = !loading
    ? channels.filter(c => c.status === "pending").length
    + miniapps.filter(m => m.status === "pending").length
    + bots.filter(b => b.status === "pending").length
    : 0;

  return (
    <DashboardLayout type="publisher">
      {showFlow && (
        <FlowModal
          onClose={() => setShowFlow(false)}
          onSuccess={() => { setShowFlow(false); refetch(); }}
        />
      )}
      {openMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
      )}

      <AnimatePresence>
        {viewingChannel && (
          <ChannelDetailsScreen
            channel={viewingChannel}
            onClose={() => setViewingChannel(null)}
            onEdit={() => { setViewingChannel(null); setEditingChannel(viewingChannel); }}
            onToggleStatus={() => { handleToggleChannelStatus(viewingChannel); setViewingChannel(null); }}
            canToggleStatus={viewingChannel.status === "active" || canReactivate(viewingChannel.status)}
            isResuming={canReactivate(viewingChannel.status)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingChannel && (
          <AddChannelScreen
            channel={editingChannel}
            onClose={() => setEditingChannel(null)}
            onSuccess={() => { setEditingChannel(null); refetch(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingBot && (
          <BotDetailsScreen
            bot={viewingBot}
            onClose={() => setViewingBot(null)}
            onEdit={() => { setViewingBot(null); setEditingBot(viewingBot); }}
            onToggleStatus={() => { handleToggleBotStatus(viewingBot); setViewingBot(null); }}
            canToggleStatus={!["pending", "deleted"].includes(viewingBot.status)}
            isResuming={canReactivate(viewingBot.status)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingBot && (
          <AddBotScreen
            bot={editingBot}
            onClose={() => setEditingBot(null)}
            onSuccess={() => { setEditingBot(null); refetch(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingMiniApp && (
          <MiniAppDetailsScreen
            miniapp={viewingMiniApp}
            onClose={() => setViewingMiniApp(null)}
            onEdit={() => { setViewingMiniApp(null); setEditingMiniApp(viewingMiniApp); }}
            onToggleStatus={() => { handleToggleMiniAppStatus(viewingMiniApp); setViewingMiniApp(null); }}
            canToggleStatus={!["pending", "deleted"].includes(viewingMiniApp.status)}
            isResuming={viewingMiniApp.status === "paused"}
          />
        )}
      </AnimatePresence>

      {/* Edit Mini App inline sheet */}
      <AnimatePresence>
        {editingMiniApp && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-16 left-0 right-0 bottom-0 z-[55] bg-white flex flex-col"
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0 border-b border-slate-100">
              <button
                onClick={() => setEditingMiniApp(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <p className="font-black text-slate-900 text-sm uppercase tracking-tight flex-1">Edit Mini App</p>
              <button onClick={() => setEditingMiniApp(null)} className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <MaForm
                maName={maEditName}        setMaName={setMaEditName}
                maUsername={maEditUser}    setMaUsername={setMaEditUser}
                maBotId={maEditBotId}      setMaBotId={setMaEditBotId}
                maWebUrl={maEditWebUrl}    setMaWebUrl={setMaEditWebUrl}
                maMaUrl={maEditMaUrl}      setMaMaUrl={setMaEditMaUrl}
                isLoading={maEditLoading}  onSubmit={handleMaUpdate}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      <Toast
        isOpen={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || "success"}
        title={toast?.title || ""}
        message={toast?.message || ""}
      />

      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="relative overflow-hidden rounded-[2rem] bg-white p-5 shadow-xl shadow-blue-100/50 border border-blue-100">
          <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[#0c9de8]/15 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#0c9de8]">
                <Sparkles size={12} />
                Publisher studio
              </div>
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight text-slate-950">Monetize</h1>
                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Channels, bots, and mini apps in one earning stack</p>
              </div>
            </div>
            <button
              onClick={() => setShowFlow(true)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0c9de8] text-white shadow-lg shadow-[#0c9de8]/25 transition-all hover:bg-blue-500 active:scale-95"
              aria-label="Add asset"
            >
              <Plus size={21} />
            </button>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Assets", value: total, icon: ShieldCheck },
              { label: "Active", value: totalActive, icon: CheckCircle2 },
              { label: "Review", value: totalPending, icon: Clock },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <item.icon size={14} className="text-[#0c9de8]" />
                <p className="mt-2 text-lg font-black text-slate-950">{item.value}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-[#0c9de8]" size={28} />
          </div>
        )}

        {/* ── Empty state ── */}
        {isEmpty && (
          <div className="rounded-3xl border border-slate-100 bg-white p-8 space-y-6 text-center shadow-sm">
            <div className="flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-blue-50 to-[#0c9de8]/10">
                <TrendingUp size={36} className="text-[#0c9de8]" />
              </div>
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Start earning with AdsGalaxy</h3>
              <p className="mt-1.5 text-[13px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                Monetize your Telegram channels, mini apps, and bots by showing relevant ads to your audience.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-left">
              {ADD_OPTIONS.map(opt => (
                <button
                  key={opt.action}
                  onClick={() => setShowFlow(true)}
                  className={cn(
                    "flex flex-col items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition-all active:scale-[0.97]",
                    opt.hoverCls,
                  )}
                >
                  <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", opt.iconBg)}>
                    <opt.icon size={20} className={opt.iconCls} />
                  </div>
                  <p className="text-[13px] font-black text-slate-900">{opt.label}</p>
                  <p className="text-[10px] leading-relaxed text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowFlow(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0c9de8] px-6 py-3 text-sm font-black uppercase tracking-wide text-white shadow hover:bg-blue-500 transition-colors"
            >
              <Plus size={15} />
              Add your first asset
            </button>
          </div>
        )}

        {/* ── Summary strip ── */}
        {!loading && !isEmpty && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-500">
              {total} asset{total !== 1 ? "s" : ""}
            </span>
            {totalActive > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {totalActive} active
              </span>
            )}
            {totalPending > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {totalPending} pending review
              </span>
            )}
          </div>
        )}

        {/* ── Pending notice ── */}
        {!loading && totalPending > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
            <Clock className="mt-0.5 shrink-0 text-amber-500" size={14} />
            <p className="text-xs font-medium text-amber-700 leading-relaxed">
              Assets under review are checked by our team — usually takes{" "}
              <span className="font-bold">1–3 business days</span>.
            </p>
          </div>
        )}

        {/* ── Channels ── */}
        {!loading && channels.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
              <Tv size={13} className="shrink-0 text-[#0c9de8]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Channels</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{channels.length}</span>
            </div>
            <div className="space-y-2">
              {channels.map(ch => {
                const cats = parseJSON<string[]>(ch.categories, []);
                return (
                  <div key={ch.id} className="rounded-3xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm space-y-3 transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/50">
                    {/* Top row */}
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50">
                        <Tv size={19} className="text-[#0c9de8]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-black text-slate-900">{ch.title}</p>
                         {ch.username && publicChannelUrl(ch.username) && (
                           <a href={publicChannelUrl(ch.username)!} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-[#0c9de8] hover:underline">
                             @{ch.username}<ExternalLink size={10} />
                           </a>
                         )}
                      </div>
                      <StatusBadge status={ch.status} />
                      <div className="relative shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setOpenMenu(openMenu === `ch-${ch.id}` ? null : `ch-${ch.id}`); }}
                          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                        >
                          <MoreVertical size={15} />
                        </button>
                        {openMenu === `ch-${ch.id}` && (
                          <div className="absolute right-0 bottom-full mb-1 z-20 w-52 rounded-2xl bg-white shadow-xl border border-slate-100 overflow-hidden">
                            <button
                              onClick={() => { setOpenMenu(null); setViewingChannel(ch); }}
                              className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <FileText size={15} className="text-slate-400 shrink-0" />
                              View Details
                            </button>
                            <div className="border-t border-slate-100" />
                            <button
                              onClick={() => { setOpenMenu(null); setEditingChannel(ch); }}
                              className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <Edit3 size={15} className="text-slate-400 shrink-0" />
                              Edit Channel
                            </button>
                            <div className="border-t border-slate-100" />
                            <button
                              disabled={(ch.status !== "active" && !canReactivate(ch.status)) || processingId === `ch-${ch.id}`}
                              onClick={() => handleToggleChannelStatus(ch)}
                              className={cn(
                                "flex items-center gap-3 w-full px-4 py-3 text-xs font-bold transition-colors",
                                 (ch.status !== "active" && !canReactivate(ch.status)) || processingId === `ch-${ch.id}`
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              {processingId === `ch-${ch.id}` ? (
                                <><Loader2 size={15} className="animate-spin shrink-0" />Processing...</>
                              ) : canReactivate(ch.status) ? (
                                <><Play size={15} className="text-emerald-500 shrink-0" />Resume Channel</>
                              ) : (
                                <><Pause size={15} className="text-slate-400 shrink-0" />Pause Channel</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Stats row */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-50 pt-2.5 text-[11px] font-semibold text-slate-500">
                      <span className="flex items-center gap-1">
                        <Users size={11} />
                        {formatCount(ch.subscriber_count)} subscribers
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>{ch.posts_per_day ?? 1}/day</span>
                      {cats.length > 0 && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>{cats.slice(0, 2).join(", ")}{cats.length > 2 ? ` +${cats.length - 2}` : ""}</span>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                        <span>{formatCount(ch.total_impressions)} impressions</span>
                        <span className="text-slate-300">·</span>
                        <span>{formatCount(ch.total_clicks)} clicks</span>
                        <span className="text-slate-300">·</span>
                        <span>{Number(ch.total_impressions) > 0 ? (Number(ch.total_clicks || 0) / Number(ch.total_impressions) * 100).toFixed(1) : "0.0"}% CTR</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-bold text-emerald-600">${Number(ch.total_revenue || 0).toFixed(4)} earned</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Mini Apps ── */}
        {!loading && miniapps.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
              <Smartphone size={13} className="shrink-0 text-emerald-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mini Apps</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{miniapps.length}</span>
            </div>
            <div className="space-y-2">
              {miniapps.map(app => {
                const hasActivity = Number(app.total_clicks) > 0 || Number(app.total_impressions) > 0;
                return (
                  <div key={app.id} className="rounded-3xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm space-y-3 transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/50">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50">
                        <Smartphone size={19} className="text-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-black text-slate-900">{app.miniapp_name}</p>
                        {app.miniapp_username && <p className="text-[11px] text-slate-400">@{app.miniapp_username}</p>}
                      </div>
                      <StatusBadge status={app.status} />
                      <div className="relative shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setOpenMenu(openMenu === `ma-${app.id}` ? null : `ma-${app.id}`); }}
                          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                        >
                          <MoreVertical size={15} />
                        </button>
                        {openMenu === `ma-${app.id}` && (
                          <div className="absolute right-0 bottom-full mb-1 z-20 w-52 rounded-2xl bg-white shadow-xl border border-slate-100 overflow-hidden">
                            <button
                              onClick={() => { setOpenMenu(null); setViewingMiniApp(app); }}
                              className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <FileText size={15} className="text-slate-400 shrink-0" />
                              View Details
                            </button>
                            <div className="border-t border-slate-100" />
                            <button
                              onClick={() => { setOpenMenu(null); setEditingMiniApp(app); }}
                              className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <Edit3 size={15} className="text-slate-400 shrink-0" />
                              Edit Mini App
                            </button>
                            <div className="border-t border-slate-100" />
                            <button
                              disabled={app.status === "pending" || processingId === `ma-${app.id}`}
                              onClick={() => handleToggleMiniAppStatus(app)}
                              className={cn(
                                "flex items-center gap-3 w-full px-4 py-3 text-xs font-bold transition-colors",
                                app.status === "pending" || processingId === `ma-${app.id}`
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              {processingId === `ma-${app.id}` ? (
                                <><Loader2 size={15} className="animate-spin shrink-0" />Processing...</>
                              ) : app.status === "paused" ? (
                                <><Play size={15} className="text-emerald-500 shrink-0" />Resume Mini App</>
                              ) : (
                                <><Pause size={15} className="text-slate-400 shrink-0" />Pause Mini App</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {hasActivity ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-50 pt-2.5 text-[11px] font-semibold text-slate-500">
                        <span>{formatCount(app.total_impressions)} impressions</span>
                        <span className="text-slate-300">·</span>
                        <span>{formatCount(app.total_clicks)} clicks</span>
                        <span className="text-slate-300">·</span>
                        <span>{Number(app.total_impressions) > 0 ? (Number(app.total_clicks || 0) / Number(app.total_impressions) * 100).toFixed(1) : "0.0"}% CTR</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-bold text-emerald-600">${Number(app.total_revenue || 0).toFixed(4)} earned</span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 border-t border-slate-50 pt-2.5">
                        No activity yet — integrate the SDK to start serving ads.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Bots ── */}
        {!loading && bots.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
              <Bot size={13} className="shrink-0 text-violet-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bots</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{bots.length}</span>
            </div>
            <div className="space-y-2">
              {bots.map(bot => {
                const cats = parseJSON<string[]>(bot.categories, []);
                return (
                <div key={bot.id} className="rounded-3xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm space-y-3 transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/50">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50">
                      <Bot size={19} className="text-violet-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-black text-slate-900">{bot.bot_name}</p>
                      {bot.bot_username && <p className="text-[11px] text-slate-400">@{bot.bot_username}</p>}
                    </div>
                    <StatusBadge status={bot.status} />
                    <div className="relative shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setOpenMenu(openMenu === `bt-${bot.id}` ? null : `bt-${bot.id}`); }}
                        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                      >
                        <MoreVertical size={15} />
                      </button>
                      {openMenu === `bt-${bot.id}` && (
                        <div className="absolute right-0 bottom-full mb-1 z-20 w-52 rounded-2xl bg-white shadow-xl border border-slate-100 overflow-hidden">
                          <button
                            onClick={() => { setOpenMenu(null); setViewingBot(bot); }}
                            className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <FileText size={15} className="text-slate-400 shrink-0" />
                            View Details
                          </button>
                          <div className="border-t border-slate-100" />
                          <button
                            onClick={() => { setOpenMenu(null); setEditingBot(bot); }}
                            className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Edit3 size={15} className="text-slate-400 shrink-0" />
                            Edit Bot
                          </button>
                          <div className="border-t border-slate-100" />
                          <button
                            disabled={bot.status === "pending" || processingId === `bt-${bot.id}`}
                            onClick={() => handleToggleBotStatus(bot)}
                            className={cn(
                              "flex items-center gap-3 w-full px-4 py-3 text-xs font-bold transition-colors",
                              bot.status === "pending" || processingId === `bt-${bot.id}`
                                ? "text-slate-300 cursor-not-allowed"
                                : "text-slate-700 hover:bg-slate-50"
                            )}
                          >
                            {processingId === `bt-${bot.id}` ? (
                              <><Loader2 size={15} className="animate-spin shrink-0" />Processing...</>
                            ) : canReactivate(bot.status) ? (
                              <><Play size={15} className="text-emerald-500 shrink-0" />Resume Bot</>
                            ) : (
                              <><Pause size={15} className="text-slate-400 shrink-0" />Pause Bot</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-50 pt-2.5 text-[11px] font-semibold text-slate-500">
                    <span className="flex items-center gap-1">
                      <Users size={11} />
                      {formatCount(bot.subscriber_count)} users
                    </span>
                    {Number(bot.active_count) > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-emerald-600 font-bold">{formatCount(bot.active_count)} active</span>
                      </>
                    )}
                    <span className="text-slate-300">·</span>
                    <span>{bot.posts_per_day ?? 1}/day</span>
                    {cats.length > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>{cats.slice(0, 2).join(", ")}{cats.length > 2 ? ` +${cats.length - 2}` : ""}</span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                      <span>{formatCount(bot.total_impressions)} impressions</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-bold text-emerald-600">${Number(bot.total_revenue || 0).toFixed(4)} earned</span>
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        )}

      </div>
    </DashboardLayout>
  );
}
