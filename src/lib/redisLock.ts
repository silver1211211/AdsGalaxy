import "server-only";

import crypto from "crypto";
import { withRedis } from "@/lib/redis";

export type RedisLock = { key: string; token: string };
export type RedisLockAttempt =
  | { status: "acquired"; lock: RedisLock }
  | { status: "busy" }
  | { status: "unavailable" };

export async function acquireRedisLock(key: string, ttlMs: number): Promise<RedisLockAttempt> {
  const token = crypto.randomUUID();
  const boundedTtl = Math.min(24 * 60 * 60 * 1000, Math.max(1_000, Math.trunc(ttlMs)));
  const result = await withRedis(async (client) => (await client.set(key, token, { NX: true, PX: boundedTtl })) ?? "BUSY");
  if (result === null) return { status: "unavailable" };
  if (result === "BUSY") return { status: "busy" };
  return { status: "acquired", lock: { key, token } };
}

export async function releaseRedisLock(lock: RedisLock | null) {
  if (!lock) return false;
  const result = await withRedis((client) => client.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    { keys: [lock.key], arguments: [lock.token] },
  ));
  return Number(result || 0) === 1;
}
