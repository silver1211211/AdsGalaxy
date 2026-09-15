import { getAvailableTelegramInitData, isTelegramMiniApp, waitForTelegramInitData } from "./telegramWebApp";
import { miniappReloadDebug } from "./miniappReloadDebug";

const LOCAL_MINIAPP_DEV_STORAGE_KEY = "adsgalaxy_local_miniapp_dev";
const LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX = "adsgalaxy-local-miniapp-dev:";
const DEVICE_ID_STORAGE_KEY = "adsgalaxy_device_id";
const inFlightGetRequests = new Map<string, Promise<Response>>();

const SESSION_FIRST_GET_ROUTES = new Set([
  "/api/me/status",
  "/api/publisher/stats",
  "/api/publisher/channels",
  "/api/publisher/referrals",
  "/api/publisher/earnings",
  "/api/advertiser/stats",
  "/api/advertiser/campaigns",
  "/api/advertiser/campaign-feed",
  "/api/advertiser/miniapp-rewarded-campaigns",
  "/api/advertiser/deposits",
  "/api/advertiser/enterprise",
  "/api/publisher/withdrawals",
  "/api/publisher/bots",
  "/api/publisher/miniapps",
  "/api/ai-support",
]);

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

  const hostname = window.location.hostname.toLowerCase();

  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "preview.adsgalaxy.online";
}

function encodeLocalMiniappDevPayload(payload: unknown) {
  const json = JSON.stringify(payload);
  const binary = window.btoa(unescape(encodeURIComponent(json)));
  return binary.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getOrCreateLocalMiniappDevInitData() {
  if (!isLocalBrowserHost()) return "";

  const existing = window.localStorage.getItem(LOCAL_MINIAPP_DEV_STORAGE_KEY) || "";
  const params = new URLSearchParams(window.location.search);
  const isOwnerPreview = window.location.hostname.toLowerCase() === "preview.adsgalaxy.online";
  if (existing && !isOwnerPreview) return existing;

  const initData = `${LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX}${encodeLocalMiniappDevPayload({
    user: isOwnerPreview ? "silver" : params.get("user") || "1",
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
  const method = String(fetchOptions.method || "GET").toUpperCase();
  const localDevInitData = typeof window !== "undefined" ? getOrCreateLocalMiniappDevInitData() : "";

  const sessionFirstGet =
    method === "GET" &&
    SESSION_FIRST_GET_ROUTES.has(route);

  // Keep the fast session-first path for ordinary browser reloads, but use
  // Telegram's signed identity immediately when the bridge already exposed it.
  // This avoids parallel 401s while the 48-hour session is being established.
  let initData = localDevInitData
    || (sessionFirstGet && typeof window !== "undefined" ? getAvailableTelegramInitData() : "");

  if (
    !initData &&
    typeof window !== "undefined" &&
    !sessionFirstGet
  ) {
    initData = await waitForTelegramInitData({
      requireTelegram: requireAuth && isTelegramMiniApp(),
    });
  }

  const headers = new Headers(fetchOptions.headers);
  headers.set("x-telegram-init-data", initData || "");
  headers.set("x-adsgalaxy-device-id", getOrCreateDeviceId());
  if (shouldDiagnose) miniappReloadDebug("api_fetch_started", { route, init_data_present: Boolean(initData), phase: "started" });

  if (!(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    const canCoalesce = typeof window !== "undefined" && method === "GET" && !fetchOptions.signal;
    const requestKey = canCoalesce ? url : "";
    const existing = requestKey ? inFlightGetRequests.get(requestKey) : undefined;
    if (existing) {
      response = (await existing).clone();
    } else {
      const requestPromise = typeof window !== "undefined"
        ? fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs)
        : fetch(url, { ...fetchOptions, headers });
      if (requestKey) inFlightGetRequests.set(requestKey, requestPromise);
      try {
        const fetched = await requestPromise;
        response = requestKey ? fetched.clone() : fetched;
      } finally {
        if (requestKey) inFlightGetRequests.delete(requestKey);
      }
    }
    // Session-first GET fallback:
    // if the server does not have a valid 48-hour session, obtain Telegram
    // initData only then and retry the request once.
    if (
      response.status === 401 &&
      requireAuth &&
      sessionFirstGet &&
      !localDevInitData &&
      typeof window !== "undefined"
    ) {
      const telegramInitData = await waitForTelegramInitData({
        requireTelegram: isTelegramMiniApp(),
      });

      if (telegramInitData) {
        initData = telegramInitData;

        const retryHeaders = new Headers(headers);
        retryHeaders.set("x-telegram-init-data", telegramInitData);

        response = await fetchWithTimeout(
          url,
          {
            ...fetchOptions,
            headers: retryHeaders,
          },
          timeoutMs,
        );
      }
    }
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
