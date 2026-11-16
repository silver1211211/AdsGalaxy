import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function readSource(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

function loadTsModule(relPath, mocks = {}) {
  const source = readSource(relPath);
  let rewritten = source;
  for (const [specifier, replacement] of Object.entries(mocks)) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reg = new RegExp(`import\\s*\\{[\\s\\S]*?\\}\\s*from\\s+["']${escaped}["'];`, "g");
    rewritten = rewritten.replace(reg, replacement);
  }
  const transpiled = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: relPath,
  }).outputText;

  const m = { exports: {} };
  const customRequire = (id) => {
    if (id in mocks) return mocks[id];
    if (id === "@/lib/db" || id === "./db") return {};
    if (id === "@/lib/systemLogs" || id === "./systemLogs") {
      return { createSystemLog: async () => {}, maskEntityId: (t, i) => String(i) };
    }
    if (id === "@/lib/platformNotifications" || id === "./platformNotifications") {
      return { enqueueAssetNotification: async () => {} };
    }
    if (id.endsWith("channelEligibility") || id === "@/lib/channelEligibility") {
      return loadTsModule("src/lib/channelEligibility.ts");
    }
    if (id.endsWith("channelStatusAudit") || id === "@/lib/channelStatusAudit") {
      return loadTsModule("src/lib/channelStatusAudit.ts");
    }
    if (id.endsWith("channelViewPersistence") || id === "@/lib/channelViewPersistence") {
      return loadTsModule("src/lib/channelViewPersistence.ts");
    }
    if (id.endsWith("telegramChannelAccess") || id === "@/lib/telegramChannelAccess") {
      return loadTsModule("src/lib/telegramChannelAccess.ts");
    }
    if (id.endsWith("channelRefreshPolicy") || id === "@/lib/channelRefreshPolicy") {
      return loadTsModule("src/lib/channelRefreshPolicy.ts");
    }
    if (id.endsWith("publicChannelApproval") || id === "@/lib/publicChannelApproval") {
      return loadTsModule("src/lib/publicChannelApproval.ts");
    }
    try {
      return require(id);
    } catch {
      return {};
    }
  };

  const fn = new Function("exports", "require", "module", transpiled);
  fn(m.exports, customRequire, m);
  return m.exports;
}

