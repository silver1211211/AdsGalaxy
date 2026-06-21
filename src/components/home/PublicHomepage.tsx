"use client";

import {
  Megaphone,
  Rocket,
  ShieldCheck,
  Users,
  BarChart3,
  Zap,
  Send,
  Bot,
  Tv,
  Wallet,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Lock,
  Eye,
  HandCoins,
  Menu,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

const BOT_LINK = "https://t.me/Ads_Galaxy_bot";
const CHANNEL_LINK = "https://t.me/AdsGalaxy_News";

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

function CTAButton({
  label,
  variant = "primary",
  className = "",
}: {
  label: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold transition-all duration-300 active:scale-[0.97]";
  const styles =
    variant === "primary"
      ? "bg-gradient-to-r from-[#13aef5] to-[#0b86d6] text-white shadow-lg shadow-[#0c9de8]/30 hover:shadow-xl hover:shadow-[#0c9de8]/40 hover:-translate-y-0.5"
      : "bg-white text-[#0c9de8] border border-slate-200 hover:border-blue-200 hover:bg-blue-50/60 hover:-translate-y-0.5";
  return (
    <a
      href={BOT_LINK}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} ${styles} ${className}`}
    >
      {label}
      <ArrowRight size={16} />
    </a>
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
    <div className="max-w-2xl mx-auto text-center mb-10">
      <span className="inline-block text-[11px] font-black uppercase tracking-widest text-[#0c9de8] bg-blue-50 px-3 py-1 rounded-full mb-4 ring-1 ring-blue-100">
        {eyebrow}
      </span>
      <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 text-slate-500 text-sm sm:text-base leading-relaxed">{subtitle}</p>
      )}
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="relative h-px w-full max-w-6xl xl:max-w-7xl mx-auto">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#0c9de8]/40" />
    </div>
  );
}

function BenefitCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Megaphone;
  title: string;
  description: string;
}) {
  return (
    <div className="group bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-blue-100/60 hover:border-blue-100 hover:-translate-y-1 transition-all duration-300 p-6">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-100/70 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
        <Icon size={21} className="text-[#0c9de8]" />
      </div>
      <h3 className="font-bold text-slate-900 mb-1.5 tracking-tight">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
    </div>
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
    { label: "Publishers", href: "#publishers" },
    { label: "Advertisers", href: "#advertisers" },
    { label: "Bot Owners", href: "#bot-owners" },
    { label: "How It Works", href: "#how-it-works" },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-xl border-b border-slate-100 shadow-[0_1px_0_0_rgba(15,23,42,0.04)]">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="AdsGalaxy" width={36} height={36} className="w-9 h-9 shrink-0" priority />
            <span className="font-black text-lg tracking-tight">
              Ads<span className="text-[#0c9de8]">Galaxy</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-slate-600 hover:text-[#0c9de8] transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:block">
            <CTAButton label="Get Started" className="!px-5 !py-2.5 text-[13px] !rounded-xl" />
          </div>

          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden p-2 -mr-2 text-slate-700"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 sm:px-6 py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block text-sm font-semibold text-slate-600 hover:text-[#0c9de8] py-1"
              >
                {link.label}
              </a>
            ))}
            <CTAButton label="Get Started" className="w-full mt-2" />
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/80 via-white to-white">
        <div
          className="absolute inset-0 opacity-[0.4] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(12,157,232,0.18) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent)",
          }}
        />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#0c9de8]/10 blur-3xl" />
        <div className="absolute top-40 -left-24 w-72 h-72 rounded-full bg-[#0c9de8]/10 blur-3xl" />

        <div className="relative max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8 pt-12 pb-14 sm:pt-16 sm:pb-14 text-center">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[#0c9de8] bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full mb-5 shadow-sm">
            <Sparkles size={12} />
            Built for Telegram
          </span>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] text-slate-900">
            Monetize Your{" "}
            <span className="bg-gradient-to-r from-[#0c9de8] to-[#0667ac] bg-clip-text text-transparent">
              Telegram Audience
            </span>
          </h1>
          <h2 className="mt-3 text-lg sm:text-2xl md:text-3xl font-bold text-slate-700">
            Advertise Across Telegram Channels &amp; Bots
          </h2>

          <p className="mt-5 max-w-xl mx-auto text-slate-500 text-sm sm:text-base leading-relaxed">
            One platform connecting publishers, bot owners, and advertisers — turn
            your channels and bots into revenue, or reach real Telegram audiences
            with targeted campaigns.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <CTAButton label="Monetize Now" />
            <CTAButton label="Advertise Now" variant="secondary" />
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {[
              { icon: Tv, label: "Channel Publishers" },
              { icon: Bot, label: "Bot Owners" },
              { icon: Megaphone, label: "Advertisers" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Icon size={14} className="text-[#0c9de8]" />
                {label}
              </span>
            ))}
          </div>

          <a
            href={CHANNEL_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-[#0c9de8] transition-colors"
          >
            <Send size={14} />
            Follow @AdsGalaxy_News for updates
          </a>
        </div>
      </section>

      <SectionDivider />

      {/* Publisher Benefits */}
      <section id="publishers" className="py-12 sm:py-14 lg:py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-0 sm:px-0 xl:px-8">
          <SectionHeading
            eyebrow="For Publishers"
            title="Turn Your Channel Into Income"
            subtitle="Connect your Telegram channel and start earning from ads placed by verified advertisers."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <BenefitCard
              icon={Tv}
              title="Connect Any Channel"
              description="Link your Telegram channel in minutes and make it available to advertisers."
            />
            <BenefitCard
              icon={Wallet}
              title="Earn From Every Ad"
              description="Get paid for ad placements delivered to your audience, automatically tracked."
            />
            <BenefitCard
              icon={HandCoins}
              title="Flexible Withdrawals"
              description="Withdraw your earnings whenever you're ready, straight from your dashboard."
            />
            <BenefitCard
              icon={BarChart3}
              title="Clear Performance Data"
              description="Track views, earnings, and history for every channel you manage."
            />
          </div>
        </div>
      </section>

      {/* Advertiser Benefits */}
      <section id="advertisers" className="py-12 sm:py-14 lg:py-16 px-4 sm:px-6 bg-slate-50/70">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-0 sm:px-0 xl:px-8">
          <SectionHeading
            eyebrow="For Advertisers"
            title="Reach Real Telegram Audiences"
            subtitle="Launch campaigns across active Telegram channels and bots, built for performance and control."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <BenefitCard
              icon={Megaphone}
              title="Channel & Bot Reach"
              description="Place your ads across a network of Telegram channels and bots in one campaign."
            />
            <BenefitCard
              icon={Zap}
              title="Launch In Minutes"
              description="Create and submit a campaign quickly, no complicated setup required."
            />
            <BenefitCard
              icon={Wallet}
              title="Deposit & Spend Control"
              description="Fund your ad balance and track exactly how much is spent on each campaign."
            />
            <BenefitCard
              icon={BarChart3}
              title="Transparent Reporting"
              description="See views, clicks, and spend for every campaign from your dashboard."
            />
          </div>
        </div>
      </section>

      {/* Bot Owner Monetization */}
      <section id="bot-owners" className="py-12 sm:py-14 lg:py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-0 sm:px-0 xl:px-8">
          <div className="rounded-[32px] bg-gradient-to-br from-[#11a3ec] via-[#0c8dd6] to-[#0a5f99] p-7 sm:p-10 relative overflow-hidden shadow-xl shadow-blue-200/50">
            <div
              className="absolute inset-0 opacity-[0.5] pointer-events-none"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
            <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -top-10 -left-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white bg-white/15 px-3 py-1.5 rounded-full mb-5 ring-1 ring-white/20">
                  <Bot size={12} />
                  For Bot Owners
                </span>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-tight">
                  Turn Your Telegram Bot Into a Revenue Stream
                </h2>
                <p className="mt-4 text-blue-50 text-sm sm:text-base leading-relaxed">
                  Have an active Telegram bot? Monetize your bot&apos;s user base by
                  serving ad placements to your audience and earn alongside channel
                  publishers.
                </p>
                <div className="mt-6">
                  <a
                    href={BOT_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold bg-white text-[#0c9de8] shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.97]"
                  >
                    Monetize Your Bot
                    <ArrowRight size={16} />
                  </a>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  "Connect your bot and get reviewed for ad placement",
                  "Serve ads to your bot users automatically",
                  "Track impressions and earnings in real time",
                  "Withdraw earnings alongside your channels",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 bg-white/10 ring-1 ring-white/10 rounded-2xl p-4 backdrop-blur-sm">
                    <CheckCircle2 size={18} className="text-white shrink-0 mt-0.5" />
                    <p className="text-sm text-white/90">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-12 sm:py-14 lg:py-16 px-4 sm:px-6 bg-slate-50/70">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-0 sm:px-0 xl:px-8">
          <SectionHeading
            eyebrow="How It Works"
            title="Get Started in a Few Simple Steps"
            subtitle="Whether you're monetizing or advertising, AdsGalaxy keeps the process simple."
          />
          <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="hidden lg:block absolute top-[34px] left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent" />
            {[
              {
                step: "01",
                icon: Send,
                title: "Open the Bot",
                description: "Launch the AdsGalaxy bot on Telegram to access your dashboard.",
              },
              {
                step: "02",
                icon: Users,
                title: "Choose Your Role",
                description: "Sign up as a publisher, bot owner, or advertiser.",
              },
              {
                step: "03",
                icon: Rocket,
                title: "Set Up & Connect",
                description: "Add your channel or bot, or create your first ad campaign.",
              },
              {
                step: "04",
                icon: Wallet,
                title: "Earn or Advertise",
                description: "Start earning from ad placements, or reach your target audience.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="relative bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-lg hover:shadow-blue-100/50 hover:-translate-y-1 transition-all duration-300 p-6"
              >
                <span className="absolute top-5 right-5 text-3xl font-black text-slate-100">
                  {s.step}
                </span>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-100/70 flex items-center justify-center mb-5">
                  <s.icon size={21} className="text-[#0c9de8]" />
                </div>
                <h3 className="font-bold text-slate-900 mb-1.5 tracking-tight">{s.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Safety */}
      <section className="py-12 sm:py-14 lg:py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-0 sm:px-0 xl:px-8">
          <SectionHeading
            eyebrow="Trust & Safety"
            title="Built to Be Safe and Transparent"
            subtitle="AdsGalaxy is designed around verified accounts, transparent tracking, and secure payments."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <BenefitCard
              icon={ShieldCheck}
              title="Verified Accounts"
              description="Publishers, bot owners, and advertisers operate through verified Telegram accounts."
            />
            <BenefitCard
              icon={Lock}
              title="Secure Payments"
              description="Deposits, earnings, and withdrawals are tracked securely within your dashboard."
            />
            <BenefitCard
              icon={Eye}
              title="Full Visibility"
              description="Every campaign and earning event is logged and visible to the account owner."
            />
            <BenefitCard
              icon={CheckCircle2}
              title="Manual Oversight"
              description="Campaigns and channels are reviewed to help keep the platform trustworthy."
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 sm:py-14 lg:py-16 px-4 sm:px-6 bg-slate-50/70">
        <div className="max-w-5xl mx-auto">
          <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#0b1f3a] via-[#0c3a63] to-[#0c8dd6] px-6 sm:px-12 py-12 sm:py-16 text-center shadow-2xl shadow-blue-200/40">
            <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-[#0c9de8]/30 blur-3xl" />
            <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-[#0c9de8]/20 blur-3xl" />
            <div
              className="absolute inset-0 opacity-[0.35] pointer-events-none"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
              }}
            />
            <div className="relative">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white bg-white/10 ring-1 ring-white/20 px-3 py-1.5 rounded-full mb-5">
                <Sparkles size={12} />
                Join AdsGalaxy
              </span>
              <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
                Ready to Get Started on AdsGalaxy?
              </h2>
              <p className="mt-4 text-blue-100 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
                Join AdsGalaxy today — monetize your channel or bot, or launch your
                first advertising campaign on Telegram.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold bg-white text-[#0a5f99] shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.97]"
                >
                  Start Now
                  <ArrowRight size={16} />
                </a>
                <a
                  href={BOT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20 hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.97]"
                >
                  Sign Up
                  <ArrowRight size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 xl:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="AdsGalaxy" width={28} height={28} className="w-7 h-7 shrink-0" />
            <span className="font-black text-sm tracking-tight">
              Ads<span className="text-[#0c9de8]">Galaxy</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 text-center">
            © {footer.year} {footer.brand} — {footer.rights}
          </p>
          <a
            href={CHANNEL_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#0c9de8] transition-colors"
          >
            <Send size={13} />
            @AdsGalaxy_News
          </a>
        </div>
      </footer>
    </div>
  );
}
