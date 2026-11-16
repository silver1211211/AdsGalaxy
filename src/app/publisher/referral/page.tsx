"use client";

import React, { useEffect, useState, useTransition, useCallback } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Users,
  Copy,
  Check,
  Share2,
  QrCode,
  Sparkles,
  TrendingUp,
  Wallet,
  Radio,
  Bot,
  LayoutGrid,
  ShieldCheck,
  Award,
  Calculator,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { useTranslations } from "@/i18n/client";
import { cn } from "@/lib/utils";

interface ReferralSummary {
  totalReferrals: number;
  activeReferrals: number;
  totalEarnedUsdt: string;
  thisMonthUsdt: string;
  totalEarnedRaw: number;
  thisMonthRaw: number;
}

interface ProductBreakdown {
  volume: number;
  commission: number;
  users: number;
  commissionUsdt: string;
}

interface Breakdown {
  channels: ProductBreakdown;
  miniApps: ProductBreakdown;
  bots: ProductBreakdown;
  deposits: ProductBreakdown;
}

interface Tier {
  name: string;
  min: number;
  max: number | null;
  achieved: boolean;
}

interface Achievements {
  currentTier: string;
  nextTier: string | null;
  progressPercent: number;
  tiers: Tier[];
}

interface ReferralItem {
  id: number;
  userId: number;
  name: string;
  username: string;
  joinDate: string;
  status: "active" | "joined";
  hasChannel: boolean;
  hasMiniApp: boolean;
  hasBot: boolean;
  volumeUsdt: string;
  commissionUsdt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface ApiResponse {
  earningsHistory: {
    items: Array<{ id: number; label: string; amountUsdt: string; paidAt: string }>;
    page: number;
    totalItems: number;
    totalPages: number;
  };
  summary: ReferralSummary;
  breakdown: Breakdown;
  achievements: Achievements;
  referrals: {
    items: ReferralItem[];
    pagination: Pagination;
  };
  referralCode: string;
  referralLink: string;
  sharePresets: {
    channels: string;
    miniapps: string;
    bots: string;
  };
}

// ── Helper: Premium Balance Display (Optimized for Small Mobile Screens) ──
function PremiumEarningsValue({
  valueUsdt,
  loading = false,
  compact = false,
}: {
  valueUsdt?: string;
  loading?: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-1 flex items-baseline gap-1">
        <span className="h-5 w-20 animate-pulse rounded bg-blue-100/60" />
      </div>
    );
  }

  const raw = String(valueUsdt || "0.000000 USDT").replace(/USDT/i, "").trim();
  const [intPart, decPart = "000000"] = raw.split(".");
  const primaryDec = decPart.slice(0, 2);
  const microDec = decPart.slice(2, 6);

