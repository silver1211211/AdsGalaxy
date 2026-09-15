"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { apiFetch } from "@/lib/api";
import BannedScreen from "@/components/auth/BannedScreen";
import SelfPromotionAd from "@/components/shared/SelfPromotionAd";
import ReferralSprintPopup from "@/components/shared/ReferralSprintPopup";
import { safePrepareTelegramWebApp } from "@/lib/telegramWebApp";
import { miniappReloadDebug } from "@/lib/miniappReloadDebug";
import { useTranslations } from "@/i18n/client";

interface DashboardLayoutProps {
  children: React.ReactNode;
  type: "publisher" | "advertiser";
}

type BootState = "ready" | "banned";

export default function DashboardLayout({ children, type }: DashboardLayoutProps) {
  const { initializeLocale, localeInitialized } = useTranslations();
  const localeInitializedAtMount = useRef(localeInitialized);
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [bootState, setBootState] = useState<BootState>("ready");
  const isPublisherDashboard = type === "publisher" && pathname === "/publisher";
  const [referralPopupBlockingPromo, setReferralPopupBlockingPromo] = useState(isPublisherDashboard);

  const handleReferralBlockingChange = React.useCallback((isBlocking: boolean) => {
    setReferralPopupBlockingPromo(isBlocking);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pathname transitions reset popup ownership
    setReferralPopupBlockingPromo(isPublisherDashboard);
  }, [isPublisherDashboard]);

  useEffect(() => {
    let cancelled = false;

    const handleRestricted = () => {
      if (!cancelled) setBootState("banned");
    };

    async function refreshAccountState() {
      miniappReloadDebug("dashboard_boot_started", { phase: "started" });
      window.addEventListener("adsgalaxy:account-restricted", handleRestricted);
      safePrepareTelegramWebApp();

      // Locale and account status are enhancements to an already visible shell.
      // English is a safe immediate fallback; a valid stored preference replaces it.
      if (!localeInitializedAtMount.current) initializeLocale("en");

      try {
        miniappReloadDebug("dashboard_me_status_started", { route: "/api/me/status", phase: "started" });
        const res = await apiFetch("/api/me/status", { timeoutMs: 4000 });
        const data: Record<string, unknown> = await res.json().catch(() => ({}));
        miniappReloadDebug("dashboard_me_status_completed", { route: "/api/me/status", status: res.status, phase: "completed" });

        if (cancelled) return;
        if (typeof data.language === "string") initializeLocale(data.language);
        if (res.status === 403 || data.status === "banned" || data.is_banned === true) {
          setBootState("banned");
          return;
        }
        if (res.ok) window.localStorage.setItem("last_dashboard", type);
      } catch (error) {
        miniappReloadDebug("dashboard_failed", { result: "failed", error_name: error instanceof Error ? error.name : "UnknownError", error_message: error instanceof Error ? error.message : "Dashboard boot failed" });
        // Route APIs independently enforce authorization. A transient status or
        // locale failure must never replace the usable application with a loader.
      }
    }

    refreshAccountState();

    return () => {
      cancelled = true;
      window.removeEventListener("adsgalaxy:account-restricted", handleRestricted);
    };
  }, [initializeLocale, type]);

  if (bootState === "banned") {
    return <BannedScreen />;
  }

  return (
    <div className="ag-miniapp-shell relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(12,157,232,0.12),transparent_32%),linear-gradient(180deg,#f8fbff_0%,#f1f7fc_42%,#ffffff_100%)]">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-64 bg-gradient-to-b from-[#0c9de8]/10 to-transparent" />
      <SelfPromotionAd enabled={isPublisherDashboard && !referralPopupBlockingPromo} delayMs={2500} />
      <Header toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar
        type={type}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {type === "publisher" && (
        <ReferralSprintPopup onBlockingChange={handleReferralBlockingChange} />
      )}
      <main className="relative z-10 min-h-screen pt-16 transition-all duration-300 lg:pl-64">
        <div className="mx-auto max-w-7xl p-4 pb-8 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
