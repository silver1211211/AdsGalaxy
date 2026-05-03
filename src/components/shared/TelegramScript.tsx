"use client";

import { useEffect } from "react";

export default function TelegramScript() {
  useEffect(() => {
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
