import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function compileModule(source, globals = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const runtimeModule = { exports: {} };
  vm.runInNewContext(output, {
    module: runtimeModule, exports: runtimeModule.exports, require, process, console, URL,
    encodeURIComponent, setTimeout, clearTimeout, ...globals,
  });
  return runtimeModule.exports;
}

function memoryRedis() {
  const values = new Map();
  const ttl = new Map();
  const client = {
    async get(key) { return values.has(key) ? values.get(key) : null; },
    async set(key, value, options) {
      if (options?.NX && values.has(key)) return null;
      values.set(key, value);
      ttl.set(key, options?.EX ?? options?.PX ?? null);
      return "OK";
    },
    async del(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      let deleted = 0;
      for (const key of list) deleted += values.delete(key) ? 1 : 0;
      return deleted;
    },
    async scan() { return { cursor: "0", keys: [...values.keys()] }; },
    async eval(_script, args) {
      const key = args.keys[0];
      if (values.get(key) === args.arguments[0]) return this.del(key);
      return 0;
    },
  };
  return { client, values, ttl };
}

function loadCache(available = true) {
  const redis = memoryRedis();
  const source = read("src/lib/redisCache.ts")
    .replace('import "server-only";', "")
    .replace(/import \{ recordRedisCacheResult, withRedis \} from "@\/lib\/redis";/, "const { recordRedisCacheResult, withRedis } = globalThis.__redisTest;");
  const api = compileModule(source, {
    __redisTest: {
      recordRedisCacheResult() {},
      withRedis: async (operation) => available ? operation(redis.client) : null,
    },
  });
  return { api, redis };
}

test("Redis disabled or unavailable fails open to the original loader", async () => {
  const { api } = loadCache(false);
  let calls = 0;
  const value = await api.cacheGetOrSet("ag:v1:test:offline", 10, async () => ({ calls: ++calls }));
  assert.equal(value.calls, 1);
  assert.equal(calls, 1);
});

test("cache miss fills with TTL and cache hit avoids the expensive loader", async () => {
  const { api, redis } = loadCache(true);
  let calls = 0;
  const loader = async () => ({ calls: ++calls });
  assert.equal((await api.cacheGetOrSet("ag:v1:test:hit", 17, loader)).calls, 1);
  assert.equal((await api.cacheGetOrSet("ag:v1:test:hit", 17, loader)).calls, 1);
  assert.equal(calls, 1);
  assert.equal(redis.ttl.get("ag:v1:test:hit"), 17);
});

test("malformed cache is deleted and rebuilt safely", async () => {
  const { api, redis } = loadCache(true);
  redis.values.set("ag:v1:test:malformed", "not-json");
  const result = await api.cacheGetOrSet("ag:v1:test:malformed", 9, async () => ({ rebuilt: true }));
  assert.equal(result.rebuilt, true);
  assert.match(redis.values.get("ag:v1:test:malformed"), /\"version\":1/);
});

test("cache keys are versioned, user-isolated, and hash sensitive identifiers", () => {
  const { api } = loadCache(true);
  assert.match(api.redisKeys.publisherStats(41), /^ag:v1:publisher:stats:41$/);
  assert.notEqual(api.redisKeys.publisherStats(41), api.redisKeys.publisherStats(42));
  const secret = "raw-user-identifier";
  assert.doesNotMatch(api.redisKeys.rateLimit("auth", secret), /raw-user-identifier/);
});

test("identical cache fills are coalesced in process", async () => {
  const { api } = loadCache(false);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true };
  };
  await Promise.all([
    api.cacheGetOrSet("ag:v1:test:coalesce", 10, loader),
    api.cacheGetOrSet("ag:v1:test:coalesce", 10, loader),
  ]);
  assert.equal(calls, 1);
});

test("distributed lock uses NX/PX and token-safe atomic release", async () => {
  const redis = memoryRedis();
  const source = read("src/lib/redisLock.ts")
    .replace('import "server-only";', "")
    .replace(/import \{ withRedis \} from "@\/lib\/redis";/, "const { withRedis } = globalThis.__redisTest;");
  const api = compileModule(source, {
    __redisTest: { withRedis: async (operation) => operation(redis.client) },
  });
  const first = await api.acquireRedisLock("ag:v1:lock:test", 5_000);
  const second = await api.acquireRedisLock("ag:v1:lock:test", 5_000);
  assert.equal(first.status, "acquired");
  assert.equal(second.status, "busy");
  assert.equal(redis.ttl.get("ag:v1:lock:test"), 5_000);
  assert.equal(await api.releaseRedisLock({ key: first.lock.key, token: "another-owner" }), false);
  assert.equal(redis.values.has("ag:v1:lock:test"), true);
  assert.equal(await api.releaseRedisLock(first.lock), true);
});

