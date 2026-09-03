"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { apiFetch } from "@/lib/api";
import BannedScreen from "@/components/auth/BannedScreen";
import SelfPromotionAd from "@/components/shared/SelfPromotionAd";
import ReferralSprintPopup from "@/components/shared/ReferralSprintPopup";
import { isTelegramMiniApp, safePrepareTelegramWebApp, waitForTelegramInitData } from "@/lib/telegramWebApp";
import { miniappReloadDebug } from "@/lib/miniappReloadDebug";

interface DashboardLayoutProps {
  children: React.ReactNode;
  type: "publisher" | "advertiser";
}

type BootState = "ready" | "banned";

export default function DashboardLayout({ children, type }: DashboardLayoutProps) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [bootState, setBootState] = useState<BootState>("ready");
  const isPublisherDashboard = type === "publisher" && pathname === "/publisher";
  const [referralPopupBlockingPromo, setReferralPopupBlockingPromo] = useState(isPublisherDashboard);

  const handleReferralBlockingChange = React.useCallback((isBlocking: boolean) => {
    setReferralPopupBlockingPromo(isBlocking);
  }, []);

  useEffect(() => {
    setReferralPopupBlockingPromo(isPublisherDashboard);
  }, [isPublisherDashboard]);

  useEffect(() => {
    let cancelled = false;

    const handleRestricted = () => {
      if (!cancelled) setBootState("banned");
    };

    async function bootDashboard() {
      miniappReloadDebug("dashboard_boot_started", { phase: "started" });
      window.addEventListener("adsgalaxy:account-restricted", handleRestricted);
      safePrepareTelegramWebApp();

      try {
        const initData = await waitForTelegramInitData({ requireTelegram: isTelegramMiniApp() });
        miniappReloadDebug("dashboard_boot_init_data", { init_data_present: Boolean(initData) });

        let res: Response | null = null;
        let data: Record<string, unknown> = {};
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            miniappReloadDebug("dashboard_me_status_started", { route: "/api/me/status", phase: "started", attempt: attempt + 1 });
            res = await apiFetch("/api/me/status", { timeoutMs: 8000 });
            miniappReloadDebug("dashboard_me_status_completed", { route: "/api/me/status", status: res.status, phase: "completed", attempt: attempt + 1 });
            data = await res.json().catch(() => ({}));
            if (res.ok || res.status === 401 || res.status === 403) break;
          } catch (error) {
            lastError = error;
          }
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 500 * (2 ** attempt)));
        }
        if (!res) throw lastError || new Error("Unable to verify account status");

        if (cancelled) return;
        if (res.status === 403 || data.status === "banned" || data.is_banned === true) {
          setBootState("banned");
          return;
        }

        if (!res.ok && isTelegramMiniApp()) {
          throw new Error(String(data.error || "Unable to verify account status"));
        }

        window.localStorage.setItem("last_dashboard", type);
        miniappReloadDebug("dashboard_ready", { result: "ready" });
        setBootState("ready");
      } catch (error) {
        miniappReloadDebug("dashboard_failed", { result: "failed", error_name: error instanceof Error ? error.name : "UnknownError", error_message: error instanceof Error ? error.message : "Dashboard boot failed" });
        console.error("Dashboard boot failed:", error);
        // Authentication retries run in the background. API routes still enforce
        // authorization, so a transient dependency failure must not blank the shell.
      }
    }

    bootDashboard();

    return () => {
      cancelled = true;
      window.removeEventListener("adsgalaxy:account-restricted", handleRestricted);
    };
  }, [type]);

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
