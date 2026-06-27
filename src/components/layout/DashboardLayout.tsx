"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { apiFetch } from "@/lib/api";
import BannedScreen from "@/components/auth/BannedScreen";
import AppBootState from "@/components/shared/AppBootState";
import SelfPromotionAd from "@/components/shared/SelfPromotionAd";
import { isTelegramMiniApp, safePrepareTelegramWebApp, waitForTelegramInitData } from "@/lib/telegramWebApp";

interface DashboardLayoutProps {
  children: React.ReactNode;
  type: "publisher" | "advertiser";
}

type BootState = "checking" | "ready" | "banned" | "error";

export default function DashboardLayout({ children, type }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [bootState, setBootState] = useState<BootState>("checking");
  const [miniappBetaAccess, setMiniappBetaAccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const handleRestricted = () => {
      if (!cancelled) setBootState("banned");
    };

    async function bootDashboard() {
      window.addEventListener("adsgalaxy:account-restricted", handleRestricted);
      safePrepareTelegramWebApp();

      try {
        await waitForTelegramInitData({ requireTelegram: isTelegramMiniApp() });

        const res = await apiFetch("/api/me/status", { timeoutMs: 12000 });
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;
        if (res.status === 403 || data.status === "banned" || data.is_banned) {
          setBootState("banned");
          return;
        }

        if (!res.ok && isTelegramMiniApp()) {
          throw new Error(data.error || "Unable to verify account status");
        }

        setMiniappBetaAccess(Boolean(data.miniapp_beta_access));
        window.localStorage.setItem("last_dashboard", type);
        setBootState("ready");
      } catch (error) {
        console.error("Dashboard boot failed:", error);
        if (!cancelled) setBootState("error");
      }
    }

    bootDashboard();

    return () => {
      cancelled = true;
      window.removeEventListener("adsgalaxy:account-restricted", handleRestricted);
    };
  }, [type]);

  if (bootState === "checking") {
    return (
      <AppBootState
        title="Loading AdsGalaxy"
        message="Verifying your Mini App session..."
      />
    );
  }

  if (bootState === "error") {
    return (
      <AppBootState
        mode="error"
        title="Unable to load AdsGalaxy"
        message="We couldn't start the Mini App. Please reload and try again."
        detail="If this continues, contact support."
      />
    );
  }

  if (bootState === "banned") {
    return <BannedScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <SelfPromotionAd />
      <Header toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar
        type={type}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        miniappBetaAccess={miniappBetaAccess}
      />

      <main className="min-h-screen pt-16 transition-all duration-300 lg:pl-64">
        <div className="mx-auto max-w-7xl p-4 lg:p-8">
          <div className="mb-6 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-cyan-600 p-5 text-white shadow-lg shadow-blue-100">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-black uppercase tracking-tight">Invite Friends & Earn</h2>
                <p className="text-sm font-semibold text-blue-50">Earn rewards for every verified referral. Join the Referral Sprint and compete for bonus rewards.</p>
              </div>
              <Link href="/publisher/referral" className="rounded-xl bg-white px-5 py-3 text-center text-xs font-black uppercase tracking-widest text-blue-600 shadow-sm transition-all active:scale-95">
                Invite Friends
              </Link>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
