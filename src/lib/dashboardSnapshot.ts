const SNAPSHOT_VERSION = 2;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

type StoredSnapshot<T> = { version: number; savedAt: number; data: T };

function telegramIdentity() {
  if (typeof window === "undefined") return null;
  const id = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return id ? String(id) : null;
}

function key(mode: "publisher" | "advertiser", identity: string) {
  return `adsgalaxy:dashboard:${SNAPSHOT_VERSION}:${mode}:${identity}`;
}

export function readDashboardSnapshot<T>(mode: "publisher" | "advertiser"): T | null {
  const identity = telegramIdentity();
  if (!identity) return null;
  try {
    const stored = JSON.parse(localStorage.getItem(key(mode, identity)) || "null") as StoredSnapshot<T> | null;
    if (!stored || stored.version !== SNAPSHOT_VERSION || Date.now() - stored.savedAt > MAX_AGE_MS) return null;
    return stored.data;
  } catch { return null; }
}

export function writeDashboardSnapshot<T extends Record<string, unknown>>(mode: "publisher" | "advertiser", value: T) {
  const identity = telegramIdentity();
  if (!identity) return;
  const data = { ...value } as Record<string, unknown>;
  for (const field of ["balance_available", "balance_locked", "balance_pending", "ad_balance", "ad_balance_locked", "advertiser_balance_locked"]) delete data[field];
  try { localStorage.setItem(key(mode, identity), JSON.stringify({ version: SNAPSHOT_VERSION, savedAt: Date.now(), data })); }
  catch { /* Storage may be unavailable in privacy-constrained WebViews. */ }
}
