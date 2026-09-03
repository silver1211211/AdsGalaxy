"use client";

import { useEffect } from "react";
import { ensureFreshAppVersion, isTelegramMiniApp } from "@/lib/telegramWebApp";

export default function TelegramScript() {
  useEffect(() => {
    // The Telegram SDK is loaded before hydration by the root layout. Do not
    // gate SDK loading on this detection: after an in-app reload Telegram may
    // restore WebApp/initData only after the document begins loading.
    if (!isTelegramMiniApp()) return;

    // Force a one-time reload if this WebView is holding a stale cached build.
    ensureFreshAppVersion();

  }, []);

  return null;
}
