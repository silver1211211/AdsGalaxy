import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { createRequire } from "node:module";

dotenv.config({ path: ".env", quiet: true });
const nativeRequire = createRequire(import.meta.url);
const schema = `test_publisher_policy_${Date.now()}`;
const quote = (name) => `\u0060${name}\u0060`;
function load(file, deps = {}, expose) {
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const extra = expose ? `\nexports.testOperation = ${expose};` : "";
  new Function("module", "exports", "require", js + extra)(mod, mod.exports,
    (name) => deps[name] ?? nativeRequire(name));
  return mod.exports;
}
const posting = load("src/lib/financialPostingContext.ts");
const earnings = load("src/lib/earnings.ts", { "./financialPostingContext": posting });
const connection = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASS };

test("real Bot and Mini App settlements credit available funds only after success", async (t) => {
  assert.match(schema, /^test_publisher_policy_\d+$/);
  const admin = await mysql.createConnection({ ...connection, database: process.env.DB_NAME });
  let db; let created = false;
  try {
    await admin.query("CREATE DATABASE " + quote(schema)); created = true;
    db = mysql.createPool({ ...connection, database: schema, connectionLimit: 6, decimalNumbers: false });
    for (const ddl of [
      "CREATE TABLE users (id INT PRIMARY KEY,balance_available DECIMAL(20,8) NOT NULL,balance_locked DECIMAL(20,8) NOT NULL,telegram_id BIGINT NULL) ENGINE=InnoDB",
      "CREATE TABLE bots (id INT PRIMARY KEY,user_id INT NOT NULL) ENGINE=InnoDB",
      "CREATE TABLE broadcast_deliveries (id INT PRIMARY KEY,bot_id INT NOT NULL,status VARCHAR(30) NOT NULL,publisher_reward DECIMAL(20,8) NOT NULL,publisher_settled_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE miniapps (id INT PRIMARY KEY,user_id INT NOT NULL) ENGINE=InnoDB",
      "CREATE TABLE miniapp_internal_ad_impressions (id INT PRIMARY KEY,miniapp_id INT NOT NULL,publisher_revenue DECIMAL(20,8) NOT NULL,created_at DATETIME NOT NULL) ENGINE=InnoDB",
      "CREATE TABLE miniapp_internal_publisher_settlements (id INT AUTO_INCREMENT PRIMARY KEY,impression_id INT NOT NULL UNIQUE,miniapp_id INT NOT NULL,publisher_id INT NOT NULL,publisher_revenue DECIMAL(20,8) NOT NULL,status VARCHAR(30) NOT NULL,stats_applied TINYINT NOT NULL DEFAULT 0,settled_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE miniapp_daily_stats (miniapp_id INT NOT NULL,network_name VARCHAR(40) NOT NULL,date DATE NOT NULL,impressions INT NOT NULL,publisher_revenue DECIMAL(20,8) NOT NULL,net_cpm DECIMAL(20,8) NOT NULL) ENGINE=InnoDB",
      "CREATE TABLE settings (`key` VARCHAR(40) PRIMARY KEY,value VARCHAR(40) NOT NULL) ENGINE=InnoDB",
      "CREATE TABLE withdrawals (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,amount DECIMAL(20,8) NOT NULL,fee DECIMAL(20,8) NOT NULL,net_amount DECIMAL(20,8) NOT NULL,network VARCHAR(20),address VARCHAR(120),idempotency_key VARCHAR(191) UNIQUE,request_fingerprint VARCHAR(191),status VARCHAR(30),refunded TINYINT DEFAULT 0,reject_reason VARCHAR(255),created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    ]) await db.query(ddl);
    await db.query("INSERT INTO users (id,balance_available,balance_locked) VALUES (1,'10.00000000','5.00000000'),(2,'0.00000000','7.00000000'),(3,'50.00000000','9.00000000')");
    await db.query("INSERT INTO settings VALUES ('max_withdraw','100')");
    await db.query("INSERT INTO bots VALUES (10,1)");
    await db.query("INSERT INTO broadcast_deliveries VALUES (100,10,'sent','1.23456789',NULL),(101,10,'failed','2.00000000',NULL)");
    await db.query("INSERT INTO miniapps VALUES (20,1),(21,2)");
    await db.query("INSERT INTO miniapp_internal_ad_impressions VALUES (200,20,'0.01234567',NOW())");
    await db.query("INSERT INTO miniapp_daily_stats VALUES (20,'AdsGalaxyInternal',UTC_DATE(),1,0,0),(21,'AdsGalaxyInternal',UTC_DATE(),1,0,0)");
    const common = { "next/server": { NextResponse: { json: () => ({}) } },
      "@/lib/db": { default: db }, "@/lib/earnings": earnings,
      "@/lib/referralCommission": { recordReferralCommission: async () => {} },
      "@/lib/cronSecurity": { acquireCronLock: async () => null, releaseCronLock: async () => {}, requireCronSecret: () => null },
      "@/lib/revenueProtection": { recordPayoutSafetyCheck: async () => ({ status: "passed" }) },
      "@/lib/dbResilience": { withFinancialTransactionRetry: async (fn) => {
        const c = await db.getConnection();
        try { await c.beginTransaction(); const result = await fn(c); await c.commit(); return result; }
        catch (error) { await c.rollback(); throw error; }
        finally { c.release(); }
      } },
    };
    const bot = load("src/app/api/cron/settle-broadcast-publishers/route.ts", common, "settleBroadcastPublisherDelivery").testOperation;
    const mini = load("src/app/api/cron/settle-miniapp/route.ts", common, "settleInternalImpressions").testOperation;
    await t.test("Bot settlement and concurrent retry credit once; failed delivery credits nothing", async () => {
      const results = await Promise.all([bot(100, db), bot(100, db)]);
      assert.deepEqual(results.map((x) => x.settled).sort(), [false, true]);
      assert.equal((await bot(101, db)).settled, false);
      const [[u]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=1");
      assert.deepEqual([u.balance_available,u.balance_locked], ["11.23456789","5.00000000"]);
      const [[d]] = await db.query("SELECT publisher_settled_at IS NOT NULL done FROM broadcast_deliveries WHERE id=100");
      assert.equal(d.done, 1);
    });
    await t.test("Mini App success is immediate, exact, and idempotent", async () => {
      assert.equal((await mini()).settled, 1);
      assert.equal((await mini()).settled, 0);
      const [[u]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=1");
      assert.deepEqual([u.balance_available,u.balance_locked], ["11.24691356","5.00000000"]);
      const [[s]] = await db.query("SELECT status,publisher_revenue FROM miniapp_internal_publisher_settlements WHERE impression_id=200");
      assert.deepEqual([s.status,s.publisher_revenue], ["unlocked","0.01234567"]);
    });
    await t.test("failed Mini App credit rolls back and leaves historical locked balance unchanged", async () => {
      await db.query("INSERT INTO miniapp_internal_ad_impressions VALUES (201,21,'0.11111111',NOW())");
      await db.query("CREATE TRIGGER reject_test_credit BEFORE UPDATE ON users FOR EACH ROW IF NEW.id=2 AND NEW.balance_available>OLD.balance_available THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test_credit_failure'; END IF");
      const before = console.error; console.error = () => {};
      try { assert.equal((await mini()).settled, 0); } finally { console.error = before; }
      const [[u]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
      assert.deepEqual([u.balance_available,u.balance_locked], ["0.00000000","7.00000000"]);
      const [[s]] = await db.query("SELECT COUNT(*) n FROM miniapp_internal_publisher_settlements WHERE impression_id=201");
      assert.equal(s.n, 0);
      await db.query("DROP TRIGGER reject_test_credit");
      assert.equal((await mini()).settled, 1);
      const [[after]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
      assert.deepEqual([after.balance_available,after.balance_locked], ["0.11111111","7.00000000"]);
    });
    await t.test("actual withdrawal route enforces 50 USDT and reserves only requested available funds", async () => {
      let actingUserId = 3;
      const route = load("src/app/api/publisher/withdrawals/route.ts", {
        ...common,
        "next/server": { NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) } },
        "@/lib/auth": { getAuthenticatedUser: async () => ({ id: actingUserId }), getAuthenticatedUserStatus: async () => ({ id: actingUserId }), getAuthErrorStatus: () => 500 },
        "@/lib/telegram": { escapeTelegramHtml: (s) => s },
        "@/lib/productionSafety": { requireWithdrawalsAllowed: async () => null },
        "@/lib/financialPostingContext": posting,
        "@/lib/platformNotifications": { enqueuePlatformNotification: async () => {} },
        "@/lib/withdrawalAmount": load("src/lib/withdrawalAmount.ts"),
        "@/lib/withdrawalNetworks": {
          hashUserIdempotencyKey: (_id, key) => key,
          validateWithdrawalDestination: () => ({ ok: true, network: "BEP-20", address: "test-wallet", fee: 0 }),
          withdrawalRequestFingerprint: () => "test-fingerprint",
        },
      });
      const request = (amount, key) => ({ headers: { get: (name) => name === "idempotency-key" ? key : "test-auth" },
        json: async () => ({ amount, network: "BEP-20", address: "test-wallet" }) });
      for (const [value,key] of [["0.50","policy-test-half-usdt"],["10","policy-test-ten-usdt"]]) {
        const rejected = await route.POST(request(value,key));
        assert.deepEqual([rejected.status,rejected.data.code],[422,"WITHDRAWAL_BELOW_MINIMUM"]);
      }
      for (const value of ["abc","49.999999999","1e2","-50"]) {
        const rejected = await route.POST(request(value,"policy-test-invalid-"+value));
        assert.deepEqual([rejected.status,rejected.data.code],[422,"INVALID_WITHDRAWAL_AMOUNT"]);
      }
      const below = await route.POST(request("49.99999999", "policy-test-below-50"));
      assert.deepEqual([below.status, below.data.code], [422, "WITHDRAWAL_BELOW_MINIMUM"]);
      const atMinimum = await route.POST(request("50.00000000", "policy-test-at-50"));
      assert.equal(atMinimum.status, 200);
      assert.equal(atMinimum.data.success, true);
      const retry = await route.POST(request("50.00000000", "policy-test-at-50"));
      assert.equal(retry.data.idempotent, true);
      const [[u]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=3");
      assert.deepEqual([u.balance_available,u.balance_locked], ["0.00000000","59.00000000"]);
      const [[w]] = await db.query("SELECT COUNT(*) n,SUM(amount) reserved FROM withdrawals WHERE user_id=3 AND status='pending'");
      assert.deepEqual([w.n,w.reserved], [1,"50.00000000"]);
      await db.query("INSERT INTO users (id,balance_available,balance_locked) VALUES (4,'100.00000000','9.00000000'),(5,'50.00000000','3.00000000')");
      actingUserId = 4;
      const hundred = await route.POST(request("100.00000000","policy-test-one-hundred"));
      assert.equal(hundred.status,200);
      const [[hundredBalance]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=4");
      assert.deepEqual([hundredBalance.balance_available,hundredBalance.balance_locked],["0.00000000","109.00000000"]);
      const insufficient = await route.POST(request("50.00000000","policy-test-insufficient"));
      assert.equal(insufficient.status,400);
      actingUserId = 5;
      const simultaneous = await Promise.all([
        route.POST(request("50.00000000","policy-test-concurrent-a")),
        route.POST(request("50.00000000","policy-test-concurrent-b")),
      ]);
      assert.deepEqual(simultaneous.map(x=>x.status).sort(),[200,400]);
      const [[concurrentBalance]] = await db.query("SELECT balance_available,balance_locked FROM users WHERE id=5");
      assert.deepEqual([concurrentBalance.balance_available,concurrentBalance.balance_locked],["0.00000000","53.00000000"]);
    });
  } finally {
    if (db) await db.end();
    if (created) await admin.query("DROP DATABASE " + quote(schema));
    await admin.end();
  }
});