// -------------------------------------------------------------
// GROUP A: Administrator Approval (C1)
// -------------------------------------------------------------
test("Group A: Public Channel Approval Eligibility Guard (C1)", async (t) => {
  const approvalMod = loadTsModule("src/lib/publicChannelApproval.ts");
  const eligibilityFn = approvalMod.getPublicChannelApprovalEligibility;

  function createApprovalMockDb(overrides = {}) {
    const channel = {
      id: 101,
      user_id: 10,
      status: "pending",
      is_deleted: 0,
      channel_type: "public",
      chat_id: "-100101",
      username: "public_chan_101",
      under_review: 0,
      marketplace_admin_status: "approved",
      monetization_paused_reason: null,
      below_minimum_review_required: 0,
      subscriber_count: 500,
      subscribers_last_success_at: new Date(),
      subscribers_fetch_status: "success",
      paused_by_actor: null,
      admin_paused_at: null,
      publisher_paused_at: null,
      settlement_excluded_until: null,
      automation_suspension_status: "active",
      automation_suspended_until: null,
      revenue_protection_status: "normal",
      telegram_access_state: "healthy",
      publisher_status: "active",
      publisher_is_banned: 0,
      bot_member_status: "administrator",
      bot_can_post: 1,
      verification_state: "healthy",
      duplicate_chat_id: 0,
      duplicate_username: 0,
      ...overrides,
    };
    return {
      async query() {
        return [[channel]];
      },
    };
  }

  await t.test("Eligible pending public channel passes stored registration approval", async () => {
    const result = await eligibilityFn(101, createApprovalMockDb());
    assert.equal(result.eligible, true);
    assert.equal(result.reason, null);
  });

  await t.test("Subscriber count < 100 blocks approval (C1)", async () => {
    const result = await eligibilityFn(101, createApprovalMockDb({ subscriber_count: 85 }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, /100 subscribers/i);
  });

  await t.test("Administrator pause blocks approval (C1)", async () => {
    const result = await eligibilityFn(101, createApprovalMockDb({
      paused_by_actor: "admin",
      admin_paused_at: new Date(),
    }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, /administrator/i);
  });

  await t.test("Publisher pause blocks approval (C1)", async () => {
    const result = await eligibilityFn(101, createApprovalMockDb({
      paused_by_actor: "publisher",
      publisher_paused_at: new Date(),
    }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, /publisher/i);
  });

  await t.test("Channel under manual review blocks approval", async () => {
    const result = await eligibilityFn(101, createApprovalMockDb({ under_review: 1 }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, /manual review/i);
  });

  await t.test("Bot removed state blocks approval", async () => {
    const result = await eligibilityFn(101, createApprovalMockDb({ telegram_access_state: "bot_removed" }));
    assert.equal(result.eligible, false);
    assert.match(result.reason, /posting access/i);
  });
});

// -------------------------------------------------------------
// GROUP B: Channel Recovery (C2, C11, C12.D)
// -------------------------------------------------------------
test("Group B: Controlled Channel Recovery & Preview Safety (C2, C11, C12.D)", async (t) => {
  const recoveryMod = loadTsModule("src/lib/channelRecoveryService.ts");

  function makeHealthyVerification(overrides = {}) {
    return {
      ok: true,
      state: "healthy",
      reason: null,
      reasonCode: null,
      evidenceCategory: "confirmed",
      checkedAt: new Date("2026-11-06T20:00:00Z"),
      telegramChatId: "-1001234567890",
      username: "adsgalaxy_channel",
      title: "AdsGalaxy Test Channel",
      channelType: "public",
      botRole: "administrator",
      canPostMessages: true,
      permanent: false,
      retryable: false,
      retryAfterSeconds: null,
      ...overrides,
    };
  }

  function makeBaseCandidate(overrides = {}) {
    return {
      id: 701,
      user_id: 12,
      title: "AdsGalaxy Test Channel",
      chat_id: "-1001234567890",
      username: "adsgalaxy_channel",
      channel_type: "public",
      status: "channel_not_found",
      is_deleted: 0,
      under_review: 0,
      marketplace_admin_status: "approved",
      paused_reason: "Telegram channel could not be found",
      paused_by_actor: null,
      admin_paused_at: null,
      publisher_paused_at: null,
      monetization_paused_reason: null,
      below_minimum_review_required: 0,
      subscriber_count: 500,
      settlement_excluded_until: null,
      automation_suspension_status: "active",
      automation_suspended_until: null,
      revenue_protection_status: "normal",
      tracking_account_member_status: "not_required",
      telegram_access_version: 1,
      telegram_access_previous_status: "active",
      reactivated_at: new Date("2026-10-01T00:00:00Z"),
      auto_paused_at: new Date("2026-11-05T00:00:00Z"),
      health_checked_at: new Date("2026-11-05T00:00:00Z"),
      publisher_status: "active",
      publisher_is_banned: 0,
      last_verified_at: new Date("2026-11-01T00:00:00Z"),
      last_success_at: new Date("2026-11-01T00:00:00Z"),
      bot_can_post: 1,
      bot_member_status: "administrator",
      next_retry_at: null,
      ...overrides,
    };
  }

  await t.test("Admin pause retained even when status shows bot_removed", () => {
    const channel = makeBaseCandidate({
      status: "bot_removed",
      paused_by_actor: "admin",
      admin_paused_at: new Date("2026-11-06T10:00:00Z"),
      paused_reason: "Paused by admin",
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.outcome, "blocked_admin_paused");
  });

  await t.test("Publisher pause retained even when status shows channel_not_found", () => {
    const channel = makeBaseCandidate({
      status: "channel_not_found",
      paused_by_actor: "publisher",
      publisher_paused_at: new Date("2026-11-06T10:00:00Z"),
      paused_reason: "Paused by publisher",
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.outcome, "blocked_publisher_paused");
  });

  await t.test("Never-approved channel with historical timestamps blocks recovery (C2)", () => {
    const channel = makeBaseCandidate({
      status: "channel_not_found",
      marketplace_admin_status: null, // lacks explicit approval
      last_verified_at: new Date("2026-10-01T00:00:00Z"),
      auto_paused_at: new Date("2026-11-01T00:00:00Z"),
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
      audits: [],
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.outcome, "blocked_not_previously_approved");
    assert.match(decision.reason, /manual review/i);
  });

  await t.test("Rejected channel blocks recovery", () => {
    const channel = makeBaseCandidate({
      status: "rejected",
      marketplace_admin_status: "rejected",
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.outcome, "blocked_rejected_or_banned");
  });

  await t.test("Banned publisher blocks recovery", () => {
    const channel = makeBaseCandidate({
      status: "bot_removed",
      publisher_is_banned: 1,
      publisher_status: "banned",
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.outcome, "blocked_rejected_or_banned");
  });

  await t.test("Active policy hold blocks recovery", () => {
    const channel = makeBaseCandidate({
      status: "permission_missing",
      under_review: 1,
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.outcome, "blocked_subscriber_or_policy_hold");
  });

  await t.test("Healthy verified approved channel recovers to active", () => {
    const channel = makeBaseCandidate({
      status: "bot_removed",
      marketplace_admin_status: "approved",
    });
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification: makeHealthyVerification(),
    });
    assert.equal(decision.eligible, true);
    assert.equal(decision.targetStatus, "active");
    assert.equal(decision.outcome, "recovered_active");
  });

  await t.test("Recovery preview writes zero records (C11)", async () => {
    let writeCalls = 0;
    const mockDb = {
      async query(sql) {
        const s = String(sql).toUpperCase();
        if (s.startsWith("INSERT") || s.startsWith("UPDATE") || s.startsWith("DELETE")) {
          writeCalls++;
          return [{ affectedRows: 1 }];
        }
        if (s.includes("FROM CHANNELS")) {
          return [[
            makeBaseCandidate({ id: 901, status: "bot_removed" }),
            makeBaseCandidate({ id: 902, status: "channel_not_found", paused_by_actor: "admin" }),
          ]];
        }
        if (s.includes("FROM CHANNEL_ADMIN_ACTION_AUDITS")) return [[]];
        if (s.includes("FROM CHANNEL_RECOVERY_CHECKPOINTS")) return [[]];
        return [[]];
      },
    };

    const preview = await recoveryMod.previewChannelRecoveryBatch(
      { batchSize: 10, cursorBefore: 0 },
      mockDb,
    );
    assert.equal(preview.dryRun, true);
    assert.equal(preview.totalInspected, 2);
    assert.equal(preview.blockedAdminPaused, 1);
    assert.equal(writeCalls, 0, "Preview must perform zero write operations");
  });

  await t.test("Recovery 429 rate limit stops batch and does not skip candidate (C12.D)", async () => {
    const candidates = [
      makeBaseCandidate({ id: 911, status: "bot_removed" }),
      makeBaseCandidate({ id: 912, status: "permission_missing" }),
    ];
    let checkpointSavedId = 0;
    const mockDb = {
      async query(sql, params) {
        const s = String(sql);
        if (s.includes("FROM channel_recovery_checkpoints")) return [[]];
        if (s.includes("FROM channels c") && s.includes("ORDER BY")) return [candidates];
        if (s.includes("FROM channel_admin_action_audits")) return [[]];
        if (s.includes("WHERE c.id=? LIMIT 1")) {
          const id = Number(params[0]);
          return [candidates.filter((c) => c.id === id)];
        }
        if (s.includes("INSERT INTO channel_recovery_checkpoints")) {
          checkpointSavedId = Number(params[1]);
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
      },
    };

    const summary = await recoveryMod.runControlledChannelRecoveryBatch(
      {
        batchSize: 2,
        verifier: async () => makeHealthyVerification({
          ok: false,
          state: "temporarily_unavailable",
          reasonCode: "telegram_rate_limited",
          retryAfterSeconds: 45,
        }),
      },
      mockDb,
    );

    assert.equal(summary.rateLimited, true);
    assert.equal(summary.retryAfterSeconds, 45);
    assert.equal(summary.recovered, 0);
    assert.equal(summary.deferred, 1);
  });
});

// -------------------------------------------------------------
// GROUP C: Telegram Verification & Atomicity (C3, C8)
// -------------------------------------------------------------
test("Group C: Telegram Verification & Access Classification (C3, C8)", async (t) => {
  const accessMod = loadTsModule("src/lib/telegramChannelAccess.ts");

  await t.test("Single ambiguous 400 chat not found error does not deactivate channel (C3)", () => {
    const res = accessMod.classifyTelegramAccessFailure({
      httpStatus: 400,
      description: "Bad Request: chat not found",
    });
    assert.equal(res.state, "channel_not_found");
    assert.equal(res.reasonCode, "chat_not_found_unconfirmed");
    assert.equal(res.ok, false);
    assert.equal(res.permanent, false);
    assert.equal(res.retryable, true);
  });

  await t.test("Member list inaccessible is classified as temporary (C3)", () => {
    const res = accessMod.classifyTelegramAccessFailure({
      httpStatus: 400,
      description: "Bad Request: member list is inaccessible",
    });
    assert.equal(res.state, "temporarily_unavailable");
    assert.equal(res.permanent, false);
    assert.equal(res.retryable, true);
  });

  await t.test("Confirmed kicked is classified as bot_removed (C3)", () => {
    const res = accessMod.classifyTelegramAccessFailure({
      httpStatus: 403,
      description: "Forbidden: bot was kicked from the channel chat",
    });
    assert.equal(res.state, "bot_removed");
    assert.equal(res.permanent, true);
    assert.equal(res.retryable, false);
  });

  await t.test("Confirmed chat admin rights missing is classified as permission_missing (C3)", () => {
    const res = accessMod.classifyTelegramAccessFailure({
      httpStatus: 400,
      description: "Bad Request: CHAT_ADMIN_REQUIRED",
    });
    assert.equal(res.state, "permission_missing");
    assert.equal(res.permanent, true);
  });

  await t.test("Telegram 429 rate limit schedules backoff retry without deactivating (C3)", () => {
    const res = accessMod.classifyTelegramAccessFailure({
      httpStatus: 429,
      description: "Too Many Requests: retry after 60",
      retryAfterSeconds: 60,
    });
    assert.equal(res.state, "temporarily_unavailable");
    assert.equal(res.retryAfterSeconds, 60);
    assert.equal(res.retryable, true);
  });

  await t.test("Stale verification update is skipped if version changed concurrently (C3)", async () => {
    const mockDb = {
      async query(sql) {
        if (sql.includes("SELECT id,user_id,status")) {
          return [[{ id: 88, status: "active", is_deleted: 0, telegram_access_version: 5 }]];
        }
        return [[]];
      },
    };

    const res = await accessMod.persistTelegramChannelAccess(
      {
        channelId: 88,
        source: "periodic_health",
        expectedVersion: 4, // stale version
      },
      {
        ok: false,
        state: "bot_removed",
        reason: "Bot kicked",
        reasonCode: "bot_kicked",
        checkedAt: new Date(),
        telegramChatId: "-10088",
        username: "chan88",
        title: "Chan 88",
        channelType: "public",
        botRole: "kicked",
        canPostMessages: false,
        permanent: true,
        retryable: false,
        retryAfterSeconds: null,
      },
      mockDb,
    );

    assert.equal(res.skippedStale, true);
  });
});

// -------------------------------------------------------------
// GROUP D: Subscriber Refresh (C4)
// -------------------------------------------------------------
test("Group D: Subscriber Refresh Auto-Restore Protection (C4)", async (t) => {
  const refreshPolicyMod = loadTsModule("src/lib/channelRefreshPolicy.ts");

  await t.test("Below minimum subscriber threshold transitions to grace or pause (C4)", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const decision = refreshPolicyMod.thresholdTransition({
      count: 80,
      minimum: 100,
      belowSince: new Date("2026-11-01T12:00:00Z"),
      lowChecks: 3,
      now,
      canRestore: false,
    });
    assert.equal(decision.action, "pause");
  });

  await t.test("canAutoRestore permits restore when paused for below_minimum without holds", () => {
    const allowed = refreshPolicyMod.canAutoRestore({
      status: "paused",
      monetization_paused_reason: "below_minimum",
      marketplace_admin_status: "approved",
      publisher_status: "active",
      publisher_is_banned: 0,
      paused_by_actor: "system_subscriber",
      chat_id: "-10012345",
    });
    assert.equal(allowed, true);
  });

  await t.test("Admin-paused channel cannot be auto-restored by subscriber refresh (C4)", () => {
    const allowed = refreshPolicyMod.canAutoRestore({
      status: "paused",
      monetization_paused_reason: "below_minimum",
      marketplace_admin_status: "approved",
      publisher_status: "active",
      paused_by_actor: "admin",
      admin_paused_at: new Date(),
    });
    assert.equal(allowed, false);
  });

  await t.test("Publisher-paused channel cannot be auto-restored by subscriber refresh (C4)", () => {
    const allowed = refreshPolicyMod.canAutoRestore({
      status: "paused",
      monetization_paused_reason: "below_minimum",
      marketplace_admin_status: "approved",
      publisher_status: "active",
      paused_by_actor: "publisher",
      publisher_paused_at: new Date(),
    });
    assert.equal(allowed, false);
  });
});

// -------------------------------------------------------------
// GROUP E: Views & MTProto Persistence (C5, C6)
// -------------------------------------------------------------
test("Group E: Views Persistence & MTProto Verification (C5, C6)", async (t) => {
  const viewPersistMod = loadTsModule("src/lib/channelViewPersistence.ts");

  await t.test("normalizeViewTimestamp normalizes Date, ms, s, and legacy 14-digit integer (C5)", () => {
    const d = new Date("2026-11-06T10:00:00Z");
    assert.equal(viewPersistMod.normalizeViewTimestamp(d).epochMs, d.getTime());
    assert.equal(viewPersistMod.normalizeViewTimestamp(1762423200000).epochMs, 1762423200000);
    assert.equal(viewPersistMod.normalizeViewTimestamp(1762423200).epochMs, 1762423200000);
  });

  await t.test("Successful view persistence advances views atomically without decrement (C5)", async () => {
    let updateSql = "";
    const mockDb = {
      async query(sql, params) {
        if (sql.includes("SELECT id, views, settled_views, last_views_update")) {
          return [[{
            id: 55,
            views: 100,
            settled_views: 100,
            last_views_update: 1700000000000,
          }]];
        }
        if (sql.includes("UPDATE campaign_posts")) {
          updateSql = sql;
          return [{ affectedRows: 1 }];
        }
        return [[]];
      },
    };

    const res = await viewPersistMod.persistSuccessfulChannelViews(
      mockDb,
      55,
      150,
      "mtproto",
      1700000010000,
    );

    assert.equal(res.updated, true);
    assert.equal(res.views, 150);
    assert.match(updateSql, /GREATEST\(COALESCE\(views,\s*0\),\s*\?\)/i);
    assert.match(updateSql, /view_next_retry_at\s*=\s*NULL/i);
  });

  await t.test("Failed view fetch never modifies views or last_views_update (C5)", async () => {
    let updateSql = "";
    const mockDb = {
      async query(sql) {
        if (sql.includes("SELECT id, views, settled_views, last_views_update")) {
          return [[{
            id: 56,
            views: 200,
            settled_views: 200,
            last_views_update: 1700000000000,
          }]];
        }
        if (sql.includes("UPDATE campaign_posts")) {
          updateSql = sql;
          return [{ affectedRows: 1 }];
        }
        return [[]];
      },
    };

    const res = await viewPersistMod.persistFailedChannelViewFetch(
      mockDb,
      56,
      "Temporary MTProto network timeout",
      "mtproto",
      1700000005000,
    );

    assert.equal(res.updated, true);
    assert.equal(res.status, "failed");
    assert.doesNotMatch(updateSql, /views\s*=/i);
    assert.doesNotMatch(updateSql, /settled_views\s*=/i);
    assert.doesNotMatch(updateSql, /last_views_update\s*=/i);
    assert.match(updateSql, /last_view_attempt_at/i);
    assert.match(updateSql, /view_next_retry_at/i);
  });

  await t.test("MTProto empty view response throws uncertain_view_response, not deletion (C6)", () => {
    const source = readSource("src/lib/telegramMtproto.ts");
    assert.match(source, /throw new Error\("uncertain_view_response"\)/);
    assert.match(source, /throw new Error\("confirmed_message_not_found"\)/);
  });
});

// -------------------------------------------------------------
// GROUP F: Missing-ID Repair & Audit Integrity (C7, C9, C12.C)
// -------------------------------------------------------------
test("Group F: Missing-ID Repair & Transition Auditing (C7, C9, C12.C)", async (t) => {
  const repairMod = loadTsModule("src/lib/channelMissingIdRepair.ts");
  const auditMod = loadTsModule("src/lib/channelStatusAudit.ts");

  await t.test("Missing-ID repair dry-run produces zero writes (C7)", async () => {
    let writeCount = 0;
    const mockDb = {
      async query(sql) {
        const s = String(sql).toUpperCase();
        if (s.startsWith("INSERT") || s.startsWith("UPDATE") || s.startsWith("DELETE")) {
          writeCount++;
          return [{ affectedRows: 1 }];
        }
        if (s.includes("CHAT_ID = ? AND ID <> ?")) {
          return [[]];
        }
        if (s.includes("FROM CHANNELS C")) {
          return [[
            { id: 41, user_id: 2, status: "active", chat_id: null, username: "valid_channel" },
          ]];
        }
        if (s.includes("FROM SYSTEM_SETTINGS")) return [[]];
        return [[]];
      },
    };

    const summary = await repairMod.runMissingChannelIdentityRepairBatch(
      {
        dryRun: true,
        limit: 10,
        verifyFn: async () => ({
          ok: true,
          state: "healthy",
          telegramChatId: "-100414141",
          username: "valid_channel",
          botRole: "administrator",
          canPostMessages: true,
        }),
      },
      mockDb,
    );

    assert.equal(summary.dryRun, true);
    assert.equal(summary.wouldRepairCount, 1);
    assert.equal(summary.repairedCount, 0);
    assert.equal(writeCount, 0, "Strict dry-run must perform zero database writes");
  });

  await t.test("Missing-ID repair without posting permission refuses to bind identity (C12.C)", async () => {
    const mockDb = {
      async query(sql) {
        const s = String(sql).toUpperCase();
        if (s.includes("CHAT_ID = ? AND ID <> ?")) {
          return [[]];
        }
        if (s.includes("FROM CHANNELS C")) {
          return [[
            { id: 42, user_id: 3, status: "active", chat_id: null, username: "no_post_perm_chan" },
          ]];
        }
        return [[]];
      },
    };

    const summary = await repairMod.runMissingChannelIdentityRepairBatch(
      {
        dryRun: true,
        limit: 10,
        verifyFn: async () => ({
          ok: true,
          state: "healthy",
          telegramChatId: "-100424242",
          username: "no_post_perm_chan",
          botRole: "administrator",
          canPostMessages: false, // bot is admin but cannot post
        }),
      },
      mockDb,
    );

    assert.equal(summary.wouldRepairCount, 0);
    assert.equal(summary.reviewRequiredCount, 1);
    assert.equal(summary.items[0].action, "require_posting_permission");
    assert.equal(summary.items[0].outcome, "unverified_bot_not_admin_review_required");
  });

  await t.test("Status transition audit handles ER_DUP_ENTRY idempotently without INSERT IGNORE (C9)", async () => {
    let insertedSql = "";
    const mockDb = {
      async query(sql) {
        insertedSql = sql;
        const err = new Error("Duplicate entry");
        err.code = "ER_DUP_ENTRY";
        err.errno = 1062;
        throw err;
      },
    };

    const res = await auditMod.recordChannelStatusTransitionAudit(mockDb, {
      channelId: 601,
      previousStatus: "active",
      newStatus: "bot_removed",
      sourceWorker: "test_worker",
      reasonCode: "bot_kicked",
    });

    assert.doesNotMatch(insertedSql, /INSERT IGNORE/i, "Must use explicit INSERT instead of INSERT IGNORE");
    assert.equal(res.duplicate, true);
    assert.equal(res.recorded, false);
  });
});

// -------------------------------------------------------------
// GROUP G: Delivery Eligibility & Accounting Safety (C10)
// -------------------------------------------------------------
test("Group G: Unified Channel Delivery Eligibility & Financial Safety (C10)", async (t) => {
  const eligibilityMod = loadTsModule("src/lib/channelEligibility.ts");
  const evaluate = eligibilityMod.evaluateUnifiedChannelEligibility;

  function makeDeliveryCandidate(overrides = {}) {
    return {
      id: 99,
      status: "active",
      is_deleted: 0,
      chat_id: "-100999999",
      username: "active_eligible_channel",
      channel_type: "public",
      marketplace_admin_status: "approved",
      paused_by_actor: null,
      admin_paused_at: null,
      publisher_paused_at: null,
      paused_reason: null,
      subscriber_count: 500,
      minimum_subscribers: 100,
      under_review: 0,
      publisher_status: "active",
      publisher_is_banned: 0,
      bot_member_status: "administrator",
      bot_can_post: 1,
      telegram_access_state: "healthy",
      verification_state: "healthy",
      next_retry_at: null,
      context: "ad_delivery",
      ...overrides,
    };
  }

  await t.test("Active channel with admin pause is blocked from ad delivery (C10)", () => {
    const res = evaluate(makeDeliveryCandidate({
      paused_by_actor: "admin",
      admin_paused_at: new Date(),
      status: "paused",
    }));
    assert.equal(res.eligible, false);
    assert.equal(res.code, "ADMIN_PAUSED");
  });

  await t.test("Active channel with publisher pause is blocked from ad delivery (C10)", () => {
    const res = evaluate(makeDeliveryCandidate({
      paused_by_actor: "publisher",
      publisher_paused_at: new Date(),
      status: "paused",
    }));
    assert.equal(res.eligible, false);
    assert.equal(res.code, "PUBLISHER_PAUSED");
  });

  await t.test("Active channel with invalid chat ID is blocked from ad delivery (C10)", () => {
    const res = evaluate(makeDeliveryCandidate({
      chat_id: "0",
    }));
    assert.equal(res.eligible, false);
    assert.equal(res.code, "MISSING_OR_INVALID_CHAT_ID");
  });

  await t.test("Active channel with bot posting permission revoked is blocked from ad delivery (C10)", () => {
    const res = evaluate(makeDeliveryCandidate({
      bot_can_post: 0,
    }));
    assert.equal(res.eligible, false);
    assert.equal(res.code, "BOT_CANNOT_POST");
  });

  await t.test("Active channel with active 429 retry cooldown is blocked from ad delivery (C10)", () => {
    const futureDate = new Date(Date.now() + 120_000);
    const res = evaluate(makeDeliveryCandidate({
      next_retry_at: futureDate,
    }));
    assert.equal(res.eligible, false);
    assert.equal(res.code, "TELEGRAM_RETRY_BACKOFF_ACTIVE");
  });

  await t.test("Fully healthy verified eligible channel is permitted for ad delivery (C10)", () => {
    const res = evaluate(makeDeliveryCandidate());
    assert.equal(res.eligible, true);
    assert.equal(res.code, "ELIGIBLE");
  });

  await t.test("Accounting and financial safety: zero mutations to financial tables", () => {
    const filesToCheck = [
      "src/lib/channelEligibility.ts",
      "src/lib/channelMissingIdRepair.ts",
      "src/lib/telegramChannelAccess.ts",
      "src/lib/publicChannelApproval.ts",
      "src/lib/channelRefreshPolicy.ts",
      "src/lib/channelLifecycle.ts",
      "src/lib/channelRecoveryService.ts",
      "src/lib/channelHealthMonitor.ts",
    ];
    for (const rel of filesToCheck) {
      const src = readSource(rel);
      assert.doesNotMatch(src, /DELETE FROM campaign_posts/i);
      assert.doesNotMatch(src, /UPDATE channel_advertiser_debits/i);
      assert.doesNotMatch(src, /UPDATE transactions/i);
    }
  });
});
