type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  initData?: string;
  showAlert?: (message: string) => void;
  setBackgroundColor?: (color: string) => void;
  setHeaderColor?: (color: string) => void;
};

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
};

const INIT_DATA_RETRIES = 16;
const INIT_DATA_INTERVAL_MS = 150;

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

  try {
    webApp.expand?.();
  } catch (error) {
    console.warn("Telegram WebApp expand() failed:", error);
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

  const hash = window.location.hash || "";
  const search = window.location.search || "";
  return hash.includes("tgWebAppData")
    || hash.includes("tgWebAppPlatform")
    || search.includes("tgWebAppData")
    || search.includes("tgWebAppPlatform");
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

  safePrepareTelegramWebApp();

  for (let attempt = 0; attempt < INIT_DATA_RETRIES; attempt += 1) {
    const initData = getTelegramWebApp()?.initData || "";
    if (initData) return initData;

    await new Promise((resolve) => window.setTimeout(resolve, INIT_DATA_INTERVAL_MS));
  }

  const initData = getTelegramWebApp()?.initData || "";
  if (initData) return initData;

  if (options.requireTelegram && isTelegramMiniApp()) {
    throw new Error("Telegram initData was not available");
  }

  return "";
}
