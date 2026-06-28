"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { apiFetch } from "@/lib/api";
import BannedScreen from "@/components/auth/BannedScreen";
import AppBootState from "@/components/shared/AppBootState";
import SelfPromotionAd from "@/components/shared/SelfPromotionAd";
import ReferralSprintPopup from "@/components/shared/ReferralSprintPopup";
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
        window.localStorage.setItem("ag_miniapp_beta", data.miniapp_beta_access ? "1" : "0");
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
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <SelfPromotionAd />
      <Header toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar
        type={type}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        miniappBetaAccess={miniappBetaAccess}
      />

      {type === "publisher" && <ReferralSprintPopup />}
      <main className="min-h-screen pt-16 transition-all duration-300 lg:pl-64">
        <div className="mx-auto max-w-7xl p-4 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
