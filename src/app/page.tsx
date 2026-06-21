"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PublicHomepage from "@/components/home/PublicHomepage";
import AppBootState from "@/components/shared/AppBootState";
import {
  getSafeLastDashboard,
  hasTelegramLaunchParams,
  isTelegramMiniApp,
  safePrepareTelegramWebApp,
  waitForTelegramInitData,
} from "@/lib/telegramWebApp";

type BootView = "checking" | "web" | "error";

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<BootView>("checking");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      safePrepareTelegramWebApp();

      if (!isTelegramMiniApp() && !hasTelegramLaunchParams()) {
        if (!cancelled) setView("web");
        return;
      }

      try {
        await waitForTelegramInitData({ requireTelegram: true });
        if (cancelled) return;

        const dashboard = getSafeLastDashboard();
        router.replace(dashboard === "advertiser" ? "/advertiser" : "/publisher");
      } catch (error) {
        console.error("Mini App boot failed:", error);
        if (!cancelled) setView("error");
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (view === "web") {
    return <PublicHomepage />;
  }

  if (view === "error") {
    return (
      <AppBootState
        mode="error"
        title="Unable to load AdsGalaxy"
        message="We couldn't start the Mini App. Please reload and try again."
        detail="If this continues, contact support."
      />
    );
  }

  return (
    <AppBootState
      title="Loading AdsGalaxy"
      message="Preparing your Telegram Mini App session..."
    />
  );
}
