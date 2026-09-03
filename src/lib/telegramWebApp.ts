type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  enableVerticalSwipes?: () => void;
  initData?: string;
  showAlert?: (message: string) => void;
  setBackgroundColor?: (color: string) => void;
  setHeaderColor?: (color: string) => void;
};

import { miniappReloadDebug } from "./miniappReloadDebug";

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
};

// Some Telegram Android/WebView sessions expose WebApp.initData several
// seconds after the document starts. Keep the boot screen alive long enough
// for those sessions instead of permanently failing after only 2.4 seconds.
const INIT_DATA_RETRIES = 80;
const INIT_DATA_INTERVAL_MS = 150;
let sessionInitData = "";
let activeInitDataWait: Promise<string> | null = null;

function getLaunchParam(name: string) {
  if (typeof window === "undefined") return "";
  for (const source of [window.location.search, window.location.hash]) {
    const value = new URLSearchParams(source.replace(/^[?#]/, "")).get(name);
    if (value) return value;
  }
  return "";
}

function getSessionTelegramInitData() {
  // Telegram also places the signed payload directly in the launch URL. Use
  // that authoritative value when its SDK is delayed or blocked by a WebView.
  const currentInitData = getTelegramWebApp()?.initData || getLaunchParam("tgWebAppData");
  if (currentInitData) sessionInitData = currentInitData;
  // Do not emit telemetry from this polling helper. Doing so creates one HTTP
  // request per retry and can make a slow Mini App launch even slower. The
  // caller records one start event and one completion event instead.
  return currentInitData || sessionInitData;
}

export function getTelegramWebApp() {
  if (typeof window === "undefined") return undefined;
  return (window as TelegramWindow).Telegram?.WebApp;
}

export function safePrepareTelegramWebApp() {
  const webApp = getTelegramWebApp();
  if (!webApp) return;

  try {
    webApp.ready?.();
  } catch (error) {
    console.warn("Telegram WebApp ready() failed:", error);
  }

  // Keep Telegram's native swipe-down gesture available so users can collapse
  // the Mini App without closing it. Do not force the WebView expanded here.
  try {
    webApp.enableVerticalSwipes?.();
  } catch (error) {
    console.warn("Telegram WebApp enableVerticalSwipes() failed:", error);
  }

  // Force Telegram's native WebView chrome (header bar and any area outside
  // the page's own painted content, e.g. overscroll/resize slivers) to white.
  // Without this, a user with Telegram's own app set to dark mode gets a
  // black background from Telegram itself, independent of this app's CSS.
  try {
    webApp.setBackgroundColor?.("#ffffff");
  } catch (error) {
    console.warn("Telegram WebApp setBackgroundColor() failed:", error);
  }

  try {
    webApp.setHeaderColor?.("#ffffff");
  } catch (error) {
    console.warn("Telegram WebApp setHeaderColor() failed:", error);
  }
}

export function hasTelegramLaunchParams() {
  if (typeof window === "undefined") return false;
  return Boolean(getLaunchParam("tgWebAppData") || getLaunchParam("tgWebAppPlatform"));
}

export function isTelegramMiniApp() {
  return hasTelegramLaunchParams() || Boolean(getTelegramWebApp()?.initData);
}

export function getSafeLastDashboard() {
  if (typeof window === "undefined") return "publisher";
  const lastDashboard = window.localStorage.getItem("last_dashboard");
  return lastDashboard === "advertiser" || lastDashboard === "publisher"
    ? lastDashboard
    : "publisher";
}

const APP_VERSION_STORAGE_KEY = "adsgalaxy_app_version";
const APP_VERSION_RELOAD_GUARD_KEY = "adsgalaxy_app_version_reloaded";

export function getAppBuildMarker() {
  if (typeof document === "undefined") return "";
  return document.querySelector('meta[name="adsgalaxy-build"]')?.getAttribute("content") || "";
}

// Telegram's in-app WebView can keep serving an old cached document/bundle
// across launches. When the build marker changes, force exactly one reload
// so the WebView picks up the fresh chunks instead of silently rendering stale UI.
export function ensureFreshAppVersion() {
  if (typeof window === "undefined") return;

  const currentVersion = getAppBuildMarker();
  if (!currentVersion) return;

  const storedVersion = window.localStorage.getItem(APP_VERSION_STORAGE_KEY);
  window.localStorage.setItem(APP_VERSION_STORAGE_KEY, currentVersion);

  if (!storedVersion || storedVersion === currentVersion) return;

  if (window.sessionStorage.getItem(APP_VERSION_RELOAD_GUARD_KEY) === currentVersion) return;

  window.sessionStorage.setItem(APP_VERSION_RELOAD_GUARD_KEY, currentVersion);
  window.location.reload();
}

export async function waitForTelegramInitData(options: { requireTelegram?: boolean } = {}) {
  if (typeof window === "undefined") return "";
  const immediate = getSessionTelegramInitData();
  if (immediate) return immediate;
  if (activeInitDataWait) return activeInitDataWait;

  activeInitDataWait = waitForTelegramInitDataInternal(options);
  try {
    return await activeInitDataWait;
  } finally {
    activeInitDataWait = null;
  }
}

async function waitForTelegramInitDataInternal(options: { requireTelegram?: boolean } = {}) {

  const waitStartedAt = Date.now();
  miniappReloadDebug("telegram_init_data_wait_started", {
    telegram_window_present: Boolean((window as TelegramWindow).Telegram),
    webapp_present: Boolean(getTelegramWebApp()),
    webapp_init_data_present: Boolean(getTelegramWebApp()?.initData),
    cached_init_data_present: Boolean(sessionInitData),
  });

  safePrepareTelegramWebApp();

  for (let attempt = 0; attempt < INIT_DATA_RETRIES; attempt += 1) {
    const initData = getSessionTelegramInitData();
    if (initData) {
      miniappReloadDebug("telegram_init_data_wait_completed", { waited_ms: Date.now() - waitStartedAt, init_data_present: true, result: "present" });
      return initData;
    }

    await new Promise((resolve) => window.setTimeout(resolve, INIT_DATA_INTERVAL_MS));
  }

  const initData = getSessionTelegramInitData();
  if (initData) {
    miniappReloadDebug("telegram_init_data_wait_completed", { waited_ms: Date.now() - waitStartedAt, init_data_present: true, result: "present" });
    return initData;
  }

  miniappReloadDebug("telegram_init_data_wait_completed", { waited_ms: Date.now() - waitStartedAt, init_data_present: false, result: "missing" });

  if (options.requireTelegram && isTelegramMiniApp()) {
    throw new Error("Telegram initData was not available");
  }

  return "";
}
