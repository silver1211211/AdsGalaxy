import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { createRequire } from "node:module";

dotenv.config({ path: ".env", quiet: true });
const nativeRequire = createRequire(import.meta.url);
function load(file, deps = {}, extra = "") {
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", compiled + extra)(
    module, module.exports, name => deps[name] ?? nativeRequire(name),
  );
  return module.exports;
}
const schema = "test_cpm_schedule_" + Date.now();
const quote = name => "`" + name + "`";
const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};
const cursorKey = "channel_cpm_window_scheduler_cursor_v1";
const report = (nextCursor, overrides = {}) => ({
  status: "completed", scanned: 1, plansPrepared: 1, creditsFinalized: 0,
  duplicatePlans: 0, duplicateCredits: 0, blocked: 0, lateReview: 0,
  failures: 0, items: [], nextCursor, retryFailedFromStart: false, ...overrides,
});

test("scheduled CPM runtime uses a disposable MariaDB cursor and fails closed", async t => {
  assert.match(schema, /^test_cpm_schedule_[0-9]+$/);
  const originalCpm = process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
  let unifiedActive = true;
  const admin = await mysql.createConnection({ ...config, database: process.env.DB_NAME });
  let pool, created = false;
  let processor = async () => report(null, { status: "disabled", scanned: 0, plansPrepared: 0 });
  const calls = [];
  const scheduler = load("src/lib/channelCpmWindowScheduler.ts", {
    "@/lib/channelUnifiedSettlement": { isUnifiedSettlementActive: () => unifiedActive },
    "@/lib/channelCpmWindowProcessor": {
      processDueCpmWindows: async (...args) => {
        calls.push(args[1]);
        return processor(...args);
      },
    },
  }, "\nexports.testTables = REQUIRED_TABLES; exports.testTriggers = REQUIRED_TRIGGERS;");
  try {
    await admin.query("CREATE DATABASE " + quote(schema));
    created = true;
    pool = mysql.createPool({ ...config, database: schema, connectionLimit: 4 });
    await pool.query("CREATE TABLE settings (`key` VARCHAR(255) PRIMARY KEY,value MEDIUMTEXT NOT NULL,description MEDIUMTEXT NULL)");
    await t.test("flag off touches no database", async () => {
      delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
      const off = await scheduler.runCpmWindowSchedule({
        query() { throw new Error("unexpected_query"); },
        getConnection() { throw new Error("unexpected_connection"); },
      });
      assert.equal(off.status, "disabled");
      assert.equal(off.cursorPersisted, false);
      assert.equal(calls.length, 1);
    });
    process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED = "true";
    await t.test("window mode requires the canonical unified writer", async () => {
      unifiedActive = false;
      try {
        await assert.rejects(scheduler.runCpmWindowSchedule(pool),
          /cpm_window_requires_unified_settlement/);
        assert.equal(calls.length, 1);
      } finally {
        unifiedActive = true;
      }
    });
    await t.test("missing migration tables fail before processing", async () => {
      await assert.rejects(scheduler.runCpmWindowSchedule(pool), /cpm_window_missing_tables/);
      assert.equal(calls.length, 1);
      const [rows] = await pool.query("SELECT * FROM settings");
      assert.equal(rows.length, 0);
    });
    for (const name of scheduler.testTables.filter(name => name !== "settings")) {
      await pool.query("CREATE TABLE " + quote(name) + " (id INT PRIMARY KEY)");
    }
    for (const name of scheduler.testTriggers) {
      await pool.query("CREATE TRIGGER " + quote(name) +
        " BEFORE UPDATE ON users FOR EACH ROW SET @cpm_schedule_test = 1");
    }
    await t.test("missing immutable-plan trigger fails before processing", async () => {
      const missing = scheduler.testTriggers[0];
      await pool.query("DROP TRIGGER " + quote(missing));
      await assert.rejects(scheduler.runCpmWindowSchedule(pool), /cpm_window_missing_plan_guards/);
      assert.equal(calls.length, 1);
      await pool.query("CREATE TRIGGER " + quote(missing) +
        " BEFORE UPDATE ON users FOR EACH ROW SET @cpm_schedule_test = 1");
    });
    await t.test("bounded pages resume and restart from the beginning after a sweep", async () => {
      const firstCursor = { finalizableEpoch: 1000, windowId: 10 };
      processor = async (_db, options) => {
        assert.equal(options.maxWindows, 1);
        assert.equal(options.pageSize, 1);
        return options.cursor ? report(null, { plansPrepared: 0, creditsFinalized: 1 }) :
          report(firstCursor);
      };
      const first = await scheduler.runCpmWindowSchedule(pool, { maxWindows: 1, pageSize: 1 });
      assert.equal(first.cursorPersisted, true);
      assert.equal(first.nextCursor.windowId, 10);
      const [[saved]] = await pool.query("SELECT value FROM settings WHERE `key`=?", [cursorKey]);
      assert.deepEqual(JSON.parse(saved.value), { version: 1, ...firstCursor });
      const second = await scheduler.runCpmWindowSchedule(pool, { maxWindows: 1, pageSize: 1 });
      assert.equal(second.creditsFinalized, 1);
      assert.deepEqual(calls.at(-1).cursor, firstCursor);
      const [[cleared]] = await pool.query("SELECT value FROM settings WHERE `key`=?", [cursorKey]);
      assert.equal(cleared.value, "");
      await scheduler.runCpmWindowSchedule(pool, { maxWindows: 1, pageSize: 1 });
      assert.equal(calls.at(-1).cursor, null);
    });
    await t.test("failed page continues forward, then retries on the next sweep", async () => {
      await pool.query("UPDATE settings SET value='' WHERE `key`=?", [cursorKey]);
      const seen = [];
      processor = async (_db, options) => {
        seen.push(options.cursor?.windowId ?? 0);
        return options.cursor ? report(null, { plansPrepared: 0, creditsFinalized: 1 }) :
          report({ finalizableEpoch: 1000, windowId: 10 }, {
            status: "partial_failure", failures: 1, plansPrepared: 0,
            retryFailedFromStart: true,
          });
      };
      await scheduler.runCpmWindowSchedule(pool, { maxWindows: 1 });
      await scheduler.runCpmWindowSchedule(pool, { maxWindows: 1 });
      await scheduler.runCpmWindowSchedule(pool, { maxWindows: 1 });
      assert.deepEqual(seen, [0, 10, 0]);
    });
    await t.test("two invocations keep a consistent persisted cursor", async () => {
      await pool.query("UPDATE settings SET value='' WHERE `key`=?", [cursorKey]);
      processor = async () => report({ finalizableEpoch: 2000, windowId: 20 });
      const results = await Promise.all([
        scheduler.runCpmWindowSchedule(pool, { maxWindows: 1 }),
        scheduler.runCpmWindowSchedule(pool, { maxWindows: 1 }),
      ]);
      assert.ok(results.every(value => value.cursorPersisted));
      const [[saved]] = await pool.query("SELECT value FROM settings WHERE `key`=?", [cursorKey]);
      assert.equal(JSON.parse(saved.value).windowId, 20);
    });
    await t.test("corrupt saved cursor fails without processing", async () => {
      await pool.query("UPDATE settings SET value='corrupt' WHERE `key`=?", [cursorKey]);
      const before = calls.length;
      await assert.rejects(scheduler.runCpmWindowSchedule(pool), /cpm_window_invalid_saved_cursor/);
      assert.equal(calls.length, before);
    });
  } finally {
    if (originalCpm === undefined) delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
    else process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED = originalCpm;
    if (pool) await pool.end();
    if (created) await admin.query("DROP DATABASE " + quote(schema));
    await admin.end();
  }
});

