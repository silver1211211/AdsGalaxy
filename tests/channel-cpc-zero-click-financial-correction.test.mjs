import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { createRequire } from "node:module";

dotenv.config({ path: ".env", quiet: true });
const native = createRequire(import.meta.url);
const cache = new Map();
let pool;

function load(path) {
  if (cache.has(path)) return cache.get(path);
  const js = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const dependencies = {
    "@/lib/db": { default: pool, __esModule: true },
    "@/lib/channelDailySpend": { getChannelDailySpend: async () => 0 },
    "@/lib/channelAllocationLedger": { shadowWriteChannelAllocation: async () => ({}) },
    "@/lib/channelCpmPendingSettlement": { recordPendingCpmAllocation: async () => ({}) },
    "@/lib/advertiserDirectDebit": { claimAdvertiserDirectDebit: async () => ({ ok: true, duplicate: false }) },
    "@/lib/statFormulas": {},
    "@/lib/referralCommission": { recordReferralCommission: async () => ({}) },
    "@/lib/publisherQuality": { getPublisherQuality: async () => 60 },
    "@/lib/revenueProtection": { recordPayoutSafetyCheck: async () => true },
    "@/lib/channelBilling": {
      getChannelBidPerThousand: () => 0.05,
      getChannelUnitPrice: () => 0.05,
      money: (v) => v,
    },
    "@/lib/schemaGuards": { ensureClassicSettlementColumns: async () => {} },
    "@/lib/campaignPostDeletion": { deleteExhaustedChannelCampaignPosts: async () => ({}) },
    "@/lib/campaignLifecycle": { markCampaignBudgetExhausted: async () => {} },
    "@/lib/channelDailyCap": {
      cleanupChannelDailyCapPosts: async () => {},
      markChannelDailyCapReached: async () => {},
    },
    "@/lib/dbResilience": {
      withFinancialTransactionRetry: async (fn) => {
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          const r = await fn(c);
          await c.commit();
          return r;
        } catch (e) {
          await c.rollback().catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    },
  };
  new Function("module", "exports", "require", js)(mod, mod.exports, (name) => {
    if (dependencies[name]) return dependencies[name];
    if (name === "./financialPostingContext") return load("src/lib/financialPostingContext.ts");
    if (name === "./channelAllocationMath") return load("src/lib/channelAllocationMath.ts");
    if (name.startsWith("@/lib/")) {
      const target = "src/lib/" + name.slice(6) + ".ts";
      return fs.existsSync(target) ? load(target) : {};
    }
    return native(name);
  });
  cache.set(path, mod.exports);
  return mod.exports;
}

// Prefer disposable MariaDB 10.11 fixture on port 53307 (exposes INFORMATION_SCHEMA.INNODB_LOCK_WAITS & INNODB_TRX)
const fixture53307 = {
  host: "127.0.0.1",
  port: 53307,
  user: "root",
  password: "",
};

const schema = "test_cpc_zero_click_fin_corr_" + Date.now();
const quote = (x) => "\u0060" + x + "\u0060";
const now = Math.floor(Date.now() / 1000) + 3600;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Poll INFORMATION_SCHEMA.INNODB_LOCK_WAITS + INNODB_TRX until an active lock wait is observed
 * (proving one transaction is genuinely blocked on an uncommitted row lock held by the other).
 * Note: MariaDB's trx_i_s_cache has CACHE_MIN_IDLE_TIME_US = 100ms (0.1s) and resets last_read
 * on every read, so we must wait >= 120ms before the first read and between reads.
 */
async function waitForInnoDbLockWait(adminConn, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 120));
  while (Date.now() < deadline) {
    const [rows] = await adminConn.query(
      `SELECT
         w.requesting_trx_id,
         w.blocking_trx_id,
         r.trx_state AS waiting_state,
         r.trx_query AS waiting_query,
         b.trx_state AS blocking_state,
         l.lock_table,
         l.lock_mode,
         l.lock_type
       FROM INFORMATION_SCHEMA.INNODB_LOCK_WAITS w
       JOIN INFORMATION_SCHEMA.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
       JOIN INFORMATION_SCHEMA.INNODB_TRX b ON b.trx_id = w.blocking_trx_id
       LEFT JOIN INFORMATION_SCHEMA.INNODB_LOCKS l ON l.lock_id = w.requested_lock_id`,
    );
    if (rows.length > 0) {
      return rows[0];
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("Timed out waiting for real InnoDB lock wait in INFORMATION_SCHEMA.INNODB_LOCK_WAITS");
}

/**
 * Wrap a real PoolConnection so that right before commit() (while all row locks acquired
 * during the transaction remain held and uncommitted in InnoDB), it signals `readyToCommit`
 * and awaits `proceedToCommit`.
 */
function createCommitBarrierPool(realConn, readyToCommit, proceedToCommit) {
  const wrappedConn = new Proxy(realConn, {
    get(target, prop, receiver) {
      if (prop === "commit") {
        return async () => {
          readyToCommit.resolve();
          await proceedToCommit.promise;
          return target.commit();
        };
      }
      if (prop === "release") {
        return () => {};
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  return {
    getConnection: async () => wrappedConn,
    wrappedConn,
  };
}

test("Comprehensive Zero-Click CPC Financial Correction & Real InnoDB Concurrency Suite", async (t) => {
  const old = {
    priority: process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED,
    unified: process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED,
    reserve: process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED,
  };

  const admin = await mysql.createConnection(fixture53307);
  let created = false;
  try {
    assert.match(schema, /^test_cpc_zero_click_fin_corr_\d+$/);
    await admin.query("CREATE DATABASE " + quote(schema));
    created = true;
    pool = mysql.createPool({ ...fixture53307, database: schema, connectionLimit: 16 });

    const ddl = [
      "CREATE TABLE users (id INT PRIMARY KEY, ad_balance DECIMAL(20,8) DEFAULT 0, balance_available DECIMAL(20,8) DEFAULT 0, balance_locked DECIMAL(20,8) DEFAULT 0, is_banned TINYINT DEFAULT 0, status VARCHAR(30) DEFAULT 'active') ENGINE=InnoDB",
      "CREATE TABLE campaigns (id INT PRIMARY KEY, user_id INT, type VARCHAR(20), budget DECIMAL(20,8) DEFAULT 1000, spend DECIMAL(20,8) DEFAULT 0, cpc DECIMAL(20,8) DEFAULT 0.05, cpm DECIMAL(20,8) DEFAULT 0, status VARCHAR(20), pause_reason VARCHAR(40), approved_creative_revision_id BIGINT UNSIGNED NULL, pending_creative_revision_id BIGINT UNSIGNED NULL, status_before_creative_review VARCHAR(40), funding_model VARCHAR(30) DEFAULT 'direct_debit', campaign_kind VARCHAR(30) DEFAULT 'standard', daily_budget_limit DECIMAL(20,8) NULL, link VARCHAR(500) DEFAULT 'https://adsgalaxy.test/offer') ENGINE=InnoDB",
      "CREATE TABLE channels (id INT PRIMARY KEY, user_id INT, status VARCHAR(30), under_review TINYINT DEFAULT 0, is_deleted TINYINT DEFAULT 0, settlement_excluded_until DATETIME NULL, revenue_protection_status VARCHAR(30), view_tracking_status VARCHAR(30), subscriber_count INT DEFAULT 1000) ENGINE=InnoDB",
      "CREATE TABLE campaign_posts (id INT PRIMARY KEY, campaign_id INT, channel_id INT, views INT, settled_views INT DEFAULT 0, settled_clicks INT DEFAULT 0, fraud_excluded_clicks INT DEFAULT 0, spend DECIMAL(20,8) DEFAULT 0, status VARCHAR(30) DEFAULT 'active', deleted_at DATETIME NULL, delivery_confirmed_at DATETIME, delivery_failed_at DATETIME NULL, last_views_update DATETIME(6) NULL, last_views_update_at DATETIME(6) NULL, view_fetch_status VARCHAR(30), view_fetch_source VARCHAR(30), view_accepted_at DATETIME NULL, billing_cutoff_at DATETIME NULL, approved_destination_url VARCHAR(500) DEFAULT 'https://adsgalaxy.test/offer') ENGINE=InnoDB",
      "CREATE TABLE campaign_clicks (id INT AUTO_INCREMENT PRIMARY KEY, campaign_id INT, post_id INT, ip_address VARCHAR(45) NULL, user_agent TEXT NULL, fingerprint VARCHAR(128) NULL, is_bot TINYINT DEFAULT 0, accepted_at DATETIME(6) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
      "CREATE TABLE channel_view_waivers (post_id INT, waived_views INT) ENGINE=InnoDB",
      "CREATE TABLE channel_fraud_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, channel_id INT, post_id INT NULL, campaign_id INT NULL, billing_state VARCHAR(30), false_positive_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE channel_allocation_ledger (id INT PRIMARY KEY) ENGINE=InnoDB",
      "CREATE TABLE channel_reserve_treasury_control (id INT PRIMARY KEY) ENGINE=InnoDB",
      "CREATE TABLE channel_reserve_treasury_ledger (id BIGINT AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) UNIQUE, entry_type VARCHAR(30), direction VARCHAR(5), amount DECIMAL(20,8), campaign_id INT, post_id INT, publisher_id INT, policy_version VARCHAR(64), created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_cpc_reserve_advances (id BIGINT AUTO_INCREMENT PRIMARY KEY, campaign_id INT, publisher_id INT, post_id INT, channel_id INT, entitled_views INT, entitled_amount DECIMAL(20,8), advanced_amount DECIMAL(20,8), recovered_amount DECIMAL(20,8) DEFAULT 0, unfunded_queue_amount DECIMAL(20,8), status VARCHAR(30), policy_version VARCHAR(64), updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_campaign_pub(campaign_id, publisher_id)) ENGINE=InnoDB",
      "CREATE TABLE channel_cpc_reserve_advance_posts (id BIGINT AUTO_INCREMENT PRIMARY KEY, advance_id BIGINT, campaign_id INT, post_id INT UNIQUE, channel_id INT, publisher_id INT, eligible_views INT, allocated_advance DECIMAL(20,8), updated_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
      "CREATE TABLE channel_arr_transitions (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL UNIQUE, advance_id BIGINT UNSIGNED NOT NULL, campaign_id INT NOT NULL, post_id INT NOT NULL, publisher_id INT NOT NULL, click_id BIGINT UNSIGNED NOT NULL, gross_click_unit_price DECIMAL(24,8) NOT NULL, recovered_to_reserve DECIMAL(24,8) NOT NULL DEFAULT 0, cash_paid_to_publisher DECIMAL(24,8) NOT NULL DEFAULT 0, outstanding_advance_after DECIMAL(24,8) NOT NULL DEFAULT 0, cumulative_publisher_earnings DECIMAL(24,8) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_unified_settlement_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) UNIQUE, settlement_type VARCHAR(40), campaign_id INT, post_id INT, channel_id INT, publisher_id INT, advertiser_id INT, units INT, unit_price DECIMAL(20,8), advertiser_debit DECIMAL(20,8), publisher_credit DECIMAL(20,8), platform_revenue DECIMAL(20,8), reserve_contribution DECIMAL(20,8), arr_recovered DECIMAL(20,8), status VARCHAR(30), created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_cpc_priority_scan_state (campaign_id INT PRIMARY KEY, round_id BIGINT UNSIGNED NOT NULL DEFAULT 1, highwater_post_id INT NOT NULL, cursor_post_id INT NOT NULL DEFAULT 0, as_of_epoch INT NOT NULL, scan_started_at DATETIME(6) NOT NULL, phase ENUM('scanning','scan_complete','paying','round_complete') NOT NULL DEFAULT 'scanning', updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_cpc_priority_scan_publishers (campaign_id INT NOT NULL, publisher_id INT NOT NULL, round_id BIGINT UNSIGNED NOT NULL DEFAULT 1, verified_views INT NOT NULL DEFAULT 0, unpaid_views INT NOT NULL DEFAULT 0, first_epoch INT NULL, last_reward_epoch INT NULL, previous_paid DECIMAL(20,8) NOT NULL DEFAULT '0.00000000', has_clicks TINYINT NOT NULL DEFAULT 0, validated TINYINT NOT NULL DEFAULT 1, score INT NOT NULL DEFAULT 0, post_cursor_id INT NOT NULL DEFAULT 0, state VARCHAR(30) NOT NULL DEFAULT 'candidate', PRIMARY KEY (campaign_id, publisher_id)) ENGINE=InnoDB",
      "CREATE TABLE channel_advertiser_debits (id BIGINT AUTO_INCREMENT PRIMARY KEY, source_key VARCHAR(191) UNIQUE, settlement_type VARCHAR(40) NULL, campaign_id INT, channel_id INT, post_id INT, publisher_id INT NULL, units INT DEFAULT 0, unit_price DECIMAL(20,8) DEFAULT 0, advertiser_debit DECIMAL(20,8) DEFAULT 0, gross_debit DECIMAL(20,8) DEFAULT 0, platform_margin_percent DECIMAL(5,2), safety_reserve_percent DECIMAL(5,2), allocation_policy_version VARCHAR(64), publisher_status VARCHAR(30) DEFAULT 'settled', publisher_credit DECIMAL(20,8) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, publisher_settled_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE settings (`key` VARCHAR(64) PRIMARY KEY, `value` TEXT) ENGINE=InnoDB",
      "CREATE TABLE advertiser_rate_discounts (user_id INT PRIMARY KEY, cpc_discount DECIMAL(5,2) DEFAULT 0, cpm_discount DECIMAL(5,2) DEFAULT 0, expires_at DATETIME) ENGINE=InnoDB",
    ];
    for (const q of ddl) await pool.query(q);

    const ledger = fs.readFileSync("db/migrations/20261101_0800_publisher_balance_events.sql", "utf8")
      .split(/\r?\n/).filter((l) => !l.trimStart().startsWith("--")).join("\n");
    for (const q of ledger.split(";").map((x) => x.trim()).filter(Boolean)) await pool.query(q);

    await pool.query("INSERT INTO users (id, ad_balance) VALUES (1, 100),(2, 0),(3, 0),(4, 0),(5, 0),(6, 0),(7, 0),(8, 0),(9, 0),(10, 0),(11, 0),(12, 0),(13, 0),(14, 0),(15, 0)");
    await pool.query(
      "INSERT INTO channels (id,user_id,status,revenue_protection_status,view_tracking_status,subscriber_count) VALUES " +
      "(20,2,'active','clear','active',1000),(21,3,'active','clear','active',1000),(22,4,'active','clear','active',1000)," +
      "(23,5,'active','clear','active',1000),(24,6,'active','clear','active',1000),(25,9,'active','clear','active',1000)," +
      "(26,10,'active','clear','active',1000),(27,11,'active','clear','active',1000),(28,12,'active','clear','active',1000)",
    );
    await pool.query("INSERT INTO channel_reserve_treasury_control VALUES (1)");
    await pool.query("INSERT INTO settings (`key`, `value`) VALUES ('platform_margin_percent', '30'), ('safety_reserve_percent', '10')");

    process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED = "true";
    process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED = "true";
    process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED = "true";

    const payoutMod = load("src/lib/channelCpcPriorityPayout.ts");
    const largeMod = load("src/lib/channelCpcPriorityLargeCampaign.ts");
    const unifiedMod = load("src/lib/channelUnifiedSettlement.ts");
    const fastMod = load("src/lib/channelFastBilling.ts");
    const acceptMod = load("src/lib/channelAcceptedEngagement.ts");

    const seedFunding = async (campaignId, amount, key) =>
      pool.query("INSERT INTO channel_reserve_treasury_ledger (idempotency_key, entry_type, direction, amount, campaign_id) VALUES (?, 'allocation_inflow', 'in', ?, ?)", [key, amount, campaignId]);

    const runPayout = async (campaignId) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const res = await payoutMod.fundCpcPriorityCampaign(conn, campaignId, now);
        await conn.commit();
        return res;
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }
    };

    // =========================================================================
    // SEQUENTIAL BASELINES (Accurately Named)
    // =========================================================================
    await t.test("Sequential Baseline A: Click commits before zero-click payout starts; payout rejects zero-click advance", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (201, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (2001, 201, 20, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(201, "1.00000000", "seed:201");

      const accepted = await acceptMod.acceptChannelCampaignClick(pool, {
        campaignId: 201,
        postId: 2001,
        ip: "198.51.100.1",
        userAgent: "Mozilla/5.0",
        fingerprint: "seq-a-fp",
        isBot: false,
      });
      assert.ok(accepted?.id);

      const res = await runPayout(201);
      assert.equal(res.credited.length, 0);
      assert.equal(res.totalCredited, "0.00000000");
    });

    await t.test("Sequential Baseline B: Zero-click payout commits before click arrives; subsequent click settlement recovers advance via ARR", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, budget, cpc, status) VALUES (202, 1, 'clicks', 100, 0.10, 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (2002, 202, 21, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(202, "1.00000000", "seed:202");

      const res = await runPayout(202);
      assert.equal(res.totalCredited, "0.10000000");

      const accepted = await acceptMod.acceptChannelCampaignClick(pool, {
        campaignId: 202,
        postId: 2002,
        ip: "198.51.100.2",
        userAgent: "Mozilla/5.0",
        fingerprint: "seq-b-fp",
        isBot: false,
      });
      assert.ok(accepted?.id);

      const conn3 = await pool.getConnection();
      try {
        await conn3.beginTransaction();
        const clickResult = await unifiedMod.settleCanonicalCpcClick(conn3, {
          campaignId: 202,
          postId: 2002,
          channelId: 21,
          publisherId: 3,
          advertiserId: 1,
          clickId: accepted.id,
          clickUnitPrice: "0.10000000",
          revenueSplit: { publisherPercent: 60, platformPercent: 30, reservePercent: 10 },
        });
        await conn3.commit();

        assert.equal(clickResult.status, "settled");
        assert.equal(clickResult.arrRecoveredDecimal, "0.06000000");
        assert.equal(clickResult.publisherCreditDecimal, "0.00000000");
      } finally {
        await conn3.rollback().catch(() => {});
        conn3.release();
      }
    });

    // =========================================================================
    // REAL OVERLAPPING INNODB CONCURRENCY TESTS (F.1 - F.5)
    // =========================================================================

    // F.1: Click transaction starts via real acceptChannelCampaignClick, takes campaign/post lock,
    // then payout starts and blocks in InnoDB; click commits; payout resumes, sees click and credits 0.00000000.
    await t.test("F.1 Real Overlap: acceptChannelCampaignClick holds campaign/post lock while payout blocks in INNODB_LOCK_WAITS; click commits; payout resumes and credits 0.00000000", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (401, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (4001, 401, 22, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(401, "1.00000000", "seed:401");

      const connClick = await pool.getConnection();
      const connPayout = await pool.getConnection();
      const clickReadyToCommit = createDeferred();
      const clickProceedToCommit = createDeferred();
      const clickBarrierPool = createCommitBarrierPool(connClick, clickReadyToCommit, clickProceedToCommit);

      try {
        // 1. Start real acceptChannelCampaignClick on connClick; pause right before commit while holding FOR UPDATE locks
        const clickPromise = acceptMod.acceptChannelCampaignClick(clickBarrierPool, {
          campaignId: 401,
          postId: 4001,
          ip: "203.0.113.10",
          userAgent: "Mozilla/5.0",
          fingerprint: "f1-overlap-fp",
          isBot: false,
        });
        await clickReadyToCommit.promise;

        // 2. Start payout on connPayout; it must block on connClick's uncommitted campaign/post lock
        let payoutFinished = false;
        await connPayout.beginTransaction();
        const payoutPromise = payoutMod.fundCpcPriorityCampaign(connPayout, 401, now).then((r) => {
          payoutFinished = true;
          return r;
        });

        // 3. Observe real InnoDB lock wait in INFORMATION_SCHEMA.INNODB_LOCK_WAITS
        const lockEvidence = await waitForInnoDbLockWait(admin);
        console.log("[F.1 Lock Wait Evidence]", JSON.stringify(lockEvidence));
        assert.equal(lockEvidence.waiting_state, "LOCK WAIT");
        assert.equal(payoutFinished, false, "Payout must remain blocked while click transaction is uncommitted");

        // 4. Release click transaction to commit
        clickProceedToCommit.resolve();
        const acceptedClick = await clickPromise;
        assert.equal(acceptedClick?.isNew, true);

        // 5. Payout resumes, sees committed click via authoritative locking read, and credits 0.00000000
        const payoutRes = await payoutPromise;
        await connPayout.commit();

        assert.equal(payoutRes.credited.length, 0);
        assert.equal(payoutRes.totalCredited, "0.00000000");

        const [[advCount]] = await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id = 401");
        assert.equal(Number(advCount.n), 0, "Zero advance rows may be created when click won the lock");
      } finally {
        clickProceedToCommit.resolve();
        await connClick.rollback().catch(() => {});
        await connPayout.rollback().catch(() => {});
        connClick.release();
        connPayout.release();
      }
    });

    // F.2: Payout holds campaign/post lock, concurrent acceptChannelCampaignClick waits, payout commits,
    // accepted click proceeds; subsequent settlement performs ARR with no duplicate credit and no advertiser charge for reserve funding.
    await t.test("F.2 Real Overlap: Payout holds campaign/post lock while acceptChannelCampaignClick blocks in INNODB_LOCK_WAITS; payout commits $0.10; click commits; settlement performs ARR", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, budget, cpc, status) VALUES (402, 1, 'clicks', 100, 0.10, 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (4002, 402, 23, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(402, "1.00000000", "seed:402");

      const [[advUserBefore]] = await pool.query("SELECT ad_balance FROM users WHERE id = 1");
      const connPayout = await pool.getConnection();
      const connClick = await pool.getConnection();
      const payoutReadyToCommit = createDeferred();
      const payoutProceedToCommit = createDeferred();

      try {
        await connPayout.beginTransaction();
        // Run fundCpcPriorityCampaign on connPayout, then pause before committing while holding campaign/post locks
        const payoutResult = await payoutMod.fundCpcPriorityCampaign(connPayout, 402, now);
        assert.equal(payoutResult.totalCredited, "0.10000000");
        payoutReadyToCommit.resolve();

        // Start real acceptChannelCampaignClick on connClick; it must block on connPayout's FOR UPDATE lock
        let clickFinished = false;
        const clickConnPool = {
          getConnection: async () =>
            new Proxy(connClick, {
              get(target, prop, receiver) {
                if (prop === "release") return () => {};
                const v = Reflect.get(target, prop, receiver);
                return typeof v === "function" ? v.bind(target) : v;
              },
            }),
        };
        const clickPromise = acceptMod.acceptChannelCampaignClick(clickConnPool, {
          campaignId: 402,
          postId: 4002,
          ip: "203.0.113.11",
          userAgent: "Mozilla/5.0",
          fingerprint: "f2-overlap-fp",
          isBot: false,
        }).then((r) => {
          clickFinished = true;
          return r;
        });

        const lockEvidence = await waitForInnoDbLockWait(admin);
        console.log("[F.2 Lock Wait Evidence]", JSON.stringify(lockEvidence));
        assert.equal(lockEvidence.waiting_state, "LOCK WAIT");
        assert.equal(clickFinished, false, "acceptChannelCampaignClick must wait while payout holds uncommitted locks");

        // Commit payout first
        await connPayout.commit();
        payoutProceedToCommit.resolve();

        // Click unblocks and commits
        const acceptedClick = await clickPromise;
        assert.equal(acceptedClick?.isNew, true);

        // Verify reserve payout charged advertiser 0.00000000
        const [[advUserAfterReserve]] = await pool.query("SELECT ad_balance FROM users WHERE id = 1");
        const [[campAfterReserve]] = await pool.query("SELECT budget, spend FROM campaigns WHERE id = 402");
        assert.equal(advUserAfterReserve.ad_balance, advUserBefore.ad_balance, "Advertiser must not be charged for reserve payout");
        assert.equal(campAfterReserve.spend, "0.00000000");

        // Settle the accepted click -> ARR recovers $0.06000000 to reserve, publisher cash credit is $0.00000000 (no duplicate credit)
        const connSettle = await pool.getConnection();
        try {
          await connSettle.beginTransaction();
          const clickSettle = await unifiedMod.settleCanonicalCpcClick(connSettle, {
            campaignId: 402,
            postId: 4002,
            channelId: 23,
            publisherId: 5,
            advertiserId: 1,
            clickId: acceptedClick.id,
            clickUnitPrice: "0.10000000",
            revenueSplit: { publisherPercent: 60, platformPercent: 30, reservePercent: 10 },
          });
          await connSettle.commit();

          assert.equal(clickSettle.status, "settled");
          assert.equal(clickSettle.arrRecoveredDecimal, "0.06000000");
          assert.equal(clickSettle.publisherCreditDecimal, "0.00000000", "No duplicate publisher credit during ARR recovery");
          assert.equal(clickSettle.outstandingAdvanceAfterDecimal, "0.04000000");
        } finally {
          await connSettle.rollback().catch(() => {});
          connSettle.release();
        }

        const [[pubUser]] = await pool.query("SELECT balance_available, balance_locked FROM users WHERE id = 5");
        assert.equal((Number(pubUser.balance_available) + Number(pubUser.balance_locked)).toFixed(8), "0.10000000");
      } finally {
        await connPayout.rollback().catch(() => {});
        await connClick.rollback().catch(() => {});
        connPayout.release();
        connClick.release();
      }
    });

    // F.3: Payout begins with an older REPEATABLE READ snapshot; another transaction commits an accepted click
    // (both on same post and on a sibling post of same publisher/campaign); authoritative locking check sees it and rejects.
    await t.test("F.3 REPEATABLE READ Snapshot Bypass: Payout transaction with older consistent snapshot detects newly committed click (same post & sibling post) via LOCK IN SHARE MODE", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (403, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (4003, 403, 24, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api'), (4004, 403, 24, 800, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(403, "1.00000000", "seed:403");

      const connSnap = await pool.getConnection();
      try {
        // 1. Open transaction on connSnap and materialize its REPEATABLE READ consistent snapshot BEFORE any clicks exist
        await connSnap.beginTransaction();
        const [[snapBefore]] = await connSnap.query("SELECT COUNT(*) cnt FROM campaign_clicks WHERE campaign_id = 403");
        assert.equal(Number(snapBefore.cnt), 0);

        // 2. Another connection accepts & commits a click on sibling post 4004 via real acceptChannelCampaignClick
        const accepted = await acceptMod.acceptChannelCampaignClick(pool, {
          campaignId: 403,
          postId: 4004,
          ip: "203.0.113.12",
          userAgent: "Mozilla/5.0",
          fingerprint: "f3-snap-fp",
          isBot: false,
        });
        assert.equal(accepted?.isNew, true);

        // 3. Verify connSnap's ordinary consistent-read SELECT still sees 0 clicks
        const [[plainSelect]] = await connSnap.query("SELECT COUNT(*) cnt FROM campaign_clicks WHERE campaign_id = 403 AND is_bot = 0");
        assert.equal(Number(plainSelect.cnt), 0, "Ordinary SELECT under REPEATABLE READ sees stale snapshot (0 clicks)");

        // 4. Authoritative zero-click settlement on post 4003 (and post 4004) must bypass snapshot via LOCK IN SHARE MODE and reject
        const resSibling = await unifiedMod.settleCanonicalCpcZeroClickAdvance(connSnap, {
          campaignId: 403,
          postId: 4003,
          channelId: 24,
          publisherId: 6,
          campaignType: "clicks",
          eligibleViews: 1000,
          validationResult: { eligible: true },
        });
        assert.equal(resSibling.status, "rejected");
        assert.equal(resSibling.reason, "qualifying_clicks_present");
        assert.equal(resSibling.fundingDeltaDecimal, "0.00000000");

        const resDirect = await unifiedMod.settleCanonicalCpcZeroClickAdvance(connSnap, {
          campaignId: 403,
          postId: 4004,
          channelId: 24,
          publisherId: 6,
          campaignType: "clicks",
          eligibleViews: 800,
          validationResult: { eligible: true },
        });
        assert.equal(resDirect.status, "rejected");
        assert.equal(resDirect.reason, "qualifying_clicks_present");
        assert.equal(resDirect.fundingDeltaDecimal, "0.00000000");
      } finally {
        await connSnap.rollback().catch(() => {});
        connSnap.release();
      }
    });

    // F.4: Two concurrent zero-click workers overlap with real InnoDB lock wait and cannot exceed $0.10000000 cap
    await t.test("F.4 Real Overlap: Two concurrent zero-click workers block in INNODB_LOCK_WAITS and strictly enforce $0.10000000 publisher/campaign cap", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (404, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (4005, 404, 25, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api'), (4006, 404, 25, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(404, "1.00000000", "seed:404");

      const connW1 = await pool.getConnection();
      const connW2 = await pool.getConnection();
      try {
        await connW1.beginTransaction();
        await connW2.beginTransaction();

        // Worker 1 executes payout and holds locks uncommitted
        const r1 = await payoutMod.fundCpcPriorityCampaign(connW1, 404, now);
        assert.equal(r1.totalCredited, "0.10000000");

        // Worker 2 starts concurrently and blocks on campaign/post/treasury lock held by Worker 1
        let w2Done = false;
        const w2Promise = payoutMod.fundCpcPriorityCampaign(connW2, 404, now).then((r) => {
          w2Done = true;
          return r;
        });

        const lockEvidence = await waitForInnoDbLockWait(admin);
        console.log("[F.4 Lock Wait Evidence]", JSON.stringify(lockEvidence));
        assert.equal(lockEvidence.waiting_state, "LOCK WAIT");
        assert.equal(w2Done, false);

        await connW1.commit();
        const r2 = await w2Promise;
        await connW2.commit();

        assert.equal(r2.totalCredited, "0.00000000");
        assert.equal((Number(r1.totalCredited) + Number(r2.totalCredited)).toFixed(8), "0.10000000");

        const [[adv]] = await pool.query("SELECT COUNT(*) n, SUM(advanced_amount) amt FROM channel_cpc_reserve_advances WHERE campaign_id = 404 AND publisher_id = 9");
        assert.equal(Number(adv.n), 1);
        assert.equal(Number(adv.amt).toFixed(8), "0.10000000");

        const [[ledgerRows]] = await pool.query("SELECT COUNT(*) n, SUM(amount) amt FROM channel_reserve_treasury_ledger WHERE campaign_id = 404 AND entry_type = 'advance_outflow'");
        assert.equal(Number(ledgerRows.n), 1);
        assert.equal(Number(ledgerRows.amt).toFixed(8), "0.10000000");
      } finally {
        await connW1.rollback().catch(() => {});
        await connW2.rollback().catch(() => {});
        connW1.release();
        connW2.release();
      }
    });

    // F.5: Same real overlap race in >1,000-post pagination AND CPC fast-billing path
    await t.test("F.5 Real Overlap: >1,000-post large campaign pagination and CPC fast-billing path block on concurrent acceptChannelCampaignClick and reject payout", async () => {
      // Part 1: >1,000-post campaign (1,005 posts)
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (405, 1, 'clicks', 'active')");
      await seedFunding(405, "1.00000000", "seed:405");
      for (let offset = 0; offset < 1005; offset += 500) {
        const end = Math.min(1005, offset + 500);
        const values = [];
        const args = [];
        for (let i = offset; i < end; i++) {
          values.push("(?, 405, 26, ?, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
          args.push(405000 + i, i === 1004 ? 1000 : 1);
        }
        await pool.query(
          "INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES " + values.join(","),
          args,
        );
      }

      // Scan all 3 pages (500 + 500 + 5 = 1,005 posts) -> phase becomes 'paying'
      const s1 = await largeMod.processCpcLargeCampaignRound(pool, 405, now, 500);
      const s2 = await largeMod.processCpcLargeCampaignRound(pool, 405, now, 500);
      const s3 = await largeMod.processCpcLargeCampaignRound(pool, 405, now, 500);
      assert.equal(s1.status, "scanning");
      assert.equal(s2.status, "scanning");
      assert.equal(s3.status, "scan_complete");

      // Now overlap real acceptChannelCampaignClick on post 4051004 with payPage!
      const connClickLarge = await pool.getConnection();
      const readyLarge = createDeferred();
      const proceedLarge = createDeferred();
      const barrierPoolLarge = createCommitBarrierPool(connClickLarge, readyLarge, proceedLarge);
      try {
        const clickLargePromise = acceptMod.acceptChannelCampaignClick(barrierPoolLarge, {
          campaignId: 405,
          postId: 405000 + 1004,
          ip: "203.0.113.50",
          userAgent: "Mozilla/5.0",
          fingerprint: "f5-large-fp",
          isBot: false,
        });
        await readyLarge.promise;

        let payPageDone = false;
        const payPagePromise = largeMod.processCpcLargeCampaignRound(pool, 405, now, 500).then((r) => {
          payPageDone = true;
          return r;
        });

        const lockEvidenceLarge = await waitForInnoDbLockWait(admin);
        console.log("[F.5a Large Campaign Lock Wait Evidence]", JSON.stringify(lockEvidenceLarge));
        assert.equal(lockEvidenceLarge.waiting_state, "LOCK WAIT");
        assert.equal(payPageDone, false);

        proceedLarge.resolve();
        const acceptedLarge = await clickLargePromise;
        assert.equal(acceptedLarge?.isNew, true);

        const payPageRes = await payPagePromise;
        assert.equal(payPageRes.status, "publisher_skipped");
        assert.equal(payPageRes.credited, "0.00000000");

        const [[scanPub]] = await pool.query("SELECT state, has_clicks FROM channel_cpc_priority_scan_publishers WHERE campaign_id = 405 AND publisher_id = 10");
        assert.equal(scanPub.state, "excluded");
        assert.equal(Number(scanPub.has_clicks), 1);
      } finally {
        proceedLarge.resolve();
        await connClickLarge.rollback().catch(() => {});
        connClickLarge.release();
      }

      // Part 2: CPC Fast-Billing path (debitConfirmedChannelViews with priority payout flag disabled)
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (406, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (4007, 406, 27, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(406, "1.00000000", "seed:406");

      process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED = "false";
      const connClickFast = await pool.getConnection();
      const readyFast = createDeferred();
      const proceedFast = createDeferred();
      const barrierPoolFast = createCommitBarrierPool(connClickFast, readyFast, proceedFast);
      try {
        const clickFastPromise = acceptMod.acceptChannelCampaignClick(barrierPoolFast, {
          campaignId: 406,
          postId: 4007,
          ip: "203.0.113.51",
          userAgent: "Mozilla/5.0",
          fingerprint: "f5-fast-fp",
          isBot: false,
        });
        await readyFast.promise;

        let fastDone = false;
        const fastPromise = fastMod.debitConfirmedChannelViews(4007, 1000).then((r) => {
          fastDone = true;
          return r;
        });

        const lockEvidenceFast = await waitForInnoDbLockWait(admin);
        console.log("[F.5b Fast Billing Lock Wait Evidence]", JSON.stringify(lockEvidenceFast));
        assert.equal(lockEvidenceFast.waiting_state, "LOCK WAIT");
        assert.equal(fastDone, false);

        proceedFast.resolve();
        const acceptedFast = await clickFastPromise;
        assert.equal(acceptedFast?.isNew, true);

        const fastRes = await fastPromise;
        assert.equal(fastRes.debited, false);
        assert.equal(fastRes.units, 0);

        const [[advFast]] = await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id = 406");
        assert.equal(Number(advFast.n), 0);
      } finally {
        proceedFast.resolve();
        process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED = "true";
        await connClickFast.rollback().catch(() => {});
        connClickFast.release();
      }
    });

    // =========================================================================
    // F.6: MISSING CLICK, FRAUD, POST OWNERSHIP OR FINANCIAL SCHEMA FAILS CLOSED
    // =========================================================================
    await t.test("F.6 Missing click, fraud, post ownership, or financial schema fails closed with zero balance/ledger mutations", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (407, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (4008, 407, 28, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(407, "1.00000000", "seed:407");

      const tablesToTest = [
        "campaign_clicks",
        "channel_fraud_events",
        "channels",
        "channel_cpc_reserve_advances",
      ];

      for (const tbl of tablesToTest) {
        const [[uBefore]] = await pool.query("SELECT ad_balance, balance_available, balance_locked FROM users WHERE id IN (1, 12) ORDER BY id");
        const [[lBefore]] = await pool.query("SELECT COUNT(*) n FROM channel_reserve_treasury_ledger WHERE campaign_id = 407 AND entry_type = 'advance_outflow'");

        await pool.query(`RENAME TABLE \`${tbl}\` TO \`${tbl}_hidden\``);
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const res = await unifiedMod.settleCanonicalCpcZeroClickAdvance(conn, {
            campaignId: 407,
            postId: 4008,
            channelId: 28,
            publisherId: 12,
            campaignType: "clicks",
            eligibleViews: 1000,
            validationResult: { eligible: true },
          });
          assert.equal(res.status, "schema_not_ready", `Missing table ${tbl} must return schema_not_ready`);
          assert.equal(res.fundingDeltaDecimal, "0.00000000");
          assert.equal(res.cumulativeFundedAdvanceDecimal, "0.00000000");
        } finally {
          await conn.rollback().catch(() => {});
          conn.release();
          await pool.query(`RENAME TABLE \`${tbl}_hidden\` TO \`${tbl}\``);
        }

        const [[uAfter]] = await pool.query("SELECT ad_balance, balance_available, balance_locked FROM users WHERE id IN (1, 12) ORDER BY id");
        const [[lAfter]] = await pool.query("SELECT COUNT(*) n FROM channel_reserve_treasury_ledger WHERE campaign_id = 407 AND entry_type = 'advance_outflow'");
        assert.deepEqual(uAfter, uBefore);
        assert.equal(lAfter.n, lBefore.n);
      }
    });

    // =========================================================================
    // F.7: COMPREHENSIVE AUTHORITATIVE ELIGIBILITY REJECTIONS
    // =========================================================================
    await t.test("F.7 Authoritative settlement rejects all unsupported campaign, post, channel, publisher, fraud, subscriber, waiver, and caller-view states", async () => {
      await pool.query("INSERT INTO users (id, ad_balance, is_banned, status) VALUES (50, 0, 0, 'active')");
      await pool.query("INSERT INTO channels (id, user_id, status, under_review, is_deleted, settlement_excluded_until, revenue_protection_status, view_tracking_status, subscriber_count) VALUES (50, 50, 'active', 0, 0, NULL, 'clear', 'active', 500)");
      await pool.query("INSERT INTO campaigns (id, user_id, type, status, funding_model, campaign_kind) VALUES (500, 1, 'clicks', 'active', 'direct_debit', 'standard')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_clicks, fraud_excluded_clicks, status, deleted_at, delivery_confirmed_at, delivery_failed_at, view_fetch_status, view_fetch_source) VALUES (5000, 500, 50, 400, 0, 0, 'active', NULL, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), NULL, 'success', 'public_api')");
      await seedFunding(500, "1.00000000", "seed:500");

      const attempt = async (overrides = {}) => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const res = await unifiedMod.settleCanonicalCpcZeroClickAdvance(conn, {
            campaignId: 500,
            postId: 5000,
            channelId: 50,
            publisherId: 50,
            campaignType: "clicks",
            eligibleViews: 400,
            validationResult: { eligible: true },
            ...overrides,
          });
          await conn.rollback();
          return res;
        } finally {
          conn.release();
        }
      };

      // 1. Campaign states: unapproved ('in_review'), paused, deleted, views type, legacy_reserved, channel_growth
      for (const st of ["in_review", "paused", "deleted"]) {
        await pool.query("UPDATE campaigns SET status = ? WHERE id = 500", [st]);
        const r = await attempt();
        assert.equal(r.status, "rejected");
        assert.equal(r.reason, "campaign_not_active");
        assert.equal(r.fundingDeltaDecimal, "0.00000000");
      }
      await pool.query("UPDATE campaigns SET status = 'active', funding_model = 'legacy_reserved' WHERE id = 500");
      assert.equal((await attempt()).reason, "campaign_not_direct_debit");
      await pool.query("UPDATE campaigns SET funding_model = 'direct_debit', campaign_kind = 'channel_growth' WHERE id = 500");
      assert.equal((await attempt()).reason, "channel_growth_excluded");
      await pool.query("UPDATE campaigns SET campaign_kind = 'standard', type = 'views' WHERE id = 500");
      assert.equal((await attempt()).reason, "campaign_not_cpc");
      await pool.query("UPDATE campaigns SET type = 'clicks' WHERE id = 500");

      // 2. Post states: inactive status, deleted_at set, delivery_failed_at set, delivery_confirmed_at NULL
      await pool.query("UPDATE campaign_posts SET status = 'paused' WHERE id = 5000");
      assert.equal((await attempt()).reason, "placement_not_active_or_confirmed");
      await pool.query("UPDATE campaign_posts SET status = 'active', deleted_at = UTC_TIMESTAMP() WHERE id = 5000");
      assert.equal((await attempt()).reason, "placement_not_active_or_confirmed");
      await pool.query("UPDATE campaign_posts SET deleted_at = NULL, delivery_failed_at = UTC_TIMESTAMP() WHERE id = 5000");
      assert.equal((await attempt()).reason, "placement_not_active_or_confirmed");
      await pool.query("UPDATE campaign_posts SET delivery_failed_at = NULL, delivery_confirmed_at = NULL WHERE id = 5000");
      assert.equal((await attempt()).reason, "placement_not_active_or_confirmed");
      await pool.query("UPDATE campaign_posts SET delivery_confirmed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE id = 5000");

      // 3. Wrong channel ID and wrong publisher ID
      assert.equal((await attempt({ channelId: 999 })).reason, "channel_mismatch");
      assert.equal((await attempt({ publisherId: 999 })).reason, "publisher_mismatch");

      // 4. Banned publisher
      await pool.query("UPDATE users SET is_banned = 1 WHERE id = 50");
      assert.equal((await attempt()).reason, "publisher_banned");
      await pool.query("UPDATE users SET is_banned = 0, status = 'banned' WHERE id = 50");
      assert.equal((await attempt()).reason, "publisher_banned");
      await pool.query("UPDATE users SET status = 'active' WHERE id = 50");

      // 5. Held / under_review / deleted / suspended channel
      await pool.query("UPDATE channels SET under_review = 1 WHERE id = 50");
      assert.equal((await attempt()).reason, "channel_not_active_or_under_review");
      await pool.query("UPDATE channels SET under_review = 0, settlement_excluded_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR) WHERE id = 50");
      assert.equal((await attempt()).reason, "settlement_held");
      await pool.query("UPDATE channels SET settlement_excluded_until = NULL, revenue_protection_status = 'blocked' WHERE id = 50");
      assert.equal((await attempt()).reason, "revenue_protection_blocked");
      await pool.query("UPDATE channels SET revenue_protection_status = 'clear' WHERE id = 50");

      // 6. Active fraud event & ambiguous fraud_excluded_clicks counter
      await pool.query("INSERT INTO channel_fraud_events (channel_id, post_id, campaign_id, billing_state) VALUES (50, 5000, 500, 'suspicious')");
      assert.equal((await attempt()).reason, "fraud_detected");
      await pool.query("DELETE FROM channel_fraud_events WHERE channel_id = 50");

      await pool.query("UPDATE campaign_posts SET fraud_excluded_clicks = 1 WHERE id = 5000");
      assert.equal((await attempt()).reason, "ambiguous_click_fraud_evidence");
      await pool.query("UPDATE campaign_posts SET fraud_excluded_clicks = 0 WHERE id = 5000");

      // 7. Under 100 subscribers (99 rejected, 100 accepted)
      await pool.query("UPDATE channels SET subscriber_count = 99 WHERE id = 50");
      assert.equal((await attempt()).reason, "insufficient_subscribers");
      await pool.query("UPDATE channels SET subscriber_count = 100 WHERE id = 50");

      // 8. Bad view tracking status, failed view fetch, bad view source
      await pool.query("UPDATE channels SET view_tracking_status = 'failed' WHERE id = 50");
      assert.equal((await attempt()).reason, "view_tracking_not_eligible");
      await pool.query("UPDATE channels SET view_tracking_status = 'active' WHERE id = 50");

      await pool.query("UPDATE campaign_posts SET view_fetch_status = 'failed' WHERE id = 5000");
      assert.equal((await attempt()).reason, "view_fetch_not_successful");
      await pool.query("UPDATE campaign_posts SET view_fetch_status = 'success', view_fetch_source = 'unverified_bot' WHERE id = 5000");
      assert.equal((await attempt()).reason, "view_fetch_source_not_eligible");
      await pool.query("UPDATE campaign_posts SET view_fetch_source = 'public_api' WHERE id = 5000");

      // 9. Zero/invalid views, waived views, and untrusted caller eligibleViews mismatch
      await pool.query("UPDATE campaign_posts SET views = 0 WHERE id = 5000");
      assert.equal((await attempt({ eligibleViews: 400 })).reason, "invalid_or_zero_views");
      await pool.query("UPDATE campaign_posts SET views = 400 WHERE id = 5000");

      await pool.query("INSERT INTO channel_view_waivers (post_id, waived_views) VALUES (5000, 400)");
      assert.equal((await attempt({ eligibleViews: 400 })).reason, "all_views_waived");
      await pool.query("UPDATE channel_view_waivers SET waived_views = 100 WHERE post_id = 5000");
      // Authoritative eligible views is 400 - 100 = 300; caller passing 400 or 1000 must be rejected!
      assert.equal((await attempt({ eligibleViews: 400 })).reason, "verified_views_mismatch_or_missing");
      assert.equal((await attempt({ eligibleViews: 1000 })).reason, "verified_views_mismatch_or_missing");

      // Caller passing the exact authoritative waiver-adjusted views (300) succeeds!
      const validWithWaiver = await attempt({ eligibleViews: 300 });
      assert.equal(validWithWaiver.status, "funded");
      assert.equal(validWithWaiver.fundingDeltaDecimal, "0.06333333");
      await pool.query("DELETE FROM channel_view_waivers WHERE post_id = 5000");

      const [[advCount]] = await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id = 500");
      assert.equal(Number(advCount.n), 0, "Zero persisted writes across all rejected checks");
    });

    // =========================================================================
    // F.8: MIXED VERIFIED + UNVERIFIED POSTS & CAMPAIGN-WIDE EXCLUSIONS
    // =========================================================================
    await t.test("F.8 Mixed verified and unverified posts: verified post earns while unverified earns 0; campaign-wide click or fraud excludes publisher", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (208, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO channels (id, user_id, status, revenue_protection_status, view_tracking_status, subscriber_count) VALUES (41, 7, 'active', 'clear', 'active', 1000)");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (2008, 208, 41, 1000, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (2009, 208, 41, 500, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'failed', 'public_api')");
      await seedFunding(208, "1.00000000", "seed:208");

      const res = await runPayout(208);
      assert.equal(res.credited.length, 1);
      assert.equal(res.credited[0].postId, 2008);
      assert.equal(res.credited[0].amount, "0.10000000");

      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (209, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO channels (id, user_id, status, revenue_protection_status, view_tracking_status, subscriber_count) VALUES (42, 8, 'active', 'clear', 'active', 1000)");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (2010, 209, 42, 1000, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await pool.query("INSERT INTO channel_fraud_events (channel_id, campaign_id, billing_state) VALUES (42, 209, 'confirmed_fraud')");
      await seedFunding(209, "1.00000000", "seed:209");

      const resFraud = await runPayout(209);
      assert.equal(resFraud.credited.length, 0);
      assert.equal(resFraud.totalCredited, "0.00000000");
    });

    // =========================================================================
    // F.9 & F.12: INVARIANTS, ROLLBACK, AND FEATURE FLAGS ON/OFF + CPM UNTOUCHED
    // =========================================================================
    await t.test("F.9 Invariant 1: Bot clicks excluded from click count; legitimate views remain eligible", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (301, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (3001, 301, 24, 1000, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await pool.query("INSERT INTO campaign_clicks (campaign_id, post_id, is_bot) VALUES (301, 3001, 1)");
      await seedFunding(301, "1.00000000", "seed:301");

      const res = await runPayout(301);
      assert.equal(res.credited.length, 1);
      assert.equal(res.credited[0].amount, "0.10000000");
      // Idempotent replay produces 0 additional credit
      const replay = await runPayout(301);
      assert.equal(replay.totalCredited, "0.00000000");
    });

    await t.test("F.9 Invariant 2: Advertiser is NEVER debited for reserve-funded zero-click rewards", async () => {
      const [[beforeCamp]] = await pool.query("SELECT budget, spend FROM campaigns WHERE id = 208");
      const [[beforeAdvUser]] = await pool.query("SELECT ad_balance FROM users WHERE id = 1");

      assert.equal(beforeCamp.budget, "1000.00000000");
      assert.equal(beforeCamp.spend, "0.00000000");
      assert.equal(beforeAdvUser.ad_balance, "100.00000000");
    });

    await t.test("F.9 Invariant 3: Reserve 70%/30% floor prevents over-allocation", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (303, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (3003, 303, 20, 1000, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(303, "0.05000000", "seed:303");

      const res = await runPayout(303);
      assert.equal(res.totalCredited, "0.03500000");
    });

    await t.test("F.9 Invariant 4: 60/30/10 split conserved on actual CPC click debit & full rollback on injected mid-tx failure", async () => {
      const [[event]] = await pool.query("SELECT advertiser_debit, publisher_credit, platform_revenue, reserve_contribution, arr_recovered FROM channel_unified_settlement_events WHERE campaign_id = 202 AND settlement_type = 'cpc_click'");
      const debit = Number(event.advertiser_debit);
      const pub = Number(event.publisher_credit);
      const plat = Number(event.platform_revenue);
      const res = Number(event.reserve_contribution);
      const arr = Number(event.arr_recovered);

      assert.equal(debit.toFixed(8), (pub + arr + plat + res).toFixed(8));
      assert.equal(plat.toFixed(8), (debit * 0.30).toFixed(8));
      assert.equal(res.toFixed(8), (debit * 0.10).toFixed(8));
      assert.equal((pub + arr).toFixed(8), (debit * 0.60).toFixed(8));

      // Injected mid-transaction failure rolls back all advance/ledger/balance writes
      await pool.query("INSERT INTO campaigns (id, user_id, type, status) VALUES (304, 1, 'clicks', 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (3004, 304, 20, 500, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(304, "1.00000000", "seed:304");
      await pool.query("CREATE TRIGGER trg_fail_304 BEFORE INSERT ON channel_unified_settlement_events FOR EACH ROW BEGIN IF NEW.campaign_id = 304 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected_mid_tx_error'; END IF; END");
      try {
        await assert.rejects(runPayout(304), /injected_mid_tx_error/);
      } finally {
        await pool.query("DROP TRIGGER IF EXISTS trg_fail_304");
      }
      const [[adv304]] = await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id = 304");
      const [[led304]] = await pool.query("SELECT COUNT(*) n FROM channel_reserve_treasury_ledger WHERE campaign_id = 304 AND entry_type = 'advance_outflow'");
      assert.equal(Number(adv304.n), 0);
      assert.equal(Number(led304.n), 0);
    });

    await t.test("F.12 Feature Flags ON and OFF & CPM Settlement Unchanged", async () => {
      await pool.query("INSERT INTO campaigns (id, user_id, type, budget, cpm, status) VALUES (305, 1, 'clicks', 100, 0, 'active'), (306, 1, 'views', 100, 2.00, 'active')");
      await pool.query("INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_views, delivery_confirmed_at, view_fetch_status, view_fetch_source) VALUES (3005, 305, 20, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api'), (3006, 306, 20, 1000, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'success', 'public_api')");
      await seedFunding(305, "1.00000000", "seed:305");

      const [balancesBefore] = await pool.query("SELECT id, ad_balance, balance_available, balance_locked FROM users ORDER BY id");

      // Turn flags OFF: zero new credits, historical balances intact
      process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED = "false";
      process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED = "false";
      process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED = "false";

      const offPayout = await payoutMod.processCpcPriorityCampaign(pool, 305, now);
      assert.equal(offPayout.status, "disabled");
      assert.equal(offPayout.credited.length, 0);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const offDirect = await unifiedMod.settleCanonicalCpcZeroClickAdvance(conn, {
          campaignId: 305,
          postId: 3005,
          channelId: 20,
          publisherId: 2,
          campaignType: "clicks",
          eligibleViews: 1000,
          validationResult: { eligible: true },
        });
        assert.equal(offDirect.status, "disabled");
        assert.equal(offDirect.fundingDeltaDecimal, "0.00000000");
        await conn.commit();
      } finally {
        conn.release();
      }

      const [balancesAfterOff] = await pool.query("SELECT id, ad_balance, balance_available, balance_locked FROM users ORDER BY id");
      assert.deepEqual(balancesAfterOff, balancesBefore, "Disabled flags must leave all historical balances intact");

      // Turn flags back ON and verify CPM settlement works identically and never touches CPC advance tables
      process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED = "true";
      process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED = "true";
      process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED = "true";

      const prevCpmWin = process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
      process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED = "false";
      const cpmConn = await pool.getConnection();
      try {
        await cpmConn.beginTransaction();
        const cpmRes = await unifiedMod.settleCanonicalCpmViews(cpmConn, {
          campaignId: 306,
          postId: 3006,
          channelId: 20,
          publisherId: 2,
          advertiserId: 1,
          confirmedViews: 1000,
          cpmRate: "2.00000000",
          revenueSplit: { publisherPercent: 60, platformPercent: 30, reservePercent: 10 },
        });
        await cpmConn.commit();
        assert.equal(cpmRes.status, "settled");
        assert.equal(cpmRes.advertiserDebitDecimal, "2.00000000");
        assert.equal(cpmRes.publisherCreditDecimal, "1.20000000");
        assert.equal(cpmRes.platformRevenueDecimal, "0.60000000");
        assert.equal(cpmRes.reserveAllocationDecimal, "0.20000000");
      } finally {
        if (prevCpmWin === undefined) delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
        else process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED = prevCpmWin;
        await cpmConn.rollback().catch(() => {});
        cpmConn.release();
      }

      const [[cpmAdvanceRows]] = await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id = 306");
      assert.equal(Number(cpmAdvanceRows.n), 0, "CPM settlement must never write CPC reserve advances");
    });
  } finally {
    for (const [k, v] of Object.entries({
      CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED: old.priority,
      CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED: old.unified,
      CHANNEL_V101_RESERVE_TREASURY_ENABLED: old.reserve,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (pool) await pool.end();
    if (created) {
      await admin.query("DROP DATABASE IF EXISTS " + quote(schema));
    }
    await admin.end();
  }
});
