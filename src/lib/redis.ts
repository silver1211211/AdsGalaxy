import "server-only";

import { createClient } from "redis";

type AdsGalaxyRedisClient = ReturnType<typeof createClient>;

type RedisMetrics = {
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  operations: number;
  slowOperations: number;
  totalLatencyMs: number;
};

type RedisState = {
  client: AdsGalaxyRedisClient | null;
  connecting: Promise<AdsGalaxyRedisClient | null> | null;
  nextConnectAttemptAt: number;
  lastWarningAt: number;
  metrics: RedisMetrics;
};

declare global {
  var adsGalaxyRedisState: RedisState | undefined;
}

const state = globalThis.adsGalaxyRedisState ?? {
  client: null,
  connecting: null,
  nextConnectAttemptAt: 0,
  lastWarningAt: 0,
  metrics: {
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    operations: 0,
    slowOperations: 0,
    totalLatencyMs: 0,
  },
};

globalThis.adsGalaxyRedisState = state;

const numberFromEnv = (name: string, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
};

const CONNECT_TIMEOUT_MS = numberFromEnv("REDIS_CONNECT_TIMEOUT_MS", 750, 250, 2_000);
const COMMAND_TIMEOUT_MS = numberFromEnv("REDIS_COMMAND_TIMEOUT_MS", 350, 100, 1_500);
const SLOW_OPERATION_MS = numberFromEnv("REDIS_SLOW_OPERATION_MS", 150, 50, 1_000);
const RETRY_COOLDOWN_MS = 15_000;
const WARNING_INTERVAL_MS = 60_000;

export function isRedisEnabled() {
  return process.env.REDIS_ENABLED === "1" && Boolean(String(process.env.REDIS_URL || "").trim());
}

function warnOnce(message: string) {
  const now = Date.now();
  if (now - state.lastWarningAt < WARNING_INTERVAL_MS) return;
  state.lastWarningAt = now;
  console.warn(`Ads Galaxy Redis unavailable: ${message}`);
}

async function connectRedis(): Promise<AdsGalaxyRedisClient | null> {
  if (!isRedisEnabled()) return null;
  if (state.client?.isReady) return state.client;
  if (state.connecting) return state.connecting;
  if (Date.now() < state.nextConnectAttemptAt) return null;

  const url = String(process.env.REDIS_URL).trim();
  let client = state.client;
  if (!client) {
    try {
      client = createClient({
        url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: CONNECT_TIMEOUT_MS,
          reconnectStrategy: (retries) => Math.min(5_000, 250 * 2 ** Math.min(retries, 4)),
        },
      });
    } catch (error) {
      state.nextConnectAttemptAt = Date.now() + RETRY_COOLDOWN_MS;
      warnOnce(error instanceof Error ? error.message : "invalid configuration");
      return null;
    }
  }
  if (!state.client) {
    state.client = client;
    client.on("error", () => {
      state.metrics.errors += 1;
    });
  }

  state.connecting = (async () => {
    try {
      if (!client.isOpen) {
        let connectTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            client.connect(),
            new Promise<never>((_, reject) => {
              connectTimer = setTimeout(() => reject(new Error("connection timeout")), CONNECT_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (connectTimer) clearTimeout(connectTimer);
        }
      }
      return client.isReady ? client : null;
    } catch (error) {
      state.nextConnectAttemptAt = Date.now() + RETRY_COOLDOWN_MS;
      warnOnce(error instanceof Error ? error.message : "connection failed");
      try { client.destroy(); } catch { /* already closed */ }
      state.client = null;
      return null;
    } finally {
      state.connecting = null;
    }
  })();

  return state.connecting;
}

export async function withRedis<T>(operation: (client: AdsGalaxyRedisClient) => Promise<T>): Promise<T | null> {
  const client = await connectRedis();
  if (!client) return null;

  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("command timeout")), COMMAND_TIMEOUT_MS);
    });
    const result = await Promise.race([operation(client), timeout]);
    return result;
  } catch (error) {
    state.metrics.errors += 1;
    warnOnce(error instanceof Error ? error.message : "operation failed");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    const elapsed = Date.now() - startedAt;
    state.metrics.operations += 1;
    state.metrics.totalLatencyMs += elapsed;
    if (elapsed >= SLOW_OPERATION_MS) state.metrics.slowOperations += 1;
  }
}

export function recordRedisCacheResult(hit: boolean) {
  if (hit) state.metrics.cacheHits += 1;
  else state.metrics.cacheMisses += 1;
}

export function getRedisMetrics() {
  const { metrics } = state;
  return {
    ...metrics,
    averageLatencyMs: metrics.operations > 0 ? Number((metrics.totalLatencyMs / metrics.operations).toFixed(2)) : 0,
  };
}

export async function getRedisHealth() {
  if (!isRedisEnabled()) {
    return { redis_enabled: false, redis_available: false, redis_latency_ms: null, metrics: getRedisMetrics() };
  }
  const startedAt = Date.now();
  const pong = await withRedis((client) => client.ping());
  return {
    redis_enabled: true,
    redis_available: pong === "PONG",
    redis_latency_ms: pong === "PONG" ? Date.now() - startedAt : null,
    metrics: getRedisMetrics(),
  };
}