test("source integrations preserve finance, durable broadcasts, boot, localization, and channel hotfix", () => {
  const advertiserStats = read("src/app/api/advertiser/stats/route.ts");
  const campaigns = read("src/app/api/advertiser/campaigns/[id]/route.ts");
  const settings = read("src/app/api/admin/settings/route.ts");
  const cron = read("src/lib/cronSecurity.ts");
  const broadcast = read("src/app/api/admin/platform-broadcasts/route.ts");
  const boot = read("src/components/shared/AppBootState.tsx");
  const channelRoute = read("src/app/api/publisher/channels/route.ts");
  assert.match(advertiserStats, /ad_balance: Number\(user\.ad_balance/);
  assert.match(campaigns, /campaignMutationSuccess|requireUserWritesAllowed/);
  assert.match(campaigns, /await conn\.commit\(\);\s*return campaignMutationSuccess/);
  assert.match(settings, /invalidateSettingsCaches/);
  assert.match(cron, /database lock remains authoritative/i);
  assert.match(cron, /acquireRedisLock/);
  assert.match(broadcast, /INSERT INTO platform_broadcasts/);
  assert.match(broadcast, /await connection\.commit\(\)/);
  assert.doesNotMatch(boot, /redis/i);
  assert.match(read("src/i18n/ru.ts"), /const ru =/);
  assert.match(read("src/i18n/ru.ts"), /export default ru/);
  assert.match(channelRoute, /normalizeTelegramChannelTitle\(chatData\.result\?\.title\)/);
});

test("Redis source is singleton, fast-fail, optional, and does not expose connection secrets", () => {
  const redis = read("src/lib/redis.ts");
  assert.match(redis, /globalThis\.adsGalaxyRedisState/);
  assert.match(redis, /REDIS_ENABLED === "1"/);
  assert.match(redis, /REDIS_CONNECT_TIMEOUT_MS/);
  assert.match(redis, /disableOfflineQueue: true/);
  assert.doesNotMatch(redis, /console\.(?:log|warn|error)\([^\n]*REDIS_URL/);
});

test("all requested cache, invalidation, rate-limit, and metadata integrations are present", () => {
  const admin = read("src/app/api/admin/dashboard/route.ts");
  const publisher = read("src/app/api/publisher/stats/route.ts");
  const advertiser = read("src/app/api/advertiser/stats/route.ts");
  const campaignList = read("src/app/api/advertiser/campaigns/route.ts");
  const campaignWrite = read("src/app/api/advertiser/campaigns/[id]/route.ts");
  const publicSettings = read("src/app/api/settings/route.ts");
  const adminSettings = read("src/app/api/admin/settings/route.ts");
  const metadata = read("src/app/api/cron/update-views/route.ts");
  const limiter = read("src/lib/redisRateLimit.ts");
  const channelCheck = read("src/lib/channelCheckAccess.ts");
  assert.match(admin, /redisKeys\.adminDashboard\(\)/);
  assert.match(publisher, /redisKeys\.publisherStats\(Number\(user\.id\)\)/);
  assert.match(advertiser, /redisKeys\.advertiserStats\(userId\)/);
  assert.match(campaignList, /redisKeys\.campaignList\(Number\(user\.id\), limit\)/);
  assert.match(campaignList, /invalidateAdvertiserCaches\(Number\(user\.id\)\)/);
  assert.match(campaignWrite, /campaignMutationSuccess/);
  assert.match(publicSettings, /redisKeys\.publicSettings\(\)/);
  assert.match(adminSettings, /settingsSuccess/);
  assert.match(metadata, /CACHE_TTL_SECONDS\.TELEGRAM_METADATA/);
  assert.match(limiter, /redis\.call\('INCR',KEYS\[1\]\)/);
  assert.match(limiter, /redis\.call\('PEXPIRE'/);
  assert.match(channelCheck, /recordDistributedRateLimitFailure/);
  for (const source of [read("src/lib/redis.ts"), read("src/lib/redisCache.ts"), limiter]) {
    assert.doesNotMatch(source, /initData/);
    assert.doesNotMatch(source, /KEYS \*/);
    assert.doesNotMatch(source, /FLUSHALL|FLUSHDB/);
  }
});
