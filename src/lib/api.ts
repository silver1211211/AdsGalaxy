import { isTelegramMiniApp, waitForTelegramInitData } from "./telegramWebApp";

type ApiFetchOptions = RequestInit & {
  requireAuth?: boolean;
  timeoutMs?: number;
};

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function apiFetch(url: string, options: ApiFetchOptions = {}) {
  const { requireAuth = true, timeoutMs = 15000, ...fetchOptions } = options;
  const initData = typeof window !== "undefined"
    ? await waitForTelegramInitData({ requireTelegram: requireAuth && isTelegramMiniApp() })
    : "";

  const headers = new Headers(fetchOptions.headers);
  headers.set("x-telegram-init-data", initData || "");

  if (!(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = typeof window !== "undefined"
    ? await fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs)
    : await fetch(url, { ...fetchOptions, headers });

  if (response.status === 403 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("adsgalaxy:account-restricted"));
  }

  return response;
}