test("channel settlement route invokes CPM after existing CPC path", async t => {
  const calls = [];
  let enabled = false;
  let failPreflight = false;
  let cpmResult = { ...report(null), cursorPersisted: true };
  const route = load("src/app/api/cron/channel-settlement/route.ts", {
    "next/server": { NextResponse: { json: (body, options = {}) =>
      ({ body, status: options.status ?? 200 }) } },
    "@/lib/channelSettlement": { settleChannelCampaigns: async () => {
      calls.push("channel"); return { failedPosts: 0 };
    } },
    "@/lib/cronSecurity": {
      requireCronSecret: () => null,
      acquireCronLock: async () => { calls.push("lock"); return { lockName: "test" }; },
      releaseCronLock: async () => { calls.push("unlock"); },
    },
    "@/lib/channelFastBilling": { settlePendingChannelPublisherCredits: async () => {
      calls.push("pending"); return { failed: 0, missingPolicy: 0 };
    } },
    "@/lib/channelUnifiedSettlement": { isUnifiedSettlementActive: () => enabled },
    "@/lib/db": { default: {} },
    "@/lib/channelCpcPriorityScheduler": {
      isCpcPrioritySchedulerEnabled: () => true,
      runCpcPriorityRewardSchedule: async () => {
        calls.push("cpc"); return { outcomes: [] };
      },
    },
    "@/lib/channelCpmWindowScheduler": {
      isCpmWindowSchedulerEnabled: () => enabled,
      assertCpmWindowRuntimeReady: async () => {
        calls.push("preflight");
        if (failPreflight) throw new Error("cpm_window_missing_tables");
      },
      runCpmWindowSchedule: async () => { calls.push("cpm"); return cpmResult; },
    },
  });
  const request = { url: "http://localhost/api/cron/channel-settlement", headers: new Headers() };
  await t.test("disabled CPM preserves existing route and CPC scheduling", async () => {
    calls.length = 0;
    const response = await route.GET(request);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["lock", "pending", "channel", "cpc", "unlock"]);
    assert.equal("cpmWindowSchedule" in response.body, false);
  });
  await t.test("enabled CPM runs schema preflight before money, then scheduler", async () => {
    enabled = true;
    calls.length = 0;
    const response = await route.GET(request);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["lock", "preflight", "pending", "channel", "cpc", "cpm", "unlock"]);
    assert.equal(response.body.cpmWindowSchedule.cursorPersisted, true);
  });
  await t.test("missing schema blocks all channel financial work", async () => {
    failPreflight = true;
    calls.length = 0;
    const response = await route.GET(request);
    assert.equal(response.status, 503);
    assert.deepEqual(calls, ["lock", "preflight", "unlock"]);
    failPreflight = false;
  });
  await t.test("CPM failure is reported while CPC still runs", async () => {
    cpmResult = { ...report(null, { status: "partial_failure", failures: 1 }),
      cursorPersisted: true };
    calls.length = 0;
    const response = await route.GET(request);
    assert.equal(response.status, 503);
    assert.deepEqual(calls, ["lock", "preflight", "pending", "channel", "cpc", "cpm", "unlock"]);
  });
});
