"use client";

import {
  Megaphone,
  Rocket,
  ShieldCheck,
  BarChart3,
  Send,
  Bot,
  Tv,
  Wallet,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Eye,
  Menu,
  X,
  Code2,
  TrendingUp,
  Shield,
  Layers,
  Gift,
  BookOpen,
  Smartphone,
  Target,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

const BOT_LINK = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot"}`;
const CHANNEL_NAME = process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
const CHANNEL_LINK = `https://t.me/${CHANNEL_NAME}`;
const SDK_HOST = process.env.NEXT_PUBLIC_APP_URL || "https://app.adsgalaxy.online";

interface FooterSettings {
  year: string;
  brand: string;
  rights: string;
}

const FOOTER_DEFAULTS: FooterSettings = {
  year: String(new Date().getFullYear()),
  brand: "AdsGalaxy.online",
  rights: "All rights reserved.",
};

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-white/80 px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#0c9de8] shadow-sm shadow-blue-100/70 ring-1 ring-white/70 backdrop-blur">
      {children}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-14">
      <Pill>
        <Sparkles size={11} /> {eyebrow}
      </Pill>
      <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="w-full max-w-6xl xl:max-w-7xl mx-auto">
      <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Megaphone;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-2xl border border-slate-100 bg-white/90 p-6 shadow-sm shadow-slate-200/60 ring-1 ring-white transition-all duration-300 hover:-translate-y-1 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/60">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 ring-1 ring-blue-100/70 transition-transform duration-300 group-hover:scale-110">
        <Icon size={20} className="text-[#0c9de8]" />
      </div>
      <h3 className="mb-2 text-sm font-black tracking-tight text-slate-950">{title}</h3>
      <p className="text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2 size={17} className="text-[#0c9de8] shrink-0 mt-0.5" />
      <span className="text-sm text-slate-600 leading-relaxed">{children}</span>
    </div>
  );
}

function CheckItemDark({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2 size={17} className="text-blue-300 shrink-0 mt-0.5" />
      <span className="text-sm text-blue-50/90 leading-relaxed">{children}</span>
    </div>
  );
}

function PrimaryButton({
  href,
  children,
  external = true,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#0c9de8]/40 active:scale-[0.97]"
    >
      {children}
    </a>
  );
}

