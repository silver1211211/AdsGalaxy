import "server-only";

import { withRedis } from "@/lib/redis";

export type DistributedRateLimitState = {
  available: boolean;
  limited: boolean;
  count: number;
  retryAfterMs: number;
};

function normalizeResult(result: unknown): [number, number] | null {
  if (!Array.isArray(result) || result.length < 2) return null;
  return [Number(result[0] || 0), Math.max(0, Number(result[1] || 0))];
}

export async function getDistributedRateLimitState(key: string, maximumAttempts: number): Promise<DistributedRateLimitState> {
  const result = await withRedis((client) => client.eval(
    "local value=redis.call('GET',KEYS[1]); local ttl=redis.call('PTTL',KEYS[1]); return {tonumber(value) or 0, ttl}",
    { keys: [key], arguments: [] },
  ));
  const normalized = normalizeResult(result);
  if (!normalized) return { available: false, limited: false, count: 0, retryAfterMs: 0 };
  return {
    available: true,
    limited: normalized[0] >= maximumAttempts && normalized[1] > 0,
    count: normalized[0],
    retryAfterMs: normalized[1],
  };
}

export async function recordDistributedRateLimitFailure(
  key: string,
  maximumAttempts: number,
  windowMs: number,
  lockMs: number,
): Promise<DistributedRateLimitState> {
  const result = await withRedis((client) => client.eval(
    "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; if count>=tonumber(ARGV[2]) then redis.call('PEXPIRE',KEYS[1],ARGV[3]) end; return {count,redis.call('PTTL',KEYS[1])}",
    { keys: [key], arguments: [String(windowMs), String(maximumAttempts), String(lockMs)] },
  ));
  const normalized = normalizeResult(result);
  if (!normalized) return { available: false, limited: false, count: 0, retryAfterMs: 0 };
  return {
    available: true,
    limited: normalized[0] >= maximumAttempts,
    count: normalized[0],
    retryAfterMs: normalized[1],
  };
}

export async function clearDistributedRateLimit(key: string) {
  const result = await withRedis((client) => client.del(key));
  return typeof result === "number";
}