  return (
    <div className={cn("flex flex-wrap items-baseline gap-0.5 font-mono", compact ? "mt-0.5" : "mt-1.5")}>
      <span className={cn("font-black tracking-tight text-slate-900", compact ? "text-base sm:text-xl" : "text-lg sm:text-2xl")}>
        {intPart}.{primaryDec}
      </span>
      <span className={cn("font-semibold text-slate-400 tracking-tight", compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm")}>
        {microDec}
      </span>
      <span className="ml-1 inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1 py-0.2 text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-[#0c9de8]">
        USDT
      </span>
    </div>
  );
}

export default function ReferralProgramPage() {
  const { setTitle } = useHeader();
  const { t, locale } = useTranslations();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [directLink, setDirectLink] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  // Filter & pagination state
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(10);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "joined">("all");
  const [sortBy, setSortBy] = useState<"recent" | "earnings">("recent");
  const [, startTransition] = useTransition();

  useEffect(() => {
    setTitle(t("navigation.referrals") || t("publisher.referrals.title") || "Referrals");
  }, [setTitle, t, locale]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setStatsError(false);
      const queryParams = new URLSearchParams({
        page: page.toString(),
        historyPage: historyPage.toString(),
        pageSize: pageSize.toString(),
        status: statusFilter,
        sortBy,
        ...(search ? { search } : {}),
      });

      const res = await apiFetch(`/api/publisher/referrals?${queryParams.toString()}`);
      if (!res.ok) throw new Error("referral_stats_unavailable");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to load referrals:", err);
      setData(null);
      setStatsError(true);
    } finally {
      setLoading(false);
    }
  }, [page, historyPage, pageSize, statusFilter, sortBy, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchLink = useCallback(async () => {
    try {
      setLinkError(false);
      const response = await apiFetch("/api/publisher/referral-link");
      if (!response.ok) throw new Error("referral_link_unavailable");
      const result: { referralLink?: string } = await response.json();
      if (!result.referralLink) throw new Error("referral_link_missing");
      setDirectLink(result.referralLink);
    } catch {
      setLinkError(true);
    }
  }, []);

  useEffect(() => { void fetchLink(); }, [fetchLink]);

  const copyToClipboard = (text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); });
  };

  const handleShareTelegram = (text: string, link: string) => {
    const twa = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } })
      ?.Telegram?.WebApp;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    if (twa?.openTelegramLink) {
      twa.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, "_blank");
    }
  };

  const referralLink = directLink || data?.referralLink || "";
  const shareTextHero = t("publisher.referrals.heroShareText") || "Monetize your Telegram channels, bots, and mini apps on AdsGalaxy! Earn instant payouts:";


  return (
    <DashboardLayout type="publisher">
      <div className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-6 pb-20 text-slate-800">
        {/* 1. HERO SECTION (Curve exactly matched to Dashboard rounded-[2rem]) */}
        <section
          style={{ borderRadius: "2rem" }}
          className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0284c7] via-[#0c9de8] to-[#38bdf8] p-6 sm:p-7 text-white shadow-2xl shadow-blue-950/10"
        >
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl pointer-events-none" />

          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/20 px-3 py-0.5 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-2xs backdrop-blur-md">
                <Sparkles size={11} className="text-white" />
                <span>{t("publisher.referrals.badge") || "10% Lifetime Referral Commission"}</span>
              </div>
              <h1 className="text-xl font-black tracking-tight text-white drop-shadow-2xs sm:text-3xl">
                {t("publisher.referrals.heroTitle") || "Invite Friends. Earn 10%."}
              </h1>
              <p className="max-w-md text-xs sm:text-sm font-medium leading-relaxed text-blue-50/95">
                Earn 10% of referred publishers' eligible earnings and 10% of confirmed deposits from referred advertisers.
              </p>
            </div>

            {/* Referral Link Box (Compact on Mobile) */}
            <div className="w-full max-w-md rounded-2xl border border-white/45 bg-white/25 p-3.5 backdrop-blur-xl shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-white/95">
                  {t("publisher.referrals.exclusiveLink") || "Your Exclusive Invite Link"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[8px] font-bold text-white uppercase tracking-wider">
                  <Zap size={9} /> {t("publisher.referrals.instant") || "Instant"}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 rounded-xl border border-white/80 bg-white p-1 pl-2.5 shadow-sm">
                <span className="min-w-0 flex-1 truncate text-xs font-mono font-bold text-[#0284c7]">
                  {referralLink || (linkError ? "Invite link unavailable" : "Loading your invite link...")}
                </span>
                <button
                  onClick={() => copyToClipboard(referralLink)}
                  disabled={!referralLink}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-[#0c9de8] hover:bg-[#0284c7] px-2.5 py-1.5 text-[11px] font-black text-white shadow-xs transition active:scale-95"
                >
                  {copiedLink ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedLink ? (t("publisher.referrals.copied") || "Copied") : (t("publisher.referrals.copy") || "Copy")}</span>
                </button>
              </div>

              {linkError && !referralLink && <button type="button" onClick={() => void fetchLink()} className="mt-2 text-xs font-bold text-white underline">Try loading your invite link again</button>}
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleShareTelegram(shareTextHero, referralLink)}
                  disabled={!referralLink}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider text-[#0284c7] shadow-sm transition hover:bg-blue-50 active:scale-98"
                >
                  <Share2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t("publisher.referrals.shareTelegram") || "Share in Telegram"}</span>
                </button>
                <button
                  onClick={() => setShowQrModal(true)}
                  disabled={!referralLink}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/50 bg-white/20 py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider text-white backdrop-blur-md transition hover:bg-white/30 active:scale-98"
                >
                  <QrCode className="h-3 w-3 shrink-0 text-white" />
                  <span className="truncate">{t("publisher.referrals.scanQr") || "Scan Invite QR"}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {statsError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Referral statistics are temporarily unavailable. <button type="button" className="font-bold underline" onClick={() => void fetchData()}>Try again</button></div>}

        {/* 2. FOUR SUMMARY STAT CARDS (Compact & Fitted for Small Screens) */}
        <section className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          {/* Card 1: Total Referrals */}
          <div className="rounded-2xl border border-blue-100 bg-white p-3 sm:p-4 shadow-sm transition-all hover:border-[#0c9de8]/40 hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">
                {t("publisher.referrals.totalReferrals") || "Total Referrals"}
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 border border-blue-100 text-[#0c9de8]">
                <Users className="h-3.5 w-3.5" />
              </div>
            </div>
            <p className="mt-1 text-lg sm:text-2xl font-black tracking-tight text-slate-900">
              {loading ? "..." : statsError ? "Unavailable" : (data?.summary.totalReferrals || 0).toLocaleString()}
            </p>
            <p className="mt-0.5 text-[9px] sm:text-[10px] font-medium text-slate-400 truncate">
              {t("publisher.referrals.totalInvited") || "Total invited publishers"}
            </p>
          </div>

          {/* Card 2: Active Referrals */}
          <div className="rounded-2xl border border-blue-100 bg-white p-3 sm:p-4 shadow-sm transition-all hover:border-[#0c9de8]/40 hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">
                {t("publisher.referrals.activeReferrals") || "Active Referrals"}
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 border border-blue-100 text-[#0c9de8]">
                <ShieldCheck className="h-3.5 w-3.5" />
              </div>
            </div>
            <p className="mt-1 text-lg sm:text-2xl font-black tracking-tight text-slate-900">
              {loading ? "..." : statsError ? "Unavailable" : (data?.summary.activeReferrals || 0).toLocaleString()}
            </p>
            <div className="mt-0.5 flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-[#0c9de8]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0c9de8] animate-pulse" />
              <span className="truncate">{t("publisher.referrals.monetizingAssets") || "Monetizing assets"}</span>
            </div>
          </div>

          {/* Card 3: Total Earned */}
          <div className="rounded-2xl border-2 border-[#0c9de8]/40 bg-gradient-to-b from-white to-blue-50/40 p-3 sm:p-4 shadow-sm transition-all hover:border-[#0c9de8] hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-wider text-[#0c9de8] truncate">
                {t("publisher.referrals.totalEarned") || "Total Earned"}
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#0c9de8] text-white shadow-xs">
                <Wallet className="h-3.5 w-3.5" />
              </div>
            </div>
            <PremiumEarningsValue
              valueUsdt={data?.summary.totalEarnedUsdt}
              loading={loading || statsError}
              compact={true}
            />
            <p className="mt-0.5 text-[9px] sm:text-[10px] font-medium text-slate-500 truncate">
              Paid referral earnings, including history
            </p>
          </div>

          {/* Card 4: This Month */}
          <div className="rounded-2xl border border-blue-100 bg-white p-3 sm:p-4 shadow-sm transition-all hover:border-[#0c9de8]/40 hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">
                {t("publisher.referrals.thisMonth") || "This Month"}
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 border border-blue-100 text-[#0c9de8]">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </div>
            <PremiumEarningsValue
              valueUsdt={data?.summary.thisMonthUsdt}
              loading={loading || statsError}
              compact={true}
            />
            <p className="mt-0.5 text-[9px] sm:text-[10px] font-medium text-slate-400 truncate">
              {t("publisher.referrals.currentMonth") || "Current calendar month"}
            </p>
          </div>
        </section>

        {/* 3. HOW IT WORKS */}
        <section className="rounded-2xl sm:rounded-3xl border border-blue-100 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-3.5 flex items-center justify-between">
            <div>
              <h2 className="text-sm sm:text-base font-black text-slate-900">
                {t("publisher.referrals.howItWorks") || "How It Works"}
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-500">
                {t("publisher.referrals.howItWorksSubtitle") || "Three simple steps to build passive daily income"}
              </p>
            </div>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0c9de8]">
              {t("publisher.referrals.instantCredits") || "Instant Credits"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
            <div className="flex items-start gap-3 rounded-xl border border-blue-100/80 bg-blue-50/30 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#0c9de8] font-black border border-blue-200 text-xs shadow-2xs">
                1
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-slate-900">
                  {t("publisher.referrals.step1Title") || "Share Your Link"}
                </h3>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  {t("publisher.referrals.step1Desc") || "Invite Telegram channel admins, Mini App builders, and Telegram bot owners."}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-blue-100/80 bg-blue-50/30 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#0c9de8] font-black border border-blue-200 text-xs shadow-2xs">
                2
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-slate-900">
                  They Monetize or Deposit
                </h3>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Referred publishers earn from ads, and referred advertisers fund confirmed deposits.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-blue-100/80 bg-blue-50/30 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#0c9de8] font-black border border-blue-200 text-xs shadow-2xs">
                3
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-slate-900">
                  {t("publisher.referrals.step3Title") || "You Earn 10%"}
                </h3>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Receive 10% of eligible publisher earnings and confirmed advertiser deposits.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 4. PERFORMANCE BREAKDOWN BY PRODUCT (Clean Top Row: Active Moved Up, Volume Removed) */}
        <section className="rounded-2xl sm:rounded-3xl border border-blue-100 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-3.5">
            <h2 className="text-sm sm:text-base font-black text-slate-900">
              {t("publisher.referrals.monetizationBreakdown") || "Monetization Breakdown"}
            </h2>
            <p className="text-[10px] sm:text-xs text-slate-500">
              {t("publisher.referrals.breakdownSubtitle") || "10% commission from publisher earnings and confirmed advertiser deposits"}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {/* Channels */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs transition-all hover:border-blue-200 hover:bg-blue-50/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-white p-1.5 text-[#0c9de8] border border-blue-100 shadow-2xs">
                    <Radio className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-bold text-slate-900">{t("publisher.referrals.channels") || "Channels"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-[#0c9de8] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                    {data?.breakdown.channels.users || 0} {t("publisher.referrals.active") || "active"}
                  </span>
                  <span className="text-[9px] font-black text-white rounded bg-[#0c9de8] px-1.5 py-0.5 shadow-2xs">
                    10%
                  </span>
                </div>
              </div>
              <PremiumEarningsValue
                valueUsdt={data?.breakdown.channels.commissionUsdt}
                loading={loading}
              />
            </div>

            {/* Mini Apps */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs transition-all hover:border-blue-200 hover:bg-blue-50/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-white p-1.5 text-[#0c9de8] border border-blue-100 shadow-2xs">
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-bold text-slate-900">{t("publisher.referrals.miniApps") || "Mini Apps"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-[#0c9de8] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                    {data?.breakdown.miniApps.users || 0} {t("publisher.referrals.active") || "active"}
                  </span>
                  <span className="text-[9px] font-black text-white rounded bg-[#0c9de8] px-1.5 py-0.5 shadow-2xs">
                    10%
                  </span>
                </div>
              </div>
              <PremiumEarningsValue
                valueUsdt={data?.breakdown.miniApps.commissionUsdt}
                loading={loading}
              />
            </div>

            {/* Telegram Bots */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs transition-all hover:border-blue-200 hover:bg-blue-50/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-white p-1.5 text-[#0c9de8] border border-blue-100 shadow-2xs">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-bold text-slate-900">{t("publisher.referrals.bots") || "Telegram Bots"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-[#0c9de8] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                    {data?.breakdown.bots.users || 0} {t("publisher.referrals.active") || "active"}
                  </span>
                  <span className="text-[9px] font-black text-white rounded bg-[#0c9de8] px-1.5 py-0.5 shadow-2xs">
                    10%
                  </span>
                </div>
              </div>
              <PremiumEarningsValue
                valueUsdt={data?.breakdown.bots.commissionUsdt}
                loading={loading}
              />
            </div>
            {/* Advertiser Deposits */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs transition-all hover:border-blue-200 hover:bg-blue-50/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-white p-1.5 text-[#0c9de8] border border-blue-100 shadow-2xs">
                    <Wallet className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-bold text-slate-900">Advertiser Deposits</span>
                </div>
                <span className="text-[9px] font-black text-white rounded bg-[#0c9de8] px-1.5 py-0.5 shadow-2xs">10%</span>
              </div>
              <PremiumEarningsValue valueUsdt={data?.breakdown.deposits.commissionUsdt} loading={loading} />
            </div>
          </div>
        </section>

        {/* 8. PAGINATED REFERRAL LIST (Compact Table) */}
        <section className="rounded-2xl sm:rounded-3xl border border-blue-100 bg-white p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm sm:text-base font-black text-slate-900">
                {t("publisher.referrals.yourReferrals") || "Your Referrals"}
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-500">
                {data?.referrals.pagination.totalItems || 0} {t("publisher.referrals.totalReferredUsers") || "total referred users"}
              </p>
            </div>

            {/* Filter and Search Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder={t("publisher.referrals.searchPlaceholder") || "Search referral..."}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-[11px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#0c9de8]"
                />
              </div>

              {/* Status Tabs */}
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
                {(["all", "active", "joined"] as const).map((s) => {
                  const labelMap = {
                    all: t("publisher.referrals.filterAll") || "All",
                    active: t("publisher.referrals.filterActive") || "Active",
                    joined: t("publisher.referrals.filterJoined") || "Joined",
                  };
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        setStatusFilter(s);
                        setPage(1);
                      }}
                      className={cn(
                        "rounded-lg px-2.5 py-0.5 transition font-bold",
                        statusFilter === s
                          ? "bg-[#0c9de8] text-white shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      {labelMap[s]}
                    </button>
                  );
                })}
              </div>

              {/* Sort Dropdown */}
              <button
                onClick={() => setSortBy((prev) => (prev === "recent" ? "earnings" : "recent"))}
                className="flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowUpDown className="h-3 w-3 text-[#0c9de8]" />
                <span>
                  {sortBy === "recent"
                    ? (t("publisher.referrals.sortRecent") || "Recent")
                    : (t("publisher.referrals.sortEarnings") || "Top Earnings")}
                </span>
              </button>
            </div>
          </div>

          {/* List Content */}
          <div className="mt-3 divide-y divide-slate-100">
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">
                {t("publisher.referrals.loading") || "Loading referrals..."}
              </div>
            ) : data?.referrals.items.length === 0 ? (
              <div className="py-8 text-center">
                <Users className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-1.5 text-xs font-bold text-slate-700">
                  {t("publisher.referrals.emptyTitle") || "No referrals found"}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {t("publisher.referrals.emptySubtitle") || "Share your link to begin earning 10% on every monetized asset!"}
                </p>
              </div>
            ) : (
              data?.referrals.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[11px] font-black text-[#0c9de8] border border-blue-100">
                      {item.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{item.name}</span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.2 text-[9px] font-bold",
                            item.status === "active"
                              ? "bg-blue-50 text-[#0c9de8] border border-blue-200"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {item.status === "active"
                            ? (t("publisher.referrals.statusActive") || "Active")
                            : (t("publisher.referrals.statusJoined") || "Joined")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>
                          {t("publisher.referrals.joined") || "Joined"}{" "}
                          {new Date(item.joinDate).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US")}
                        </span>
                        <div className="flex items-center gap-1 text-[9px]">
                          {item.hasChannel && <span className="rounded bg-blue-50 px-1 py-0.2 text-[#0c9de8] border border-blue-100 font-semibold">{t("publisher.referrals.channels") || "Channel"}</span>}
                          {item.hasMiniApp && <span className="rounded bg-blue-50 px-1 py-0.2 text-[#0c9de8] border border-blue-100 font-semibold">{t("publisher.referrals.miniApps") || "Mini App"}</span>}
                          {item.hasBot && <span className="rounded bg-blue-50 px-1 py-0.2 text-[#0c9de8] border border-blue-100 font-semibold">{t("publisher.referrals.bots") || "Bot"}</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 sm:border-0 sm:pt-0 sm:text-right">
                    <span className="text-[10px] text-slate-400 sm:hidden">
                      {t("publisher.referrals.shareLabel") || "10% Share:"}
                    </span>
                    <div className="flex items-baseline justify-end gap-1 font-mono">
                      <span className="text-xs font-black text-slate-900 sm:text-sm">
                        {item.commissionUsdt.replace(/USDT/i, "").trim()}
                      </span>
                      <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.2 text-[8px] font-bold text-[#0c9de8]">
                        USDT
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination Controls */}
          {data && data.referrals.pagination.totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5">
                <span>
                  {t("publisher.referrals.page") || "Page"} {data.referrals.pagination.page} {t("publisher.referrals.of") || "of"} {data.referrals.pagination.totalPages}
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as 10 | 25 | 50);
                    setPage(1);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
                >
                  <option value={10}>10 / {t("publisher.referrals.perPage") || "pg"}</option>
                  <option value={25}>25 / {t("publisher.referrals.perPage") || "pg"}</option>
                  <option value={50}>50 / {t("publisher.referrals.perPage") || "pg"}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3 w-3" />
                  <span>{t("publisher.referrals.prev") || "Prev"}</span>
                </button>
                <button
                  disabled={page >= data.referrals.pagination.totalPages}
                  onClick={() => setPage((p) => Math.min(data.referrals.pagination.totalPages, p + 1))}
                  className="flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  <span>{t("publisher.referrals.next") || "Next"}</span>
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-slate-900 sm:text-base">Referral earnings history</h2>
              <p className="text-xs text-slate-500">Paid commissions and earlier referral credits remain on record.</p>
            </div>
            <span className="text-xs font-bold text-[#0c9de8]">{data?.earningsHistory.totalItems || 0} credits</span>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {loading ? <p className="py-5 text-xs text-slate-500">Loading earnings...</p>
              : !data?.earningsHistory.items.length ? <p className="py-5 text-xs text-slate-500">No paid referral earnings yet.</p>
              : data.earningsHistory.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <div>
                    <p className="font-bold text-slate-800">{item.label}</p>
                    <p className="text-slate-400">{new Date(item.paidAt).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US")}</p>
                  </div>
                  <span className="font-mono font-black text-[#0c9de8]">{item.amountUsdt}</span>
                </div>
              ))}
          </div>
          {data && data.earningsHistory.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
              <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((value) => Math.max(1, value - 1))} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button>
              <span>Page {data.earningsHistory.page} of {data.earningsHistory.totalPages}</span>
              <button type="button" disabled={historyPage >= data.earningsHistory.totalPages} onClick={() => setHistoryPage((value) => value + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>
          )}
        </section>

        {/* 9. QR CODE MODAL (Optimized for Small Screens) */}
        {showQrModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs">
            <div className="relative w-full max-w-xs rounded-2xl border border-blue-100 bg-white p-5 text-center shadow-2xl">
              <button
                onClick={() => setShowQrModal(false)}
                className="absolute right-3 top-3 rounded-lg border border-slate-200 bg-slate-50 p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8] border border-blue-100">
                <QrCode className="h-5 w-5" />
              </div>

              <h3 className="mt-2 text-base font-black text-slate-900">
                {t("publisher.referrals.qrTitle") || "Scan Invite QR"}
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {t("publisher.referrals.qrSubtitle") || "Scan with a mobile camera or Telegram to open your direct invite link"}
              </p>

              {/* QR Image */}
              <div className="mx-auto mt-4 flex h-40 w-40 items-center justify-center rounded-xl border border-blue-100 bg-white p-2.5 shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                    referralLink
                  )}`}
                  alt="Referral QR Code"
                  className="h-full w-full"
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => copyToClipboard(referralLink)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 py-2 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  {copiedLink ? <Check className="h-3 w-3 text-[#0c9de8]" /> : <Copy className="h-3 w-3 text-[#0c9de8]" />}
                  <span>{copiedLink ? (t("publisher.referrals.copied") || "Copied") : (t("publisher.referrals.copyLink") || "Copy Link")}</span>
                </button>
                <button
                  onClick={() => handleShareTelegram(shareTextHero, referralLink)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#0c9de8] py-2 text-[11px] font-black text-white shadow-xs transition hover:bg-[#0284c7]"
                >
                  <Share2 className="h-3 w-3" />
                  <span>{t("publisher.referrals.share") || "Share"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
