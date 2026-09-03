import { isTelegramMiniApp, waitForTelegramInitData } from "./telegramWebApp";
import { miniappReloadDebug } from "./miniappReloadDebug";

const LOCAL_MINIAPP_DEV_STORAGE_KEY = "adsgalaxy_local_miniapp_dev";
const LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX = "adsgalaxy-local-miniapp-dev:";
const DEVICE_ID_STORAGE_KEY = "adsgalaxy_device_id";

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

function isLocalBrowserHost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function encodeLocalMiniappDevPayload(payload: unknown) {
  const json = JSON.stringify(payload);
  const binary = window.btoa(unescape(encodeURIComponent(json)));
  return binary.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getOrCreateLocalMiniappDevInitData() {
  if (!isLocalBrowserHost()) return "";

  const existing = window.localStorage.getItem(LOCAL_MINIAPP_DEV_STORAGE_KEY) || "";
  if (existing) return existing;

  const params = new URLSearchParams(window.location.search);
  const initData = `${LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX}${encodeLocalMiniappDevPayload({
    user: params.get("user") || "1",
    ref: params.get("ref") || "",
  })}`;

  // Local-only Mini App browser testing support. This token is rejected by the
  // server unless local dev mode is explicitly enabled and the host is local.
  window.localStorage.setItem(LOCAL_MINIAPP_DEV_STORAGE_KEY, initData);
  return initData;
}

function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const next = typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

export async function apiFetch(url: string, options: ApiFetchOptions = {}) {
  const route = url.split("?")[0];
  const diagnosticRoutes = new Set(["/api/me/status", "/api/advertiser/campaigns", "/api/advertiser/miniapp-rewarded-campaigns", "/api/advertiser/stats", "/api/publisher/channels", "/api/publisher/stats", "/api/publisher/referrals"]);
  const shouldDiagnose = diagnosticRoutes.has(route);
  const requestStartedAt = Date.now();
  const { requireAuth = true, timeoutMs = 15000, ...fetchOptions } = options;
  const localDevInitData = typeof window !== "undefined" ? getOrCreateLocalMiniappDevInitData() : "";
  const initData = localDevInitData || (typeof window !== "undefined"
    ? await waitForTelegramInitData({ requireTelegram: requireAuth && isTelegramMiniApp() })
    : "");

  const headers = new Headers(fetchOptions.headers);
  headers.set("x-telegram-init-data", initData || "");
  headers.set("x-adsgalaxy-device-id", getOrCreateDeviceId());
  if (shouldDiagnose) miniappReloadDebug("api_fetch_started", { route, init_data_present: Boolean(initData), phase: "started" });

  if (!(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = typeof window !== "undefined"
      ? await fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs)
      : await fetch(url, { ...fetchOptions, headers });
  } catch (error) {
    if (shouldDiagnose) miniappReloadDebug("api_fetch_failed", {
      route, phase: error instanceof DOMException && error.name === "AbortError" ? "aborted" : "failed",
      duration_ms: Date.now() - requestStartedAt,
      error_name: error instanceof Error ? error.name : "UnknownError",
      error_message: error instanceof Error ? error.message : "Request failed",
    });
    throw error;
  }
  if (shouldDiagnose) miniappReloadDebug("api_fetch_completed", { route, phase: "completed", status: response.status, duration_ms: Date.now() - requestStartedAt });

  if (response.status === 403 && typeof window !== "undefined") {
    const payload = await response.clone().json().catch(() => ({}));
    const error = String(payload?.error || "").toLowerCase();
    const status = String(payload?.status || "").toLowerCase();
    const isAccountRestricted = error === "account restricted"
      || status === "banned"
      || payload?.is_banned === true;

    if (isAccountRestricted) {
      window.dispatchEvent(new CustomEvent("adsgalaxy:account-restricted"));
    }
  }

  return response;
}
