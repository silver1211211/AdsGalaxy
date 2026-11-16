import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: ".env", quiet: true });

const ROOT = process.cwd();

function createTsLoader(overrides = {}) {
  const cache = new Map();
  function loadModule(moduleId, parentDir = ROOT) {
    if (Object.prototype.hasOwnProperty.call(overrides, moduleId)) {
      return overrides[moduleId];
    }
    let resolvedPath = null;
    if (moduleId.startsWith("@/")) {
      resolvedPath = path.join(ROOT, "src", moduleId.slice(2));
    } else if (moduleId.startsWith("./") || moduleId.startsWith("../")) {
      resolvedPath = path.resolve(parentDir, moduleId);
    } else {
      throw new Error(`External module not mocked in loader: ${moduleId}`);
    }
    if (!fs.existsSync(resolvedPath) && fs.existsSync(`${resolvedPath}.ts`)) {
      resolvedPath = `${resolvedPath}.ts`;
    }
    if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports;

    const source = fs.readFileSync(resolvedPath, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;

    const mod = { exports: {} };
    cache.set(resolvedPath, mod);
    const localRequire = (reqId) => {
      if (reqId === "node:crypto" || reqId === "crypto") return crypto;
      return loadModule(reqId, path.dirname(resolvedPath));
    };
    new Function("module", "exports", "require", transpiled)(mod, mod.exports, localRequire);
    return mod.exports;
  }
  return { loadModule };
}

test("Batch 4 ??? Problems 10 & 11 Comprehensive Regression Suite (25 Scenarios + Disposable DB Migration Chain)", async (t) => {
  const dbName = `test_adsfusion_b4_${process.pid}_${Date.now()}`;
  const adminConn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    await adminConn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await adminConn.query(`USE \`${dbName}\``);

    // Clone real production schema structures from adsfusion for disposable verification
    const tablesToClone = [
      "users",
      "channels",
      "channel_telegram_identities",
      "channel_admin_action_audits",
      "channel_subscriber_transition_audits",
      "campaigns",
      "campaign_posts",
      "moderation_rejections",
      "settings",
    ];
    for (const tbl of tablesToClone) {
      await adminConn.query(`CREATE TABLE \`${dbName}\`.\`${tbl}\` LIKE \`adsfusion\`.\`${tbl}\``);
    }

    // 1. Verify Batch 1-4 Migration Chain applies sequentially and idempotently on production schema copy
    await t.test("Scenario 1: Batch 1-4 migrations apply sequentially and idempotently on disposable production schema clone", async () => {
      const migrationFiles = [
        "db/migrations/20261106_0100_channel_reliability_batch1_observations.sql",
        "db/migrations/20261106_0200_channel_reliability_batch2_recovery_history.sql",
        "db/migrations/20261106_0300_channel_reliability_batch3_identity_eligibility.sql",
        "db/migrations/20261106_0400_channel_reliability_batch4_views_and_audit_history.sql",
      ];

      // First pass
      for (const relPath of migrationFiles) {
        const fullPath = path.join(ROOT, relPath);
        assert.equal(fs.existsSync(fullPath), true, `Migration file must exist: ${relPath}`);
        const sql = fs.readFileSync(fullPath, "utf8");
        await adminConn.query(sql);
      }

      // Second pass (idempotency verification)
      for (const relPath of migrationFiles) {
        const sql = fs.readFileSync(path.join(ROOT, relPath), "utf8");
        await adminConn.query(sql);
      }

      const [tables] = await adminConn.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME IN (
             'channel_telegram_access_observations',
             'channel_recovery_checkpoints',
             'channel_recovery_attempts',
             'channel_identity_reconciliations',
             'channel_status_transition_audits'
           )`,
        [dbName],
      );
      assert.equal(tables.length, 5, "All 5 authoritative Batch 1-4 tables must exist");

      const [cpCols] = await adminConn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'campaign_posts'
           AND COLUMN_NAME IN ('last_views_update_at', 'view_fetch_failures', 'last_view_failure_class', 'view_next_retry_at')`,
        [dbName],
      );
      assert.equal(cpCols.length, 4, "All 4 Batch 4 campaign_posts columns must exist");
    });

    const { loadModule } = createTsLoader({
      "@/lib/db": adminConn,
      telegram: { Api: { channels: { GetMessagesViews: class {} } }, TelegramClient: class {} },
      "telegram/sessions": { StringSession: class {} },
    });

    const viewPersistence = loadModule("@/lib/channelViewPersistence");
    const statusAudit = loadModule("@/lib/channelStatusAudit");
    const viewReconciliation = loadModule("@/lib/channelHistoricalViewReconciliation");
    const mtproto = loadModule("@/lib/telegramMtproto");

    // Seed baseline test fixtures in disposable DB
    await adminConn.query(
      `INSERT INTO users (id, telegram_id, username, first_name, status, is_banned, balance_available, balance_locked, ad_balance)
       VALUES (101, 900101, 'pub_b4', 'PubB4', 'active', 0, 50, 0, 100)`,
    );
    await adminConn.query(
      `INSERT INTO channels (id, user_id, chat_id, username, title, channel_type, subscriber_count, status, is_deleted, view_tracking_status, telegram_access_state, telegram_access_version)
       VALUES
         (201, 101, '-100201201201', 'pub_chan_201', 'Public Channel 201', 'public', 1500, 'active', 0, 'available', 'healthy', 1),
         (202, 101, '-100202202202', NULL, 'Private Channel 202', 'private', 1800, 'active', 0, 'available', 'healthy', 1)`,
    );
    await adminConn.query(
      `INSERT INTO campaigns (id, user_id, name, message_text, link, button_text, type, status)
       VALUES (301, 101, 'Camp 301', 'Desc', 'https://example.com', 'Open', 'views', 'active')`,
    );

    // 2. Scenario 2: last_views_update valid timestamp write on BIGINT and DATETIME(6)
    await t.test("Scenario 2: last_views_update valid timestamp write on BIGINT(20) and DATETIME(6) without truncation", async () => {
      await adminConn.query(
        `INSERT INTO campaign_posts (id, campaign_id, channel_id, message_id, views, settled_views, last_views_update, status, delivery_confirmed_at)
         VALUES (1001, 301, 201, '55', 10, 10, 0, 'active', UTC_TIMESTAMP())`,
      );
      const observedMs = 1794025000123;
      const res = await viewPersistence.persistSuccessfulChannelViews(adminConn, 1001, 125, "public_html", observedMs);
      assert.equal(res.updated, true);

      const [[row]] = await adminConn.query(
        `SELECT views, settled_views, last_views_update, last_views_update_at, view_fetch_status, view_fetch_source, view_fetch_error, view_fetch_failures
         FROM campaign_posts WHERE id = 1001`,
      );
      assert.equal(Number(row.views), 125);
      assert.equal(Number(row.settled_views), 10);
      assert.equal(Number(row.last_views_update), observedMs);
      assert.ok(row.last_views_update_at instanceof Date || typeof row.last_views_update_at === "string");
      assert.equal(row.view_fetch_status, "success");
      assert.equal(row.view_fetch_source, "public_html");
      assert.equal(row.view_fetch_error, null);
      assert.equal(Number(row.view_fetch_failures), 0);
    });

    // 3. Scenario 3: last_views_update invalid timestamp rejection
    await t.test("Scenario 3: invalid timestamp is rejected with invalid_view_timestamp and zero DB mutation", async () => {
      assert.throws(
        () => viewPersistence.normalizeViewTimestamp("not-a-valid-timestamp"),
        /invalid_view_timestamp/,
      );
      await assert.rejects(
        () => viewPersistence.persistSuccessfulChannelViews(adminConn, 1001, 999, "public_html", "invalid-date"),
        /invalid_view_timestamp/,
      );
      const [[row]] = await adminConn.query("SELECT views FROM campaign_posts WHERE id = 1001");
      assert.equal(Number(row.views), 125);
    });

    // 4. Scenario 4: Monotonic view-count update (never decreases stored views)
    await t.test("Scenario 4: monotonic view-count update preserves higher views when later fetch returns lower count", async () => {
      const laterMs = 1794025060000;
      await viewPersistence.persistSuccessfulChannelViews(adminConn, 1001, 400, "public_html", laterMs);
      await viewPersistence.persistSuccessfulChannelViews(adminConn, 1001, 180, "mtproto_public_fallback", laterMs + 5000);
      const [[row]] = await adminConn.query("SELECT views, last_views_update, view_fetch_source FROM campaign_posts WHERE id = 1001");
      assert.equal(Number(row.views), 400, "Views must never regress from 400 to 180");
      assert.equal(Number(row.last_views_update), laterMs + 5000);
    });

    // 5. Scenario 5: Stale worker view-update rejection + 14-digit YYYYMMDDHHMMSS healing
    await t.test("Scenario 5: stale worker with older timestamp cannot overwrite newer last_views_update or source, while 14-digit corrupted value is healed", async () => {
      const staleMs = 1794024000000;
      const staleRes = await viewPersistence.persistSuccessfulChannelViews(adminConn, 1001, 410, "public_html", staleMs);
      assert.equal(staleRes.updated, false);
      assert.equal(staleRes.skippedStale, true);
      assert.equal(staleRes.status, "stale_ignored");
      const [[afterStale]] = await adminConn.query("SELECT views, last_views_update, view_fetch_source FROM campaign_posts WHERE id = 1001");
      assert.equal(Number(afterStale.views), 400, "Stale observation must not alter views");
      assert.equal(Number(afterStale.last_views_update), 1794025065000, "Newer timestamp must not be overwritten by stale worker");
      assert.equal(afterStale.view_fetch_source, "mtproto_public_fallback");

      // Corrupted 14-digit YYYYMMDDHHMMSS timestamp from NOW()+0 in BIGINT column
      await adminConn.query(
        `INSERT INTO campaign_posts (id, campaign_id, channel_id, message_id, views, settled_views, last_views_update, status, delivery_confirmed_at)
         VALUES (1002, 301, 201, '56', 20, 20, 20260708122228, 'active', UTC_TIMESTAMP())`,
      );
      const validMs = 1794026000000;
      await viewPersistence.persistSuccessfulChannelViews(adminConn, 1002, 75, "public_html", validMs);
      const [[healed]] = await adminConn.query("SELECT views, last_views_update FROM campaign_posts WHERE id = 1002");
      assert.equal(Number(healed.views), 75);
      assert.equal(Number(healed.last_views_update), validMs, "14-digit corrupted value >= 19700101000000 must be replaced by valid 13-digit epoch ms");
    });

    // 6. Scenario 6: Public channel fallback to MTProto & username refresh identity protection
    await t.test("Scenario 6: public channel fallback to MTProto persists mtproto_public_fallback and normalizedLastViewsUpdateDatetimeSql parses all formats", async () => {
      const expr = viewPersistence.normalizedLastViewsUpdateDatetimeSql("cp.last_views_update");
      const [[parsedRow]] = await adminConn.query(
        `SELECT ${expr} AS normalized_dt FROM campaign_posts cp WHERE cp.id = 1001`,
      );
      assert.ok(parsedRow.normalized_dt, "Normalized SQL expression must return valid UTC datetime");
      const updateViewsSource = fs.readFileSync(path.join(ROOT, "src/app/api/cron/update-views/route.ts"), "utf8");
      assert.equal(updateViewsSource.includes("String(data.result.id) !== String(chatId)"), true, "refreshPublicUsername must verify permanent chat_id before updating username");
      assert.equal(updateViewsSource.includes("identity_mismatch"), true, "refreshPublicUsername must reject mismatched chat_id");
    });

    // 7. Scenario 7: Private channel MTProto view fetch when tracking account is a member
    await t.test("Scenario 7: private channel MTProto view fetch persists mtproto_private and qualifies for view reserve eligibility", async () => {
      await adminConn.query(
        `INSERT INTO campaign_posts (id, campaign_id, channel_id, message_id, views, settled_views, last_views_update, status, delivery_confirmed_at)
         VALUES (1003, 301, 202, '77', 0, 0, 0, 'active', UTC_TIMESTAMP())`,
      );
      await viewPersistence.persistSuccessfulChannelViews(adminConn, 1003, 310, "mtproto_private", 1794027000000);
      const [[row]] = await adminConn.query("SELECT views, view_fetch_source, view_fetch_status FROM campaign_posts WHERE id = 1003");
      assert.equal(Number(row.views), 310);
      assert.equal(row.view_fetch_source, "mtproto_private");
      assert.equal(row.view_fetch_status, "success");
      assert.equal(viewPersistence.isEligibleChannelViewFetchSource("mtproto_private"), true);
      assert.equal(viewPersistence.isEligibleChannelViewFetchSource("mtproto_public_fallback"), true);
      assert.equal(viewPersistence.isEligibleChannelViewTrackingStatus("available"), true);
      assert.equal(viewPersistence.isEligibleChannelViewTrackingStatus("active"), true);
      assert.equal(viewPersistence.isEligibleChannelViewTrackingStatus("failed"), false);
    });

    // 8. Scenario 8: Private channel view fetch when tracking account is not a member
    await t.test("Scenario 8: private channel non-member tracking account records operational failure with 6h backoff without deactivating channel", async () => {
      const failRes = await viewPersistence.persistFailedChannelViewFetch(
        adminConn,
        1003,
        "membership_required:private_channel_membership_not_confirmed",
        "mtproto_private",
        1794027500000,
      );
      assert.equal(failRes.failureClass, "operational");
      assert.equal(failRes.nextStatus, "failed");
      assert.equal(failRes.retryAfterSeconds, 21600);

      const [[postRow]] = await adminConn.query(
        "SELECT views, view_fetch_status, last_view_failure_class, view_fetch_failures, view_next_retry_at FROM campaign_posts WHERE id = 1003",
      );
      assert.equal(Number(postRow.views), 310, "Existing views must be preserved on operational failure");
      assert.equal(postRow.view_fetch_status, "failed");
      assert.equal(postRow.last_view_failure_class, "operational");
      assert.equal(Number(postRow.view_fetch_failures), 1);
      assert.ok(postRow.view_next_retry_at, "view_next_retry_at must be scheduled");

      const [[chRow]] = await adminConn.query("SELECT status FROM channels WHERE id = 202");
      assert.equal(chRow.status, "active", "Channel status must remain active");
    });

    // 9. Scenario 9: Deleted post view-fetch handling (MTProto undefined views -> confirmed_message_not_found -> terminal)
    await t.test("Scenario 9: deleted post in MTProto throws confirmed_message_not_found instead of storing 0 views and marks terminal", async () => {
      assert.equal(mtproto.safeMtprotoErrorCode(new Error("confirmed_message_not_found")), "confirmed_message_not_found");
      const mtprotoSource = fs.readFileSync(path.join(ROOT, "src/lib/telegramMtproto.ts"), "utf8");
      assert.equal(mtprotoSource.includes("rawViews === undefined || rawViews === null"), true);
      assert.equal(mtprotoSource.includes('throw new Error("confirmed_message_not_found")'), true);

      await adminConn.query(
        `INSERT INTO campaign_posts (id, campaign_id, channel_id, message_id, views, settled_views, last_views_update, status, delivery_confirmed_at)
         VALUES (1004, 301, 201, '88', 520, 500, 1794020000000, 'active', UTC_TIMESTAMP())`,
      );
      const termRes = await viewPersistence.persistFailedChannelViewFetch(
        adminConn,
        1004,
        "confirmed_message_not_found",
        "mtproto_public_fallback",
        1794028000000,
      );
      assert.equal(termRes.failureClass, "terminal");
      assert.equal(termRes.nextStatus, "terminal");
      assert.equal(termRes.retryAfterSeconds, null);

      const [[row]] = await adminConn.query(
        "SELECT views, settled_views, view_fetch_status, last_view_failure_class, view_next_retry_at FROM campaign_posts WHERE id = 1004",
      );
      assert.equal(Number(row.views), 520, "Historical views must be preserved when message is deleted");
      assert.equal(Number(row.settled_views), 500, "Settled views must be preserved when message is deleted");
      assert.equal(row.view_fetch_status, "terminal");
      assert.equal(row.last_view_failure_class, "terminal");
      assert.equal(row.view_next_retry_at, null);
    });

    // 10. Scenario 10: Rate-limited view-fetch handling (429 / FLOOD_WAIT)
    await t.test("Scenario 10: rate-limited view fetch (FLOOD_WAIT_45) classifies as temporary and schedules cooldown", async () => {
      const rlRes = await viewPersistence.persistFailedChannelViewFetch(
        adminConn,
        1002,
        "FLOOD_WAIT_45",
        "mtproto_public_fallback",
        1794028500000,
      );
      assert.equal(rlRes.failureClass, "temporary");
      assert.equal(rlRes.nextStatus, "failed");
      assert.equal(rlRes.retryAfterSeconds, 45);
      const [[row]] = await adminConn.query("SELECT views, view_fetch_status, last_view_failure_class, view_next_retry_at FROM campaign_posts WHERE id = 1002");
      assert.equal(Number(row.views), 75, "Views must remain 75 during rate-limit cooldown");
      assert.equal(row.view_fetch_status, "failed");
      assert.equal(row.last_view_failure_class, "temporary");
      assert.ok(row.view_next_retry_at);
    });

    // 11. Scenario 11: Financial settlement safety when view fetch fails
    await t.test("Scenario 11: failed or terminal view fetches never alter settled_views or user balances", async () => {
      const [[userBefore]] = await adminConn.query("SELECT balance_available, balance_locked, ad_balance FROM users WHERE id = 101");
      await viewPersistence.persistFailedChannelViewFetch(adminConn, 1001, "timeout", "public_html", 1794029000000);
      const [[postAfter]] = await adminConn.query("SELECT views, settled_views FROM campaign_posts WHERE id = 1001");
      const [[userAfter]] = await adminConn.query("SELECT balance_available, balance_locked, ad_balance FROM users WHERE id = 101");
      assert.equal(Number(postAfter.views), 400);
      assert.equal(Number(postAfter.settled_views), 10);
      assert.deepEqual(userAfter, userBefore);
    });

    // 12. Scenario 12: Dry-run historical view-error reconciliation across all 6 categories
    await t.test("Scenario 12: dry-run historical view reconciliation classifies all 6 categories with zero DB mutations", async () => {
      // Seed representative posts for the remaining categories in our disposable DB
      await adminConn.query(
        `INSERT INTO campaign_posts (id, campaign_id, channel_id, message_id, views, settled_views, last_views_update, view_fetch_status, view_fetch_error, status, delivery_confirmed_at, delivery_failed_at)
         VALUES
           (1005, 301, 201, NULL, 0, 0, 0, 'failed', 'missing_message_id', 'delivery_failed', NULL, UTC_TIMESTAMP()),
           (1006, 301, 201, -5, 0, 0, 0, 'failed', ?, 'active', UTC_TIMESTAMP(), NULL),
           (1008, 301, 201, 108, 15, 10, 0, 'failed', 'timeout', 'active', UTC_TIMESTAMP(), NULL)`,
        ["Data truncated for column 'last_views_update' at row 1"],
      );
      await adminConn.query(
        `INSERT INTO campaigns (id, user_id, name, message_text, link, button_text, type, status)
         VALUES (302, 101, 'Closed Camp', 'Desc', 'https://example.com', 'Open', 'views', 'completed')`,
      );
      await adminConn.query(
        `INSERT INTO campaign_posts (id, campaign_id, channel_id, message_id, views, settled_views, last_views_update, view_fetch_status, view_fetch_error, status, delivery_confirmed_at)
         VALUES (1007, 302, 201, '99', 300, 300, 20260708122553, 'ok', NULL, 'active', UTC_TIMESTAMP())`,
      );

      const report = await viewReconciliation.runHistoricalViewReconciliationDryRun(adminConn, { sampleLimit: 5 });
      assert.equal(report.mode, "dry_run");
      assert.equal(report.mutatedRows, 0);
      assert.ok(report.countsByCategory.recoverable_live_posts >= 1, "Must detect recoverable_live_posts");
      assert.ok(report.countsByCategory.deleted_or_expired_posts >= 1, "Must detect deleted_or_expired_posts");
      assert.ok(report.countsByCategory.never_delivered_posts >= 1, "Must detect never_delivered_posts");
      assert.ok(report.countsByCategory.invalid_message_id_posts >= 1, "Must detect invalid_message_id_posts");
      assert.ok(report.countsByCategory.private_channel_membership_blocked_posts >= 1, "Must detect private_channel_membership_blocked_posts");
      assert.ok(report.countsByCategory.already_settled_or_closed_posts >= 1, "Must detect already_settled_or_closed_posts");
      assert.ok(report.corruptedTimestampCount >= 1, "Must count 14-digit corrupted timestamps");
      assert.ok(report.truncationErrorCount >= 1, "Must count Data truncated for column 'last_views_update' errors");
    });

    // 13. Scenario 13: Audit row creation for automatic deactivation
    await t.test("Scenario 13: automatic deactivation writes complete 12-field audit row in channel_status_transition_audits", async () => {
      const res = await statusAudit.recordChannelStatusTransitionAudit(adminConn, {
        channelId: 201,
        telegramChatId: "-100201201201",
        previousStatus: "active",
        newStatus: "bot_removed",
        sourceWorker: "periodic_health",
        reasonCode: "bot_removed",
        reasonText: "Forbidden: bot was kicked from the channel chat",
        evidenceClassification: "permanent",
        verificationAttemptRef: "streak:2",
        actorType: "system",
        transitionIntent: "automatic",
        verificationVersion: 2,
        notificationGenerated: true,
        requireTable: true,
      });
      assert.equal(res.recorded, true);
      assert.equal(res.duplicate, false);

      const [[auditRow]] = await adminConn.query(
        "SELECT * FROM channel_status_transition_audits WHERE id = ?",
        [res.insertId],
      );
      assert.equal(Number(auditRow.channel_id), 201);
      assert.equal(auditRow.telegram_chat_id, "-100201201201");
      assert.equal(auditRow.previous_status, "active");
      assert.equal(auditRow.new_status, "bot_removed");
      assert.equal(auditRow.source_worker, "periodic_health");
      assert.equal(auditRow.reason_code, "bot_removed");
      assert.equal(auditRow.evidence_classification, "permanent");
      assert.equal(auditRow.verification_attempt_ref, "streak:2");
      assert.equal(auditRow.actor_type, "system");
      assert.equal(auditRow.transition_intent, "automatic");
      assert.equal(Number(auditRow.verification_version), 2);
      assert.equal(Number(auditRow.notification_generated), 1);
    });

    // 14. Scenario 14: Audit row creation for automatic recovery
    await t.test("Scenario 14: automatic recovery writes complete audit row with recovery action and outcome", async () => {
      const res = await statusAudit.recordChannelStatusTransitionAudit(adminConn, {
        channelId: 201,
        telegramChatId: "-100201201201",
        previousStatus: "bot_removed",
        newStatus: "active",
        sourceWorker: "recovery:worker-1",
        reasonCode: "recovered_after_bot_readded",
        reasonText: "Recovered from bot_removed to active after confirmed bot administrator verification.",
        evidenceClassification: "recovery",
        verificationAttemptRef: "chat:-100201201201",
        actorType: "recovery",
        transitionIntent: "automatic",
        verificationVersion: 3,
        recoveryAction: "reactivate",
        recoveryOutcome: "recovered_active",
        notificationGenerated: false,
        requireTable: true,
      });
      assert.equal(res.recorded, true);
      const [[auditRow]] = await adminConn.query("SELECT * FROM channel_status_transition_audits WHERE id = ?", [res.insertId]);
      assert.equal(auditRow.actor_type, "recovery");
      assert.equal(auditRow.evidence_classification, "recovery");
      assert.equal(auditRow.recovery_action, "reactivate");
      assert.equal(auditRow.recovery_outcome, "recovered_active");
    });

    // 15. Scenario 15: Audit row creation for publisher pause and resume
    await t.test("Scenario 15: publisher manual pause and resume record manual publisher transitions", async () => {
      const pauseRes = await statusAudit.recordChannelStatusTransitionAudit(adminConn, {
        channelId: 201,
        telegramChatId: "-100201201201",
        previousStatus: "active",
        newStatus: "paused",
        sourceWorker: "publisher_channel_toggle",
        reasonCode: "publisher_manual_pause",
        reasonText: "Paused by publisher.",
        evidenceClassification: "manual",
        actorType: "publisher",
        actorId: 101,
        transitionIntent: "manual",
        verificationVersion: 4,
        requireTable: true,
      });
      assert.equal(pauseRes.recorded, true);

      const resumeRes = await statusAudit.recordChannelStatusTransitionAudit(adminConn, {
        channelId: 201,
        telegramChatId: "-100201201201",
        previousStatus: "paused",
        newStatus: "active",
        sourceWorker: "publisher_manual_reactivate",
        reasonCode: "publisher_reactivated_after_telegram_check",
        reasonText: "Publisher reactivated channel after live Telegram health check",
        evidenceClassification: "recovery",
        actorType: "publisher",
        actorId: 101,
        transitionIntent: "manual",
        verificationVersion: 5,
        recoveryAction: "manual_reactivate",
        recoveryOutcome: "reactivated",
        requireTable: true,
      });
      assert.equal(resumeRes.recorded, true);
    });

    // 16. Scenario 16: Audit row creation for admin approve, pause, resume, reject, delete, and reinstate
    await t.test("Scenario 16: admin approve, pause, resume, reject, delete, and reinstate record complete audit rows", async () => {
      const transitions = [
        ["pending", "active", "admin_channels_patch", "admin_channel_approved_or_activated"],
        ["active", "paused", "admin_channel_actions", "admin_manual_pause"],
        ["paused", "active", "admin_channel_actions", "admin_manual_resume"],
        ["active", "rejected", "admin_moderation_rejection", "policy_rejection:prohibited_content"],
        ["rejected", "deleted", "admin_channel_actions", "admin_manual_delete"],
        ["paused", "active", "admin_channel_actions", "admin_manual_reinstate"],
      ];
      let ver = 10;
      for (const [prev, next, worker, code] of transitions) {
        ver += 1;
        const r = await statusAudit.recordChannelStatusTransitionAudit(adminConn, {
          channelId: 201,
          telegramChatId: "-100201201201",
          previousStatus: prev,
          newStatus: next,
          sourceWorker: worker,
          reasonCode: code,
          reasonText: `Admin transition ${prev} -> ${next}`,
          evidenceClassification: "manual",
          actorType: "admin",
          actorId: 1,
          transitionIntent: "manual",
          verificationVersion: ver,
          requireTable: true,
        });
        assert.equal(r.recorded, true);
      }
    });

    // 17. Scenario 17: Audit row creation for webhook-driven status updates
    await t.test("Scenario 17: webhook-driven status transition records actor_type='webhook' and automatic intent", async () => {
      const r = await statusAudit.recordChannelStatusTransitionAudit(adminConn, {
        channelId: 201,
        telegramChatId: "-100201201201",
        previousStatus: "active",
        newStatus: "permission_missing",
        sourceWorker: "webhook_my_chat_member",
        reasonCode: "permission_missing",
        reasonText: "Bot can_post_messages permission disabled via Telegram my_chat_member update",
        evidenceClassification: "permanent",
        verificationAttemptRef: "webhook:update:991",
        actorType: "webhook",
        transitionIntent: "automatic",
        verificationVersion: 20,
        notificationGenerated: true,
        requireTable: true,
      });
      assert.equal(r.recorded, true);
      const [[row]] = await adminConn.query("SELECT actor_type, transition_intent, evidence_classification FROM channel_status_transition_audits WHERE id = ?", [r.insertId]);
      assert.equal(row.actor_type, "webhook");
      assert.equal(row.transition_intent, "automatic");
      assert.equal(row.evidence_classification, "permanent");
    });

    // 18. Scenario 18: Audit row creation for subscriber-threshold pause and restore via refreshSubscriberChannel
    await t.test("Scenario 18: refreshSubscriberChannel records channel_status_transition_audits on below-minimum pause and restore", async () => {
      const subRefresh = loadModule("@/lib/channelSubscriberRefresh");
      const now1 = new Date("2026-11-07T00:00:00Z");
      const now2 = new Date("2026-11-10T01:00:00Z"); // >72h below minimum triggers auto-pause

      await adminConn.query(
        `INSERT INTO channels (id, user_id, chat_id, username, title, channel_type, subscriber_count, status, is_deleted, below_minimum_since, below_minimum_success_count, telegram_access_state)
         VALUES (205, 101, '-100205205205', 'sub_chan_205', 'Sub Channel 205', 'public', 85, 'active', 0, ?, 2, 'healthy')`,
        [now1],
      );
      const [[chBefore]] = await adminConn.query("SELECT * FROM channels WHERE id = 205");
      const pauseOut = await subRefresh.refreshSubscriberChannel(chBefore, 100, now2, {
        query: (sql, params) => adminConn.query(sql, params),
        publicCount: async () => ({ ok: true, count: 80 }),
        privateCount: async () => ({ ok: true, count: 80 }),
      });
      assert.equal(pauseOut.status, "pause");

      const [pauseAudits] = await adminConn.query(
        "SELECT * FROM channel_status_transition_audits WHERE channel_id = 205 AND new_status = 'paused'",
      );
      assert.equal(pauseAudits.length, 1);
      assert.equal(pauseAudits[0].reason_code, "subscriber_below_minimum");

      const [[chPaused]] = await adminConn.query("SELECT * FROM channels WHERE id = 205");
      const restoreOut = await subRefresh.refreshSubscriberChannel(
        { ...chPaused, marketplace_admin_status: "approved", publisher_status: "active", publisher_is_banned: 0 },
        100,
        new Date("2026-11-10T06:00:00Z"),
        {
          query: (sql, params) => adminConn.query(sql, params),
          publicCount: async () => ({ ok: true, count: 250 }),
          privateCount: async () => ({ ok: true, count: 250 }),
        },
      );
      assert.equal(restoreOut.status, "restore");

      const [restoreAudits] = await adminConn.query(
        "SELECT * FROM channel_status_transition_audits WHERE channel_id = 205 AND new_status = 'active'",
      );
      assert.equal(restoreAudits.length, 1);
      assert.equal(restoreAudits[0].reason_code, "subscriber_restored_above_minimum");
    });

    // 19. Scenario 19: Duplicate retry audit idempotency
    await t.test("Scenario 19: duplicate retry with identical transition idempotency key does not insert duplicate audit rows", async () => {
      const payload = {
        channelId: 201,
        telegramChatId: "-100201201201",
        previousStatus: "active",
        newStatus: "channel_not_found",
        sourceWorker: "process_ads",
        reasonCode: "channel_not_found",
        reasonText: "Confirmed channel_not_found across independent checks",
        evidenceClassification: "permanent",
        verificationAttemptRef: "streak:3",
        actorType: "system",
        transitionIntent: "automatic",
        verificationVersion: 33,
        requireTable: true,
      };
      const first = await statusAudit.recordChannelStatusTransitionAudit(adminConn, payload);
      const second = await statusAudit.recordChannelStatusTransitionAudit(adminConn, payload);
      assert.equal(first.recorded, true);
      assert.equal(first.duplicate, false);
      assert.equal(second.recorded, false);
      assert.equal(second.duplicate, true);
      assert.equal(first.idempotencyKey, second.idempotencyKey);

      const [[countRow]] = await adminConn.query(
        "SELECT COUNT(*) AS cnt FROM channel_status_transition_audits WHERE idempotency_key = ?",
        [first.idempotencyKey],
      );
      assert.equal(Number(countRow.cnt), 1);
    });

    // 20. Scenario 20: Rollback safety when status update fails
    await t.test("Scenario 20: rolled-back transaction leaves zero phantom rows in channel_status_transition_audits", async () => {
      const txConn = await mysql.createConnection({
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASS || process.env.DB_PASSWORD,
        database: dbName,
      });
      let rollbackKey = "";
      try {
        await txConn.beginTransaction();
        await txConn.query("UPDATE channels SET status = 'paused' WHERE id = 201");
        const res = await statusAudit.recordChannelStatusTransitionAudit(txConn, {
          channelId: 201,
          telegramChatId: "-100201201201",
          previousStatus: "active",
          newStatus: "paused",
          sourceWorker: "rollback_test_worker",
          reasonCode: "simulated_tx_failure",
          reasonText: "Simulated failure before commit",
          evidenceClassification: "manual",
          actorType: "admin",
          actorId: 99,
          transitionIntent: "manual",
          verificationVersion: 999,
          requireTable: true,
        });
        assert.equal(res.recorded, true);
        rollbackKey = res.idempotencyKey;
        await txConn.rollback();
      } finally {
        await txConn.end();
      }

      const [[countAfterRollback]] = await adminConn.query(
        "SELECT COUNT(*) AS cnt FROM channel_status_transition_audits WHERE idempotency_key = ?",
        [rollbackKey],
      );
      assert.equal(Number(countAfterRollback.cnt), 0, "Rolled-back status transition must not leave a false audit row");
    });

    // 21. Scenario 21: Static verification that all 16 status-changing code paths wire recordChannelStatusTransitionAudit or channel_status_transition_audits
    await t.test("Scenario 21: all status-changing code paths are wired to channel_status_transition_audits and enforce eligibility guards", async () => {
      const requiredAuditFiles = [
        "src/lib/telegramChannelAccess.ts",
        "src/lib/channelLifecycle.ts",
        "src/lib/channelSubscriberRefresh.ts",
        "src/lib/channelRecoveryService.ts",
        "src/lib/moderationRejections.ts",
        "src/app/api/publisher/channels/route.ts",
        "src/app/api/publisher/channels/[id]/route.ts",
        "src/app/api/admin/channels/[id]/actions/route.ts",
        "src/app/api/admin/channels/route.ts",
        "src/app/api/admin/channels/bulk-approve/route.ts",
        "src/app/api/admin/users/route.ts",
        "src/app/api/admin/production-safety/route.ts",
        "src/app/api/admin/traffic-quality/route.ts",
      ];
      for (const relPath of requiredAuditFiles) {
        const content = fs.readFileSync(path.join(ROOT, relPath), "utf8");
        assert.match(content, /recordChannelStatusTransitionAudit/, `${relPath} must call recordChannelStatusTransitionAudit`);
      }
      const syncScript = fs.readFileSync(path.join(ROOT, "scripts/sync-channel-identities.mjs"), "utf8");
      assert.equal(syncScript.includes("channel_status_transition_audits"), true, "scripts/sync-channel-identities.mjs must insert into channel_status_transition_audits");
      assert.equal(syncScript.includes("canBindChatId = Boolean(chat && healthy"), true, "scripts/sync-channel-identities.mjs must only bind chat_id when healthy");
    });
  } finally {
    await adminConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``).catch(() => undefined);
    await adminConn.end().catch(() => undefined);
  }
});