export default function PublicHomepage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [footer, setFooter] = useState<FooterSettings>(FOOTER_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFooter({
          year: data.footer_year || FOOTER_DEFAULTS.year,
          brand: data.footer_brand || FOOTER_DEFAULTS.brand,
          rights: data.footer_rights_text || FOOTER_DEFAULTS.rights,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const navLinks = [
    { label: "Advertisers", href: "#advertisers" },
    { label: "Publishers", href: "#publishers" },
    { label: "Developers", href: "#developers" },
    { label: "Docs", href: "/docs" },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-blue-100 selection:text-slate-950">
      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/85 shadow-sm shadow-slate-200/40 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:h-[72px] sm:px-6 xl:max-w-7xl xl:px-8">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="AdsGalaxy"
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 drop-shadow-sm"
              priority
            />
            <span className="text-lg font-black tracking-tight">
              Ads<span className="text-[#0c9de8]">Galaxy</span>
            </span>
          </div>

          <nav className="hidden items-center gap-1 rounded-full border border-slate-100 bg-slate-50/70 p-1 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-full px-4 py-2 text-sm font-bold text-slate-600 transition-colors duration-200 hover:bg-white hover:text-[#0c9de8] hover:shadow-sm"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a
              href={BOT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold text-slate-600 transition-colors duration-200 hover:text-[#0c9de8]"
            >
              Login
            </a>
            <a
              href={BOT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] px-4 py-2.5 text-sm font-black text-white shadow-md shadow-[#0c9de8]/25 transition-all duration-200 hover:-translate-y-px hover:shadow-lg hover:shadow-[#0c9de8]/35 active:scale-[0.97]"
            >
              Open App
              <ArrowRight size={14} />
            </a>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <a
              href={BOT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className={`min-h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] px-3.5 text-xs font-black text-white shadow-md shadow-[#0c9de8]/25 transition-all active:scale-[0.97] ${menuOpen ? "hidden" : "inline-flex"}`}
            >
              Open App
              <ArrowRight size={13} />
            </a>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="-mr-1 rounded-xl p-2 text-slate-700 transition-colors hover:bg-slate-100"
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="space-y-1 border-t border-slate-100 bg-white/95 px-4 py-4 shadow-xl shadow-slate-200/50 backdrop-blur-xl md:hidden">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#0c9de8]"
              >
                {link.label}
                <ArrowRight size={14} className="text-slate-300" />
              </a>
            ))}
            <div className="pt-2">
              <a
                href={BOT_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] px-4 py-3.5 text-sm font-black text-white shadow-md shadow-[#0c9de8]/25 transition-all active:scale-[0.97]"
              >
                Open App
                <ArrowRight size={14} />
              </a>
            </div>
          </div>
        )}
      </header>

      {/* ─── HERO ─── */}
      <section
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #030814 0%, #07111f 42%, #082338 100%)",
        }}
      >
        {/* Aurora glows */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "-120px",
            left: "30%",
            width: "600px",
            height: "600px",
            background: "radial-gradient(circle, rgba(19,174,245,0.30) 0%, transparent 68%)",
            filter: "blur(60px)",
            transform: "translateX(-50%)",
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: "-80px",
            right: "-60px",
            width: "400px",
            height: "400px",
            background: "radial-gradient(circle, rgba(89,198,245,0.18) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        {/* Dot grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.14]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(12,157,232,0.7) 1px, transparent 1px)",
            backgroundSize: "30px 30px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent)",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-16 text-center sm:px-6 sm:pb-32 sm:pt-24 lg:pb-36 lg:pt-28 xl:max-w-7xl xl:px-8">
          {/* Eyebrow */}
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#0c9de8]/30 bg-[#0c9de8]/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#7dd3fc] shadow-sm shadow-[#0c9de8]/10 ring-1 ring-white/5 backdrop-blur">
            <Sparkles size={11} />
            The Telegram Ad Network
          </div>

          {/* Headline */}
          <h1 className="mx-auto max-w-5xl text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl">
            Monetize and Advertise
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #13aef5 0%, #0c9de8 50%, #59c6f5 100%)",
              }}
            >
              Across Telegram
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 sm:text-lg" style={{ color: "#9bc4da" }}>
            AdsGalaxy connects advertisers with Telegram Mini Apps, Channels, and
            Bots through one powerful ad network — built for real performance and
            transparent earnings.
          </p>

          {/* CTAs */}
          <div className="mx-auto mt-10 flex w-full max-w-xl flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
            <a
              href={BOT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] px-7 py-4 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#0c9de8]/50 active:scale-[0.97]"
            >
              <Megaphone size={16} />
              Start Advertising
            </a>
            <a
              href={BOT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-7 py-4 text-sm font-black text-white backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/15 active:scale-[0.97]"
            >
              <Wallet size={16} />
              Start Monetizing
            </a>
            <a
              href="/docs"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-black transition-all duration-300 hover:bg-white/5 active:scale-[0.97]"
              style={{ color: "#8ab4cc" }}
            >
              <BookOpen size={16} />
              View Documentation
            </a>
          </div>

          {/* Platform badges */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {[
              { icon: Smartphone, label: "Mini App Ads" },
              { icon: Tv, label: "Channel Ads" },
              { icon: Bot, label: "Bot Ads" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold backdrop-blur"
                style={{ color: "#8ab4cc" }}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#0c9de8]/25" style={{ background: "rgba(12,157,232,0.12)" }}>
                  <Icon size={13} className="text-[#13aef5]" />
                </div>
                {label}
              </div>
            ))}
          </div>

          {/* Channel follow */}
          <div className="mt-7">
            <a
              href={CHANNEL_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors hover:text-[#13aef5]"
              style={{ color: "#5a8ca8" }}
            >
              <Send size={12} />
              Follow @{CHANNEL_NAME} for updates
            </a>
          </div>
        </div>
      </section>

      {/* ─── PLATFORM OVERVIEW STRIP ─── */}
      <div className="relative z-10 -mt-10 px-4 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-100 bg-white/95 p-3 shadow-2xl shadow-slate-200/80 ring-1 ring-white backdrop-blur xl:max-w-7xl">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Smartphone,
                label: "Mini App Ads",
                desc: "In-app ad placements",
              },
              {
                icon: Tv,
                label: "Channel Ads",
                desc: "Sponsored channel posts",
              },
              {
                icon: Bot,
                label: "Bot Ads",
                desc: "Monetize bot audiences",
              },
              {
                icon: Code2,
                label: "Developer SDK",
                desc: "One integration ID",
              },
            ].map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="group flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-slate-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 ring-1 ring-blue-100/70 transition-transform duration-200 group-hover:scale-105">
                  <Icon size={18} className="text-[#0c9de8]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 leading-tight">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── ADVERTISER SECTION ─── */}
      <section id="advertisers" className="bg-white py-20 sm:py-24 lg:py-28">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Content */}
            <div>
              <Pill>
                <Megaphone size={11} /> For Advertisers
              </Pill>
              <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
                Run Ads Across Telegram.
                <br />
                <span className="text-[#0c9de8]">Track Every Result.</span>
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
                Create targeted campaigns that reach real Telegram users through
                Mini Apps, Channels, and Bots. Control your budget, monitor
                performance, and pay only for verified results.
              </p>
              <div className="mt-7 space-y-4">
                <CheckItem>
                  Create campaigns for Mini Apps, Channels, and Bots in one platform
                </CheckItem>
                <CheckItem>
                  Set daily budgets and target ad placements by inventory type
                </CheckItem>
                <CheckItem>
                  Track impressions, clicks, and spend in real time
                </CheckItem>
                <CheckItem>
                  Monitor full campaign performance from your advertiser dashboard
                </CheckItem>
                <CheckItem>
                  Deposit balance and control your spending precisely
                </CheckItem>
              </div>
              <div className="mt-8">
                <PrimaryButton href={BOT_LINK}>
                  Create Campaign
                  <ArrowRight size={15} />
                </PrimaryButton>
              </div>
            </div>

            {/* Visual */}
            <div className="relative">
              <div
                className="absolute inset-0 rounded-[40px] pointer-events-none"
                style={{
                  margin: "-32px",
                  background:
                    "radial-gradient(ellipse at center, rgba(12,157,232,0.07) 0%, transparent 70%)",
                  filter: "blur(20px)",
                }}
              />
              <div className="relative space-y-4">
                {/* Campaign summary card */}
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xl shadow-slate-200/60 ring-1 ring-white">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100">
                        <Megaphone size={15} className="text-[#0c9de8]" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">Campaign Dashboard</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          All placements
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
                      Active
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Impressions", icon: Eye },
                      { label: "Clicks", icon: Target },
                      { label: "Spend", icon: Wallet },
                    ].map(({ label, icon: Icon }) => (
                      <div
                        key={label}
                        className="rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-100"
                      >
                        <Icon
                          size={14}
                          className="text-[#0c9de8] mx-auto mb-1.5"
                        />
                        <p className="text-lg font-black text-slate-800">—</p>
                        <p className="text-[10px] text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Placement type cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm transition-shadow hover:shadow-md">
                    <Smartphone
                      size={20}
                      className="text-[#0c9de8] mx-auto mb-2"
                    />
                    <p className="text-[11px] font-bold text-slate-700">
                      Mini App
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm transition-shadow hover:shadow-md">
                    <Tv size={20} className="text-violet-500 mx-auto mb-2" />
                    <p className="text-[11px] font-bold text-slate-700">
                      Channel
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm transition-shadow hover:shadow-md">
                    <Bot size={20} className="text-emerald-500 mx-auto mb-2" />
                    <p className="text-[11px] font-bold text-slate-700">Bot</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── PUBLISHER SECTION ─── */}
      <section id="publishers" className="bg-gradient-to-b from-slate-50/80 to-white py-20 sm:py-24 lg:py-28">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Visual – first on desktop */}
            <div className="relative order-last lg:order-first">
              <div
                className="absolute inset-0 rounded-[40px] pointer-events-none"
                style={{
                  margin: "-32px",
                  background:
                    "radial-gradient(ellipse at center, rgba(16,185,129,0.06) 0%, rgba(12,157,232,0.06) 60%, transparent 80%)",
                  filter: "blur(20px)",
                }}
              />
              <div className="relative space-y-4">
                {/* Inventory type cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm shadow-slate-200/50">
                    <Smartphone size={20} className="text-[#0c9de8] mx-auto mb-2" />
                    <p className="text-[11px] font-bold text-slate-700">Mini Apps</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Monetized</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm shadow-slate-200/50">
                    <Tv size={20} className="text-violet-500 mx-auto mb-2" />
                    <p className="text-[11px] font-bold text-slate-700">Channels</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Monetized</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm shadow-slate-200/50">
                    <Bot size={20} className="text-emerald-500 mx-auto mb-2" />
                    <p className="text-[11px] font-bold text-slate-700">Bots</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Monetized</p>
                  </div>
                </div>
                {/* Earnings card */}
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xl shadow-slate-200/60 ring-1 ring-white">
                  <div className="flex items-center justify-between mb-5">
                    <p className="text-xs font-bold text-slate-900">
                      Publisher Earnings
                    </p>
                    <span className="text-[10px] font-bold text-[#0c9de8] bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full">
                      Dashboard
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                      <TrendingUp size={14} className="text-[#0c9de8] mb-1.5" />
                      <p className="text-xl font-black text-slate-800">—</p>
                      <p className="text-[10px] text-slate-400">Total Earned</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                      <Wallet size={14} className="text-emerald-500 mb-1.5" />
                      <p className="text-xl font-black text-slate-800">—</p>
                      <p className="text-[10px] text-slate-400">Available</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-emerald-500" />
                    <span className="text-[11px] text-slate-500">
                      Withdraw earnings anytime
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div>
              <Pill>
                <Wallet size={11} /> For Publishers
              </Pill>
              <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
                Monetize Your Telegram.
                <br />
                <span className="text-[#0c9de8]">Earn From Every View.</span>
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
                Connect your Mini Apps, Channels, and Bots to AdsGalaxy and start
                earning from validated ad impressions. Track earnings in real time
                and withdraw whenever you&apos;re ready.
              </p>
              <div className="mt-7 space-y-3.5">
                <CheckItem>
                  Monetize Telegram Mini Apps with in-session ad placements
                </CheckItem>
                <CheckItem>
                  Monetize Channels with sponsored posts from verified advertisers
                </CheckItem>
                <CheckItem>
                  Monetize Bots with ad messages delivered to your bot users
                </CheckItem>
                <CheckItem>
                  Earn from verified traffic — fraud protection built in
                </CheckItem>
                <CheckItem>
                  Track impressions, earnings, and history from your dashboard
                </CheckItem>
              </div>
              <div className="mt-8">
                <PrimaryButton href={BOT_LINK}>
                  Start Monetizing
                  <ArrowRight size={15} />
                </PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── DEVELOPER SECTION ─── */}
      <section
        id="developers"
        className="py-20 sm:py-24 lg:py-28"
        style={{
          background:
            "linear-gradient(140deg, #060d18 0%, #0a1a2a 60%, #091624 100%)",
        }}
      >
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Content */}
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[#13aef5] border border-[#0c9de8]/30 px-3 py-1.5 rounded-full mb-5" style={{ background: "rgba(12,157,232,0.1)" }}>
                <Code2 size={11} />
                For Developers
              </div>
              <h2 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                One Integration ID.
                <br />
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, #13aef5 0%, #59c6f5 100%)",
                  }}
                >
                  One SDK Call.
                </span>
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-7 sm:text-base" style={{ color: "#9bc4da" }}>
                Integrate AdsGalaxy into your Telegram Mini App with a single
                script tag and one function call. Get your Integration ID from the
                Developer Center, add the script, and you&apos;re live.
              </p>
              <div className="mt-7 space-y-3.5">
                <CheckItemDark>
                  Get a unique Integration ID from your developer dashboard
                </CheckItemDark>
                <CheckItemDark>
                  Add one script tag to your Mini App HTML
                </CheckItemDark>
                <CheckItemDark>
                  Call showAdsGalaxy() to display ads and earn revenue
                </CheckItemDark>
                <CheckItemDark>
                  Webhook events and impression reporting included
                </CheckItemDark>
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.97]"
                >
                  Get Integration ID
                  <ArrowRight size={15} />
                </a>
                <a
                  href="/docs/developers"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-sm font-black text-white transition-all duration-300 hover:border-white/30 hover:bg-white/15 active:scale-[0.97]"
                >
                  <BookOpen size={15} />
                  View SDK Docs
                </a>
              </div>
            </div>

            {/* Code block */}
            <div>
              <div className="overflow-hidden rounded-2xl border border-slate-700/60 shadow-2xl shadow-black/50 ring-1 ring-white/5">
                {/* Window chrome */}
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-slate-700/50" style={{ background: "#161b27" }}>
                  <div className="w-3 h-3 rounded-full bg-red-400/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <div className="w-3 h-3 rounded-full bg-green-400/80" />
                  <span className="ml-3 text-xs font-mono text-slate-400">
                    miniapp.html
                  </span>
                </div>
                {/* Code */}
                <div className="p-6 font-mono text-sm leading-loose overflow-x-auto" style={{ background: "#0d1117" }}>
                  <div>
                    <span className="text-slate-500">
                      {"<!-- 1. Add the AdsGalaxy SDK -->"}
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="text-purple-400">{"<script"}</span>
                    <span className="text-yellow-300"> src</span>
                    <span className="text-slate-400">{"=\""}</span>
                    <span className="text-green-300">
                      {SDK_HOST}
                      {"/sdk.js?id=YOUR_INTEGRATION_ID"}
                    </span>
                    <span className="text-slate-400">{"\">"}</span>
                    <span className="text-purple-400">{"</script>"}</span>
                  </div>
                  <div className="mt-5">
                    <span className="text-slate-500">
                      {"// 2. Show an ad to the user"}
                    </span>
                  </div>
                  <div className="mt-1">
                    <span className="text-blue-300">window</span>
                    <span className="text-slate-400">.</span>
                    <span className="text-yellow-300">showAdsGalaxy</span>
                    <span className="text-slate-400">{"()"}</span>
                  </div>
                </div>
                {/* Status bar */}
                <div
                  className="px-4 py-2.5 flex items-center gap-3 border-t border-slate-700/40"
                  style={{ background: "#0c1520" }}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[11px] font-mono text-slate-400">
                      Integration active
                    </span>
                  </div>
                  <div className="ml-auto text-[11px] font-mono text-slate-500">
                    sdk v2
                  </div>
                </div>
              </div>
              {/* Integration steps */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { n: "01", label: "Get Integration ID" },
                  { n: "02", label: "Add Script Tag" },
                  { n: "03", label: "Call showAdsGalaxy()" },
                ].map((s) => (
                  <div key={s.n} className="text-center">
                    <div
                      className="w-8 h-8 rounded-full text-[#13aef5] text-xs font-black flex items-center justify-center mx-auto mb-1.5 border border-[#0c9de8]/30"
                      style={{ background: "rgba(12,157,232,0.12)" }}
                    >
                      {s.n}
                    </div>
                    <p className="text-[11px] font-semibold" style={{ color: "#8ab4cc" }}>
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES GRID ─── */}
      <section className="bg-white py-20 sm:py-24 lg:py-28">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8">
          <SectionHeading
            eyebrow="Platform Features"
            title="Everything You Need to Grow"
            subtitle="AdsGalaxy provides a complete advertising and monetization platform built for the Telegram ecosystem."
          />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={Smartphone}
              title="Mini App Ads"
              description="Serve ads inside Telegram Mini Apps with smart CPM-based revenue and automatic mediation."
            />
            <FeatureCard
              icon={Tv}
              title="Channel Ads"
              description="Place sponsored posts across a curated network of Telegram channels with verified audiences."
            />
            <FeatureCard
              icon={Bot}
              title="Bot Ads"
              description="Monetize Telegram bots with native ad placements delivered to your bot's active users."
            />
            <FeatureCard
              icon={Layers}
              title="Smart Mediation"
              description="Automatic network selection maximizes fill rate and CPM across all your Mini App inventory."
            />
            <FeatureCard
              icon={Shield}
              title="Fraud Protection"
              description="Built-in traffic quality validation and suspicious impression detection protect your earnings."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Revenue Protection"
              description="Per-impression CPM validation, ceiling enforcement, and admin review workflows keep revenue clean."
            />
            <FeatureCard
              icon={Code2}
              title="Developer SDK"
              description="One Integration ID and one SDK call. Webhook delivery, impression events, and sandbox mode included."
            />
            <FeatureCard
              icon={Gift}
              title="Referral Growth"
              description="Earn rewards by referring publishers and advertisers. Compete in sprint leaderboards and team leagues."
            />
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── HOW IT WORKS ─── */}
      <section id="how-it-works" className="bg-gradient-to-b from-white to-slate-50/80 py-20 sm:py-24 lg:py-28">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8">
          <SectionHeading
            eyebrow="How It Works"
            title="Get Started in Three Steps"
            subtitle="Whether you're monetizing inventory or running campaigns, AdsGalaxy keeps the process simple."
          />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                n: "1",
                icon: Rocket,
                title: "Join AdsGalaxy",
                description:
                  "Open the AdsGalaxy Mini App via Telegram. Create your publisher, advertiser, or developer account in minutes.",
              },
              {
                n: "2",
                icon: Layers,
                title: "Add Campaign or Inventory",
                description:
                  "Create an ad campaign with your budget and creatives — or connect your Mini Apps, Channels, and Bots to start monetizing.",
              },
              {
                n: "3",
                icon: BarChart3,
                title: "Track Performance and Earnings",
                description:
                  "Monitor impressions, clicks, spend, and publisher revenue from your real-time dashboard. Withdraw earnings anytime.",
              },
            ].map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm shadow-slate-200/60 ring-1 ring-white transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-100/50"
              >
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#13aef5] to-[#0b86d6] text-2xl font-black text-white shadow-lg shadow-[#0c9de8]/30">
                  {s.n}
                </div>
                <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 ring-1 ring-blue-100/70">
                  <s.icon size={20} className="text-[#0c9de8]" />
                </div>
                <h3 className="font-black text-slate-900 mb-2.5 tracking-tight">
                  {s.title}
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── DOCS CTA ─── */}
      <section className="bg-white py-20 sm:py-24 lg:py-28">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8">
          <SectionHeading
            eyebrow="Documentation"
            title="Start with the Right Guide"
            subtitle="Detailed docs for publishers, advertisers, and developers. Get up and running in minutes."
          />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {/* Publisher Docs */}
            <a
              href="/docs/publisher"
              className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-7 shadow-sm shadow-slate-200/60 ring-1 ring-white transition-all duration-300 hover:-translate-y-1 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/40"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 ring-1 ring-blue-100/70 transition-transform duration-300 group-hover:scale-110">
                <Wallet size={22} className="text-[#0c9de8]" />
              </div>
              <h3 className="font-black text-slate-900 mb-2 tracking-tight">
                Publisher Docs
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed flex-1">
                Connect your channels, bots, and Mini Apps. Set up earnings
                tracking and learn how withdrawals work.
              </p>
              <div className="mt-5 flex items-center gap-1.5 text-sm font-bold text-[#0c9de8] group-hover:gap-3 transition-all duration-200">
                Read Docs
                <ArrowRight size={14} />
              </div>
            </a>

            {/* Advertiser Docs */}
            <a
              href="/docs/advertiser"
              className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-7 shadow-sm shadow-slate-200/60 ring-1 ring-white transition-all duration-300 hover:-translate-y-1 hover:border-violet-100 hover:shadow-xl hover:shadow-violet-100/40"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 ring-1 ring-violet-100/70 transition-transform duration-300 group-hover:scale-110">
                <Megaphone size={22} className="text-violet-500" />
              </div>
              <h3 className="font-black text-slate-900 mb-2 tracking-tight">
                Advertiser Docs
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed flex-1">
                Create your first campaign, deposit balance, and monitor ad
                performance across the full Telegram network.
              </p>
              <div className="mt-5 flex items-center gap-1.5 text-sm font-bold text-violet-500 group-hover:gap-3 transition-all duration-200">
                Read Docs
                <ArrowRight size={14} />
              </div>
            </a>

            {/* Developer Docs */}
            <a
              href="/docs/developers"
              className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-7 shadow-sm shadow-slate-200/60 ring-1 ring-white transition-all duration-300 hover:-translate-y-1 hover:border-emerald-100 hover:shadow-xl hover:shadow-emerald-100/40"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 ring-1 ring-emerald-100/70 transition-transform duration-300 group-hover:scale-110">
                <Code2 size={22} className="text-emerald-500" />
              </div>
              <h3 className="font-black text-slate-900 mb-2 tracking-tight">
                Developer Docs
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed flex-1">
                Integrate the AdsGalaxy SDK into your Mini App with one
                Integration ID and a single function call.
              </p>
              <div className="mt-5 flex items-center gap-1.5 text-sm font-bold text-emerald-500 group-hover:gap-3 transition-all duration-200">
                Read Docs
                <ArrowRight size={14} />
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="bg-slate-50/70 px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <div
            className="relative overflow-hidden rounded-2xl px-6 py-14 text-center shadow-2xl shadow-[#0c9de8]/15 ring-1 ring-white/10 sm:px-16 sm:py-20"
            style={{
              background:
                "linear-gradient(145deg, #030814 0%, #0b2040 55%, #0c5a8a 100%)",
            }}
          >
            {/* Glows */}
            <div
              className="absolute pointer-events-none"
              style={{
                top: "-80px",
                right: "-80px",
                width: "320px",
                height: "320px",
                background: "radial-gradient(circle, rgba(12,157,232,0.25) 0%, transparent 70%)",
                filter: "blur(40px)",
              }}
            />
            <div
              className="absolute pointer-events-none"
              style={{
                bottom: "-80px",
                left: "-80px",
                width: "320px",
                height: "320px",
                background: "radial-gradient(circle, rgba(12,157,232,0.18) 0%, transparent 70%)",
                filter: "blur(40px)",
              }}
            />
            {/* Dot grid */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.18]"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
              }}
            />

            <div className="relative">
              <div
                className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[#13aef5] border border-[#0c9de8]/30 px-3 py-1.5 rounded-full mb-6"
                style={{ background: "rgba(12,157,232,0.15)" }}
              >
                <Sparkles size={11} />
                Join AdsGalaxy
              </div>
              <h2 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                Ready to Launch?
              </h2>
              <p
                className="mx-auto mt-4 max-w-xl text-sm leading-7 sm:text-base"
                style={{ color: "#9bc4da" }}
              >
                Start advertising or monetizing on Telegram today. Connect with a
                growing network of publishers, advertisers, and developers on
                AdsGalaxy.
              </p>
              <div className="mx-auto mt-9 flex max-w-xl flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-white px-7 py-4 text-sm font-black text-[#0a5f99] shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.97]"
                >
                  Start Advertising
                  <ArrowRight size={15} />
                </a>
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-7 py-4 text-sm font-black text-white backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15 active:scale-[0.97]"
                >
                  Start Monetizing
                  <ArrowRight size={15} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-slate-800 bg-slate-950 text-slate-300">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14 xl:max-w-7xl xl:px-8">
          <div className="grid grid-cols-1 gap-9 sm:grid-cols-4 lg:gap-12">
            {/* Brand */}
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <Image
                  src="/logo.svg"
                  alt="AdsGalaxy"
                  width={32}
                  height={32}
                  className="w-8 h-8 shrink-0"
                />
                <span className="text-base font-black tracking-tight text-white">
                  Ads<span className="text-[#0c9de8]">Galaxy</span>
                </span>
              </div>
              <p className="max-w-xs text-sm leading-6 text-slate-400">
                The Telegram ad network for publishers, advertisers, and
                developers.
              </p>
              <a
                href={CHANNEL_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 transition-colors hover:text-[#7dd3fc]"
              >
                <Send size={12} />
                @{CHANNEL_NAME}
              </a>
            </div>

            {/* Publishers */}
            <div>
              <h4 className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Publishers
              </h4>
              <div className="space-y-2.5">
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Publisher Dashboard
                </a>
                <a
                  href="/docs/publisher"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Publisher Docs
                </a>
                <a
                  href="/docs/publisher"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Withdrawal Guide
                </a>
              </div>
            </div>

            {/* Advertisers */}
            <div>
              <h4 className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Advertisers
              </h4>
              <div className="space-y-2.5">
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Advertiser Dashboard
                </a>
                <a
                  href="/docs/advertiser"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Advertiser Docs
                </a>
                <a
                  href="/docs/advertiser"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Campaign Guide
                </a>
              </div>
            </div>

            {/* Developers */}
            <div>
              <h4 className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Developers
              </h4>
              <div className="space-y-2.5">
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Developer Dashboard
                </a>
                <a
                  href="/docs/developers"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  Developer Docs
                </a>
                <a
                  href="/docs/developers"
                  className="block text-sm text-slate-400 transition-colors hover:text-[#7dd3fc]"
                >
                  SDK Integration
                </a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-800 pt-6 sm:flex-row">
            <p className="text-center text-xs text-slate-500 sm:text-left">
              © {footer.year} {footer.brand} — {footer.rights}
            </p>
            <a
              href={BOT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-slate-800 px-3 py-2 text-xs font-bold text-[#7dd3fc] transition-colors hover:border-[#0c9de8]/40 hover:text-white sm:inline-flex"
            >
              Open App
              <ArrowRight size={12} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
