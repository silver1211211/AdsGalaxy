"use client";

import { useEffect } from "react";
import { ensureFreshAppVersion, isTelegramMiniApp } from "@/lib/telegramWebApp";

export default function TelegramScript() {
  useEffect(() => {
    // Public web pages (including docs and local development) do not need the
    // Telegram SDK or WebView cache reload behavior.
    if (!isTelegramMiniApp()) return;

    // Force a one-time reload if this WebView is holding a stale cached build.
    ensureFreshAppVersion();

    // Only run once on mount
    if (!document.getElementById("telegram-web-app-js")) {
      const script = document.createElement("script");
      script.id = "telegram-web-app-js";
      script.src = "https://telegram.org/js/telegram-web-app.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  return null;
}
