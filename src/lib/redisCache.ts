import "server-only";

import crypto from "crypto";
import { recordRedisCacheResult, withRedis } from "@/lib/redis";

const configuredPrefix = String(process.env.REDIS_PREFIX || "ag:v1").trim();
export const REDIS_KEY_PREFIX = /^[A-Za-z0-9:_-]{1,64}$/.test(configuredPrefix) ? configuredPrefix : "ag:v1";

export const CACHE_TTL_SECONDS = Object.freeze({
  ADMIN_DASHBOARD: 12,
  ADMIN_DASHBOARD_SUMMARY: 12,
  PUBLISHER_ANALYTICS: 8,
  ADVERTISER_ANALYTICS: 8,
  CAMPAIGN_LIST: 7,
  PUBLIC_SETTINGS: 45,
  ADMIN_SETTINGS: 30,
  TELEGRAM_METADATA: 120,
});

const segment = (value: string | number) => encodeURIComponent(String(value)).slice(0, 120);
const privateSegment = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
const key = (...parts: Array<string | number>) => [REDIS_KEY_PREFIX, ...parts.map(segment)].join(":");

export const redisKeys = Object.freeze({
  adminDashboard: () => key("admin", "dashboard"),
  adminDashboardSummary: () => key("admin", "dashboard-summary"),
  publisherStats: (userId: number) => key("publisher", "stats", userId),
  advertiserStats: (userId: number) => key("advertiser", "stats", userId),
  campaignList: (userId: number, limit: number) => key("campaign", "list", userId, limit),
  campaignListPrefix: (userId: number) => key("campaign", "list", userId),
  publicSettings: () => key("settings", "public"),
  adminSettings: () => key("settings", "admin"),
  telegramChat: (chatId: string | number) => key("telegram", "chat", privateSegment(String(chatId))),
  cronLock: (name: string) => key("lock", "cron", name),
  rateLimit: (scope: string, identifier: string) => key("rate", scope, privateSegment(identifier)),
  broadcastWake: () => key("broadcast", "wake"),
});

type CacheEnvelope<T> = { version: 1; createdAt: number; value: T };
type CacheRead<T> = { hit: true; value: T } | { hit: false };
const inFlight = new Map<string, Promise<unknown>>();

export async function cacheGet<T>(cacheKey: string): Promise<CacheRead<T>> {
  const raw = await withRedis((client) => client.get(cacheKey));
  if (raw === null) {
    recordRedisCacheResult(false);
    return { hit: false };
  }
  try {
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (!envelope || envelope.version !== 1 || !("value" in envelope)) throw new Error("invalid cache envelope");
    recordRedisCacheResult(true);
    return { hit: true, value: envelope.value };
  } catch {
    await cacheDelete(cacheKey);
    recordRedisCacheResult(false);
    return { hit: false };
  }
}

export async function cacheSet<T>(cacheKey: string, value: T, ttlSeconds: number) {
  if (value === undefined || !Number.isFinite(ttlSeconds) || ttlSeconds < 1) return false;
  let serialized: string;
  try {
    serialized = JSON.stringify({ version: 1, createdAt: Date.now(), value } satisfies CacheEnvelope<T>);
  } catch {
    return false;
  }
  const result = await withRedis((client) => client.set(cacheKey, serialized, { EX: Math.trunc(ttlSeconds) }));
  return result === "OK";
}

export async function cacheDelete(...cacheKeys: string[]) {
  if (cacheKeys.length === 0) return false;
  const result = await withRedis((client) => client.del(cacheKeys));
  return typeof result === "number";
}

export async function cacheDeletePrefix(prefix: string, maximumKeys = 500) {
  const deleted = await withRedis(async (client) => {
    let cursor = "0";
    let total = 0;
    do {
      const page = await client.scan(cursor, { MATCH: `${prefix}:*`, COUNT: 100 });
      cursor = page.cursor;
      const remaining = Math.max(0, maximumKeys - total);
      const keys = page.keys.slice(0, remaining);
      if (keys.length > 0) total += await client.del(keys);
      if (total >= maximumKeys) break;
    } while (cursor !== "0");
    return total;
  });
  return deleted ?? 0;
}

export async function cacheGetOrSet<T>(
  cacheKey: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  options: { bypass?: boolean } = {},
): Promise<T> {
  if (!options.bypass) {
    const cached = await cacheGet<T>(cacheKey);
    if (cached.hit) return cached.value;
  }

  const current = inFlight.get(cacheKey) as Promise<T> | undefined;
  if (current) return current;

  const fill = (async () => {
    const value = await loader();
    if (value !== undefined && !options.bypass) await cacheSet(cacheKey, value, ttlSeconds);
    return value;
  })();
  inFlight.set(cacheKey, fill);
  try {
    return await fill;
  } finally {
    if (inFlight.get(cacheKey) === fill) inFlight.delete(cacheKey);
  }
}

export async function invalidateAdvertiserCaches(userId: number) {
  await Promise.all([
    cacheDelete(redisKeys.advertiserStats(userId)),
    cacheDeletePrefix(redisKeys.campaignListPrefix(userId)),
  ]);
}

export async function invalidateSettingsCaches() {
  await cacheDelete(redisKeys.publicSettings(), redisKeys.adminSettings(), redisKeys.adminDashboard());
}
