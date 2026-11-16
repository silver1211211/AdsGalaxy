import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseMissingIdRepairCliArgs } from "../scripts/repair-missing-channel-identities.mjs";

const ROOT = process.cwd();

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

const transpileCache = new Map();

function loadTsModule(relPath, mocks = {}, globals = {}) {
  let transpiled = transpileCache.get(relPath);
  if (!transpiled) {
    const source = readSource(relPath);
    transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: relPath,
    }).outputText;
    transpileCache.set(relPath, transpiled);
  }

  const moduleObj = { exports: {} };
  const requireFn = (specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier === "@/lib/channelStatusAudit" || specifier === "./channelStatusAudit") {
      return {
        recordChannelStatusTransitionAudit: async (db, input) => {
          if (db && typeof db.query === "function") {
            try {
              await db.query(
                "INSERT IGNORE INTO channel_status_transition_audits (channel_id, previous_status, new_status, source_worker, reason_code) VALUES (?, ?, ?, ?, ?)",
                [input.channelId, input.previousStatus, input.newStatus, input.sourceWorker, input.reasonCode],
              );
            } catch {}
          }
          return { recorded: true, duplicate: false };
        },
      };
    }
    if (specifier === "@/lib/channelEligibility" || specifier === "./channelEligibility") {
      return loadTsModule("src/lib/channelEligibility.ts", mocks, globals);
    }
    throw new Error(`Unexpected require(${specifier}) in ${relPath}`);
  };
  const wrapper = new vm.Script(
    `(function(exports, require, module, fetch, process) {\n${transpiled}\n})`,
    { filename: relPath },
  );
  const fn = wrapper.runInThisContext();
  fn(
    moduleObj.exports,
    requireFn,
    moduleObj,
    globals.fetch || globalThis.fetch,
    globals.process || process,
  );
  return moduleObj.exports;
}

function createBatch3Harness(initialChannels = [], initialIdentities = []) {
  const channels = new Map();
  const identities = new Map();
  const reconciliations = [];
  const notifications = [];
  const systemLogs = [];
  const adminAudits = [];

  for (const ch of initialChannels) {
    channels.set(Number(ch.id), {
      id: Number(ch.id),
      user_id: Number(ch.user_id ?? 100),
      title: ch.title ?? `Channel #${ch.id}`,
      chat_id: ch.chat_id !== undefined ? ch.chat_id : `-100${ch.id}`,
      username: ch.username !== undefined ? ch.username : `channel_${ch.id}`,
      channel_type: ch.channel_type ?? "public",
      status: ch.status ?? "active",
      is_deleted: ch.is_deleted ? 1 : 0,
      under_review: ch.under_review ? 1 : 0,
      marketplace_admin_status: ch.marketplace_admin_status ?? "approved",
      paused_by_actor: ch.paused_by_actor ?? null,
      paused_reason: ch.paused_reason ?? null,
      suggested_fix: ch.suggested_fix ?? null,
      failure_reason: ch.failure_reason ?? null,
      monetization_paused_reason: ch.monetization_paused_reason ?? null,
      below_minimum_review_required: ch.below_minimum_review_required ? 1 : 0,
      settlement_excluded_until: ch.settlement_excluded_until ?? null,
      automation_suspension_status: ch.automation_suspension_status ?? "active",
      automation_suspended_until: ch.automation_suspended_until ?? null,
      revenue_protection_status: ch.revenue_protection_status ?? "normal",
      publisher_status: ch.publisher_status ?? "active",
      subscriber_count: ch.subscriber_count !== undefined ? ch.subscriber_count : 1000,
      publisher_is_banned: ch.publisher_is_banned ? 1 : 0,
      health_status: ch.health_status ?? "healthy",
      health_failure_reason: ch.health_failure_reason ?? null,
      telegram_access_state: ch.telegram_access_state ?? "healthy",
      telegram_access_version: Number(ch.telegram_access_version ?? 1),
      notification_state_version: Number(ch.notification_state_version ?? 0),
      health_checked_at: ch.health_checked_at ?? null,
      reactivated_at: ch.reactivated_at ?? null,
    });
  }

  for (const idRow of initialIdentities) {
    identities.set(Number(idRow.channel_id), {
      channel_id: Number(idRow.channel_id),
      telegram_chat_id: String(idRow.telegram_chat_id ?? `-100${idRow.channel_id}`),
      channel_type: idRow.channel_type ?? "public",
      current_username: idRow.current_username ?? null,
      previous_username: idRow.previous_username ?? null,
      last_username_changed_at: idRow.last_username_changed_at ?? null,
      migrated_from_chat_id: idRow.migrated_from_chat_id ?? null,
      last_migrated_at: idRow.last_migrated_at ?? null,
      bot_member_status: idRow.bot_member_status ?? "administrator",
      bot_can_post: idRow.bot_can_post ?? 1,
      verification_state: idRow.verification_state ?? "healthy",
      consecutive_failure_count: Number(idRow.consecutive_failure_count ?? 0),
      next_retry_at: idRow.next_retry_at ?? null,
      last_failure_code: idRow.last_failure_code ?? null,
      last_failure_reason: idRow.last_failure_reason ?? null,
      last_check_source: idRow.last_check_source ?? null,
    });
  }

  const query = async (sql, params = []) => {
    const normalizedSql = String(sql).replace(/\s+/g, " ").trim();

    if (normalizedSql.includes("FROM channels WHERE id = ? FOR UPDATE") || normalizedSql.includes("FROM channels WHERE id=? FOR UPDATE")) {
      const ch = channels.get(Number(params[0]));
      if (!ch || ch.is_deleted) return [[]];
      return [[{ ...ch }]];
    }

    if (normalizedSql.includes("FROM channels WHERE chat_id = ? AND id != ?") || normalizedSql.includes("FROM channels WHERE chat_id=? AND id!=?")) {
      const [chatId, excludeId] = params;
      for (const ch of channels.values()) {
        if (!ch.is_deleted && String(ch.chat_id) === String(chatId) && Number(ch.id) !== Number(excludeId)) {
          return [[{ id: ch.id }]];
        }
      }
      return [[]];
    }

    if (normalizedSql.startsWith("SELECT telegram_access_version FROM channels WHERE id=?")) {
      const ch = channels.get(Number(params[0]));
      return [ch && !ch.is_deleted ? [{ telegram_access_version: ch.telegram_access_version }] : []];
    }

    if (normalizedSql.startsWith("SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>?")) {
      const [chatId, excludeId] = params;
      for (const ch of channels.values()) {
        if (!ch.is_deleted && String(ch.chat_id) === String(chatId) && Number(ch.id) !== Number(excludeId)) {
          return [[{ id: ch.id }]];
        }
      }
      return [[]];
    }

    if (normalizedSql.startsWith("SELECT id, user_id, status, title, username FROM channels WHERE is_deleted = FALSE AND chat_id = ? AND id <> ?")) {
      const [chatId, excludeId] = params;
      for (const ch of channels.values()) {
        if (!ch.is_deleted && String(ch.chat_id) === String(chatId) && Number(ch.id) !== Number(excludeId)) {
          return [[{ ...ch }]];
        }
      }
      return [[]];
    }

    if (normalizedSql.startsWith("SELECT id,user_id,status,title,chat_id,username,channel_type,telegram_access_state,telegram_access_version")) {
      const ch = channels.get(Number(params[0]));
      if (!ch || ch.is_deleted) return [[]];
      return [[{ ...ch }]];
    }

    if (normalizedSql.startsWith("SELECT c.id, c.status, c.is_deleted, c.channel_type, c.chat_id, c.username, c.paused_reason")) {
      const ch = channels.get(Number(params[0]));
      if (!ch) return [[]];
      return [[{ ...ch }]];
    }

    if (normalizedSql.startsWith("SELECT c.id,c.user_id,c.status,c.is_deleted,c.channel_type,c.chat_id,c.username")) {
      const ch = channels.get(Number(params[0]));
      if (!ch) return [[]];
      const ti = identities.get(Number(ch.id));
      let duplicateChatId = 0;
      let duplicateUsername = 0;
      for (const other of channels.values()) {
        if (other.is_deleted || other.id === ch.id) continue;
        if (!["active", "pending", "paused", "bot_removed", "permission_missing", "channel_not_found"].includes(other.status)) continue;
        if (ch.chat_id && String(ch.chat_id) !== "0" && String(other.chat_id) === String(ch.chat_id)) duplicateChatId += 1;
        if (ch.username && other.username && String(other.username).replace(/^@/, "").toLowerCase() === String(ch.username).replace(/^@/, "").toLowerCase()) {
          duplicateUsername += 1;
        }
      }
      return [[{
        ...ch,
        bot_member_status: ti ? ti.bot_member_status : undefined,
        bot_can_post: ti ? ti.bot_can_post : undefined,
        verification_state: ti ? ti.verification_state : undefined,
        duplicate_chat_id: duplicateChatId,
        duplicate_username: duplicateUsername,
      }]];
    }

    if (normalizedSql.startsWith("SELECT c.id, c.user_id, c.status, c.title, c.chat_id, c.username, c.channel_type, c.under_review, c.telegram_access_state")) {
      const [afterId, limit] = params;
      const rows = Array.from(channels.values())
        .filter((ch) => {
          if (ch.is_deleted || ch.id <= Number(afterId)) return false;
          const raw = ch.chat_id == null ? "" : String(ch.chat_id).trim();
          return !raw || raw === "0" || !/^-[1-9]\d*$/.test(raw);
        })
        .sort((a, b) => a.id - b.id)
        .slice(0, Number(limit))
        .map((ch) => {
          const ti = identities.get(ch.id);
          return {
            ...ch,
            identity_telegram_chat_id: ti?.telegram_chat_id ?? null,
            identity_current_username: ti?.current_username ?? null,
            identity_bot_member_status: ti?.bot_member_status ?? null,
            identity_bot_can_post: ti?.bot_can_post ?? null,
          };
        });
      return [rows];
    }

    if (normalizedSql.startsWith("UPDATE channels SET chat_id=COALESCE(?,chat_id)") && normalizedSql.includes("telegram_access_state='healthy'")) {
      const [chatId, username, title, channelId] = params;
      const ch = channels.get(Number(channelId));
      if (!ch || ch.is_deleted) return [{ affectedRows: 0 }];
      if (chatId != null) ch.chat_id = chatId;
      if (username != null) ch.username = username;
      if (title != null && title !== "") ch.title = title;
      if (ch.telegram_access_state !== "healthy") ch.telegram_access_version += 1;
      ch.telegram_access_state = "healthy";
      ch.health_status = "healthy";
      ch.health_checked_at = new Date();
      ch.failure_reason = null;
      ch.health_failure_reason = null;
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("UPDATE channels SET chat_id=CASE WHEN chat_id IS NULL")) {
      const [chatId, username, title, persistedState, persistedStateCmp, healthStatus, failureReason, healthFailureReason, channelId] = params;
      const ch = channels.get(Number(channelId));
      if (!ch || ch.is_deleted) return [{ affectedRows: 0 }];
      if ((!ch.chat_id || String(ch.chat_id) === "0") && chatId != null) ch.chat_id = chatId;
      if (username != null) ch.username = username;
      if (title != null && title !== "") ch.title = title;
      if (ch.telegram_access_state !== persistedStateCmp) ch.telegram_access_version += 1;
      ch.telegram_access_state = persistedState;
      ch.health_status = healthStatus;
      ch.health_checked_at = new Date();
      ch.failure_reason = failureReason;
      ch.health_failure_reason = healthFailureReason;
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("UPDATE channels SET chat_id = ?, username = COALESCE(?, username)")) {
      const [chatId, username, title] = params;
      const channelId = params.length >= 5 ? params[3] : params[params.length - 1];
      const ch = channels.get(Number(channelId));
      if (!ch || ch.is_deleted) return [{ affectedRows: 0 }];
      const raw = ch.chat_id == null ? "" : String(ch.chat_id).trim();
      if (raw && raw !== "0" && /^-[1-9]\d*$/.test(raw)) return [{ affectedRows: 0 }];
      ch.chat_id = chatId;
      if (username != null) ch.username = username;
      if (title != null && title !== "") ch.title = title;
      ch.telegram_access_state = "healthy";
      ch.health_status = "healthy";
      ch.telegram_access_version += 1;
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("INSERT INTO channel_telegram_identities")) {
      const [channelId, identityChatId, channelType, currentUsername, botRole, botCanPost, verificationState] = params;
      const existing = identities.get(Number(channelId));
      const usernameChanged = existing && existing.current_username && currentUsername && existing.current_username !== currentUsername;
      identities.set(Number(channelId), {
        channel_id: Number(channelId),
        telegram_chat_id: identityChatId,
        channel_type: channelType,
        previous_username: usernameChanged ? existing.current_username : (existing?.previous_username ?? null),
        last_username_changed_at: usernameChanged ? new Date() : (existing?.last_username_changed_at ?? null),
        migrated_from_chat_id: existing?.migrated_from_chat_id ?? null,
        last_migrated_at: existing?.last_migrated_at ?? null,
        current_username: currentUsername ?? existing?.current_username ?? null,
        bot_member_status: botRole,
        bot_can_post: botCanPost,
        verification_state: verificationState,
        consecutive_failure_count: verificationState === "healthy" ? 0 : Number(existing?.consecutive_failure_count || 0) + 1,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("UPDATE channel_telegram_identities SET migrated_from_chat_id")) {
      const [migratedFrom, _migCheck, conflictChatId, conflictChannelId, conflictReason, channelId] = params;
      const existing = identities.get(Number(channelId));
      if (existing) {
        if (migratedFrom) {
          existing.migrated_from_chat_id = migratedFrom;
          existing.last_migrated_at = new Date();
        }
        existing.identity_conflict_chat_id = conflictChatId;
        existing.identity_conflict_channel_id = conflictChannelId;
        existing.identity_conflict_reason = conflictReason;
      }
      return [{ affectedRows: existing ? 1 : 0 }];
    }

    if (normalizedSql.startsWith("INSERT INTO channel_identity_reconciliations")) {
      reconciliations.push({ params });
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("UPDATE channels SET status = 'active'") && normalizedSql.includes("COALESCE(paused_reason, '') NOT LIKE 'Paused by admin%'")) {
      const [channelId] = params;
      const ch = channels.get(Number(channelId));
      if (!ch || ch.is_deleted || ["rejected", "deleted", "pending"].includes(ch.status)) return [{ affectedRows: 0 }];
      if (String(ch.paused_reason || "").startsWith("Paused by admin")) return [{ affectedRows: 0 }];
      ch.status = "active";
      ch.paused_reason = null;
      ch.suggested_fix = null;
      ch.failure_reason = null;
      ch.health_status = "healthy";
      ch.telegram_access_state = "healthy";
      ch.telegram_access_version += 1;
      ch.reactivated_at = new Date();
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("UPDATE channels SET status=?,paused_reason=?,suggested_fix=?")) {
      const [nextStatus, pausedReason, suggestedFix, channelId] = params;
      const ch = channels.get(Number(channelId));
      if (!ch || ch.is_deleted || ch.status !== "active") return [{ affectedRows: 0 }];
      ch.status = nextStatus;
      ch.paused_reason = pausedReason;
      ch.suggested_fix = suggestedFix;
      ch.notification_state_version = Number(ch.notification_state_version || 0) + 1;
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("SELECT notification_state_version FROM channels WHERE id=?")) {
      const ch = channels.get(Number(params[0]));
      return [[{ notification_state_version: ch ? ch.notification_state_version : 1 }]];
    }

    if (normalizedSql.startsWith("SELECT ")) {
      return [[]];
    }

    return [{ affectedRows: 0 }];
  };

  return { channels, identities, reconciliations, notifications, systemLogs, adminAudits, pool: { query } };
}

function loadBatch3Modules(harness, telegramHandler = async () => ({ status: 200, body: { ok: true } }), trackingStatus = { status: "active" }) {
  const customFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    const res = await telegramHandler(method, payload);
    const status = res.status ?? (res.body?.ok ? 200 : 400);
    return {
      status,
      json: async () => res.body ?? res,
    };
  };

  const mockProcess = {
    ...process,
    env: { ...process.env, BOT_TOKEN: "test-bot-token" },
  };

  const eligibilityMod = loadTsModule("src/lib/channelEligibility.ts", {}, { process: mockProcess });
  const refreshPolicyMod = loadTsModule("src/lib/channelRefreshPolicy.ts", {}, { process: mockProcess });
  const publicApprovalMod = loadTsModule(
    "src/lib/publicChannelApproval.ts",
    { "@/lib/db": { __esModule: true, default: harness.pool } },
    { process: mockProcess },
  );
  const accessMod = loadTsModule(
    "src/lib/telegramChannelAccess.ts",
    {
      "@/lib/db": { __esModule: true, default: harness.pool },
      "@/lib/systemLogs": {
        createSystemLog: async (entry) => harness.systemLogs.push(entry),
        maskEntityId: (_type, id) => `masked_${id}`,
      },
      "@/lib/platformNotifications": {
        enqueueAssetNotification: async (_db, payload) => harness.notifications.push(payload),
      },
    },
    { fetch: customFetch, process: mockProcess },
  );
  const identityMod = loadTsModule(
    "src/lib/channelTelegramIdentity.ts",
    {
      "@/lib/db": { __esModule: true, default: harness.pool },
      "@/lib/telegramChannelAccess": accessMod,
    },
    { fetch: customFetch, process: mockProcess },
  );
  const lifecycleMod = loadTsModule(
    "src/lib/channelLifecycle.ts",
    {
      "@/lib/db": { __esModule: true, default: harness.pool },
      "@/lib/postingTimes": { POSTING_TIME_OPTIONS: ["09:00", "15:00", "21:00"] },
      "@/lib/channelPrivacy": { getChannelPrivacySchema: async () => ({}) },
      "@/lib/privateChannelTrackingOnboarding": { onboardPrivateChannelTracking: async () => trackingStatus },
      "@/lib/publicChannelApproval": publicApprovalMod,
      "@/lib/telegramChannelAccess": accessMod,
    },
    { fetch: customFetch, process: mockProcess },
  );
  const missingIdRepairMod = loadTsModule(
    "src/lib/channelMissingIdRepair.ts",
    {
      "@/lib/db": { __esModule: true, default: harness.pool },
      "@/lib/telegramChannelAccess": accessMod,
      "@/lib/channelEligibility": eligibilityMod,
    },
    { fetch: customFetch, process: mockProcess },
  );

  return {
    eligibilityMod,
    refreshPolicyMod,
    publicApprovalMod,
    accessMod,
    identityMod,
    lifecycleMod,
    missingIdRepairMod,
  };
}

test("Scenario 1: Valid permanent numeric chat_id is stored on channel registration/verification", async () => {
  const harness = createBatch3Harness([{ id: 301, status: "pending", chat_id: "-100301999", username: "new_reg_chan" }]);
  const { identityMod, eligibilityMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100301999, username: "new_reg_chan", title: "New Reg", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  assert.equal(eligibilityMod.isValidPermanentTelegramChannelId("-100301999"), true);
  assert.equal(eligibilityMod.isValidPermanentTelegramChannelId("0"), false);
  assert.equal(eligibilityMod.isValidPermanentTelegramChannelId("@new_reg_chan"), false);

  const verified = await identityMod.verifyAndStoreChannelIdentity({
    channelId: 301,
    chatId: "-100301999",
    username: "new_reg_chan",
    source: "submission",
  });
  assert.equal(verified.chatId, "-100301999");
  assert.equal(harness.channels.get(301).chat_id, "-100301999");
  assert.equal(harness.identities.get(301).telegram_chat_id, "-100301999");
});

test("Scenario 2: Missing chat_id is safely resolved through verified Telegram lookup", async () => {
  const harness = createBatch3Harness([{ id: 302, status: "active", chat_id: null, username: "missing_id_chan" }]);
  const { missingIdRepairMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100302888, username: "missing_id_chan", title: "Resolved Chan", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  const summary = await missingIdRepairMod.runMissingChannelIdentityRepairBatch({
    dryRun: false,
    authorizeApply: true,
    limit: 10,
  });
  assert.equal(summary.repairedCount, 1);
  assert.equal(harness.channels.get(302).chat_id, "-100302888");
  assert.equal(harness.identities.get(302).telegram_chat_id, "-100302888");
});

test("Scenario 3: Duplicate chat_id conflict is blocked and does not overwrite or merge channels silently", async () => {
  const harness = createBatch3Harness([
    { id: 303, user_id: 10, status: "active", chat_id: "-100303777", username: "original_owner_chan" },
    { id: 304, user_id: 20, status: "pending", chat_id: null, username: "duplicate_claim_chan" },
  ]);
  const { accessMod, missingIdRepairMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100303777, username: "duplicate_claim_chan", title: "Dup", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  const verifyRes = await accessMod.verifyTelegramChannelAccess({
    channelId: 304,
    chatId: null,
    username: "duplicate_claim_chan",
    source: "moderation",
    persist: true,
    autoPauseActive: false,
  });
  assert.equal(verifyRes.state, "identity_mismatch");
  assert.equal(verifyRes.reasonCode, "identity_conflict");
  assert.equal(harness.channels.get(304).chat_id, null, "Must not overwrite missing chat_id with colliding chat_id");

  const repairSummary = await missingIdRepairMod.runMissingChannelIdentityRepairBatch({ dryRun: true });
  assert.equal(repairSummary.conflictCount, 1);
  assert.equal(repairSummary.items[0].conflictChannelId, 303);
});

test("Scenario 4: Stored numeric ID disagrees with current username resolution -> numeric ID wins or channel is flagged for review, never silently overwritten", async () => {
  const harness = createBatch3Harness([
    { id: 305, status: "active", chat_id: "-100305111", username: "reassigned_handle" },
  ]);
  const { accessMod } = loadBatch3Modules(harness, async (method, payload) => {
    if (method === "getChat" && payload.chat_id === "-100305111") {
      return { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: chat not found" } };
    }
    if (method === "getChat" && payload.chat_id === "@reassigned_handle") {
      return { status: 200, body: { ok: true, result: { id: -100999999, username: "reassigned_handle", title: "Different Channel", type: "channel" } } };
    }
    return { status: 400, body: { ok: false } };
  });

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 305,
    chatId: "-100305111",
    username: "reassigned_handle",
    source: "identity_reconciliation",
    persist: true,
    autoPauseActive: true,
  });

  assert.equal(res.state, "identity_mismatch");
  assert.equal(res.reasonCode, "username_points_to_different_chat");
  assert.equal(harness.channels.get(305).chat_id, "-100305111", "Stored numeric chat_id must never be overwritten by a different chat_id");
  assert.equal(harness.channels.get(305).status, "active", "Identity reconciliation mismatch must not mark channel bot_removed");
});

test("Scenario 5: Channel username change updates username history while preserving numeric chat_id", async () => {
  const harness = createBatch3Harness(
    [{ id: 306, status: "active", chat_id: "-100306222", username: "old_handle" }],
    [{ channel_id: 306, telegram_chat_id: "-100306222", current_username: "old_handle" }],
  );
  const { accessMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100306222, username: "new_renamed_handle", title: "Renamed Chan", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 306,
    chatId: "-100306222",
    username: "old_handle",
    source: "periodic_health",
    persist: true,
  });

  assert.equal(res.ok, true);
  assert.equal(harness.channels.get(306).chat_id, "-100306222");
  assert.equal(harness.channels.get(306).username, "new_renamed_handle");
  assert.equal(harness.identities.get(306).current_username, "new_renamed_handle");
  assert.equal(harness.identities.get(306).previous_username, "old_handle");
  assert.ok(harness.identities.get(306).last_username_changed_at instanceof Date);
});

test("Scenario 6: Telegram channel-to-supergroup migration migrate_to_chat_id updates identity safely", async () => {
  const harness = createBatch3Harness(
    [{ id: 307, status: "active", chat_id: "-100307111", username: "migrating_chan" }],
    [{ channel_id: 307, telegram_chat_id: "-100307111", current_username: "migrating_chan" }],
  );
  const { accessMod } = loadBatch3Modules(harness, async (method, payload) => {
    if (method === "getChat" && payload.chat_id === "-100307111") {
      return {
        status: 400,
        body: {
          ok: false,
          error_code: 400,
          description: "Bad Request: group chat was upgraded to a supergroup chat",
          parameters: { migrate_to_chat_id: -100307999 },
        },
      };
    }
    if (method === "getChat" && String(payload.chat_id) === "-100307999") {
      return { status: 200, body: { ok: true, result: { id: -100307999, username: "migrating_chan", title: "Migrated Supergroup", type: "supergroup" } } };
    }
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 307,
    chatId: "-100307111",
    username: "migrating_chan",
    source: "periodic_health",
    persist: true,
  });

  assert.equal(res.ok, true);
  assert.equal(res.telegramChatId, "-100307999");
  assert.equal(res.migratedFromChatId, "-100307111");
  assert.equal(harness.channels.get(307).chat_id, "-100307999");
  assert.equal(harness.identities.get(307).migrated_from_chat_id, "-100307111");
});

test("Scenario 7: Admin approval succeeds only when bot admin + posting permissions are confirmed", async () => {
  const harness = createBatch3Harness([{ id: 308, status: "pending", chat_id: "-100308", username: "approvable_chan" }]);
  const { publicApprovalMod, identityMod, eligibilityMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100308, username: "approvable_chan", title: "Approvable", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  const storedEligibility = await publicApprovalMod.getPublicChannelApprovalEligibility(308);
  assert.equal(storedEligibility.eligible, true);
  const liveIdentity = await identityMod.verifyAndStoreChannelIdentity({
    channelId: 308,
    chatId: "-100308",
    username: "approvable_chan",
    source: "admin_activate",
  });
  assert.equal(liveIdentity.canPost, true);

  const unified = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(308),
    context: "admin_approval",
    live_verification_confirmed: true,
  });
  assert.equal(unified.eligible, true);
});

test("Scenario 8: Admin approval is blocked when bot is not admin", async () => {
  const harness = createBatch3Harness([{ id: 309, status: "pending", chat_id: "-100309", username: "not_admin_chan" }]);
  const { identityMod, publicApprovalMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100309, username: "not_admin_chan", title: "No Admin", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "left" } } };
    return { status: 400, body: { ok: false } };
  });

  await assert.rejects(
    () => identityMod.verifyAndStoreChannelIdentity({ channelId: 309, chatId: "-100309", username: "not_admin_chan", source: "admin_activate" }),
    (err) => err.code === "inaccessible_channel",
  );
  const afterEligibility = await publicApprovalMod.getPublicChannelApprovalEligibility(309);
  assert.equal(afterEligibility.eligible, false);
});

test("Scenario 9: Admin approval is blocked when can_post_messages is false", async () => {
  const harness = createBatch3Harness([{ id: 310, status: "pending", chat_id: "-100310", username: "no_post_perm_chan" }]);
  const { identityMod, publicApprovalMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100310, username: "no_post_perm_chan", title: "No Post", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: false } } };
    return { status: 400, body: { ok: false } };
  });

  await assert.rejects(
    () => identityMod.verifyAndStoreChannelIdentity({ channelId: 310, chatId: "-100310", username: "no_post_perm_chan", source: "admin_activate" }),
    (err) => err.code === "missing_permission",
  );
  const afterEligibility = await publicApprovalMod.getPublicChannelApprovalEligibility(310);
  assert.equal(afterEligibility.eligible, false);
});

test("Scenario 10: Admin approval during Telegram 429 or temporary error does not activate or reject the channel", async () => {
  const harness = createBatch3Harness([{ id: 311, status: "pending", chat_id: "-100311", username: "rate_limited_pending" }]);
  const { identityMod } = loadBatch3Modules(harness, async () => ({
    status: 429,
    body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 45", parameters: { retry_after: 45 } },
  }));

  await assert.rejects(
    () => identityMod.verifyAndStoreChannelIdentity({ channelId: 311, chatId: "-100311", username: "rate_limited_pending", source: "admin_activate" }),
    (err) => err.code === "temporarily_rate_limited" && err.retryAfterSeconds === 45,
  );
  assert.equal(harness.channels.get(311).status, "pending", "Pending channel must remain pending on temporary 429");
});

test("Scenario 11: Private channel approval requires valid private channel access/tracking requirements", async () => {
  const harness = createBatch3Harness([{ id: 312, status: "pending", channel_type: "private", chat_id: "-100312", username: null }]);
  const { eligibilityMod } = loadBatch3Modules(harness);

  const withoutTracking = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(312),
    context: "admin_approval",
    live_verification_confirmed: true,
    tracking_account_status: "pending_manual",
    tracking_account_member_status: "not_member",
  });
  assert.equal(withoutTracking.eligible, false);
  assert.equal(withoutTracking.code, "PRIVATE_TRACKING_NOT_VERIFIED");

  const withTracking = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(312),
    context: "admin_approval",
    live_verification_confirmed: true,
    tracking_account_status: "active",
    tracking_account_member_status: "member",
  });
  assert.equal(withTracking.eligible, true);
});

test("Scenario 12: Bulk approval enforces individual verification requirements", () => {
  const bulkSource = readSource("src/app/api/admin/channels/bulk-approve/route.ts");
  assert.match(bulkSource, /requires_live_verification/);
  assert.match(bulkSource, /getPublicChannelApprovalEligibility/);
  assert.match(bulkSource, /verifyAndStoreChannelIdentity/);
  assert.match(bulkSource, /channel\.channel_type !== "public" \|\| Boolean\(channel\.requires_live_verification\)/);
});

test("Scenario 13: Publisher pause remains paused across health checks, subscriber refresh, and recovery jobs", async () => {
  const harness = createBatch3Harness([
    { id: 313, status: "paused", paused_by_actor: "publisher", paused_reason: "Paused by publisher.", chat_id: "-100313" },
  ]);
  const { accessMod, refreshPolicyMod, eligibilityMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100313, username: "channel_313", title: "Paused", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  await accessMod.verifyTelegramChannelAccess({ channelId: 313, chatId: "-100313", source: "periodic_health", persist: true, autoPauseActive: true });
  assert.equal(harness.channels.get(313).status, "paused");
  assert.equal(refreshPolicyMod.canAutoRestore(harness.channels.get(313)), false);
  const recoveryCheck = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(313),
    context: "automatic_recovery",
    live_verification_confirmed: true,
  });
  assert.equal(recoveryCheck.eligible, false);
  assert.equal(recoveryCheck.code, "PUBLISHER_PAUSED");
});

test("Scenario 14: Publisher resume succeeds only when no admin/policy/subscriber/technical block exists and Telegram access is verified", async () => {
  const harness = createBatch3Harness([
    { id: 314, status: "paused", paused_by_actor: "publisher", paused_reason: "Paused by publisher.", chat_id: "-100314", username: "resumable_chan" },
  ]);
  const { lifecycleMod, eligibilityMod } = loadBatch3Modules(harness, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100314, username: "resumable_chan", title: "Resumable", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChatMember") return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    return { status: 400, body: { ok: false } };
  });

  const preGate = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(314),
    context: "publisher_resume",
    live_verification_confirmed: true,
  });
  assert.equal(preGate.eligible, true);

  await lifecycleMod.reactivateChannelAfterHealthCheck(314, "-100314");
  assert.equal(harness.channels.get(314).status, "active");
  assert.equal(harness.channels.get(314).paused_reason, null);
});

test("Scenario 15: Publisher resume cannot override an admin pause", async () => {
  const harness = createBatch3Harness([
    { id: 315, status: "paused", paused_by_actor: "admin", paused_reason: "Paused by admin control center", chat_id: "-100315", username: "admin_paused_chan" },
  ]);
  const { lifecycleMod, eligibilityMod } = loadBatch3Modules(harness);

  const preGate = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(315),
    context: "publisher_resume",
    live_verification_confirmed: true,
  });
  assert.equal(preGate.eligible, false);
  assert.equal(preGate.code, "ADMIN_PAUSED");

  await assert.rejects(
    () => lifecycleMod.reactivateChannelAfterHealthCheck(315, "-100315"),
    /paused by an administrator/i,
  );
  assert.equal(harness.channels.get(315).status, "paused");
});

test("Scenario 16: Admin pause cannot be overridden by automatic recovery or subscriber refresh", () => {
  const harness = createBatch3Harness([
    {
      id: 316,
      status: "paused",
      paused_by_actor: "admin",
      paused_reason: "Paused by admin control center",
      monetization_paused_reason: "below_minimum",
      chat_id: "-100316",
    },
  ]);
  const { eligibilityMod, refreshPolicyMod } = loadBatch3Modules(harness);

  assert.equal(refreshPolicyMod.canAutoRestore(harness.channels.get(316)), false);
  const autoRec = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(316),
    context: "automatic_recovery",
    live_verification_confirmed: true,
  });
  assert.equal(autoRec.eligible, false);
  assert.equal(autoRec.code, "ADMIN_PAUSED");
});

test("Scenario 17: Rejected channel cannot be activated by recovery, subscriber refresh, or publisher resume", async () => {
  const harness = createBatch3Harness([
    { id: 317, status: "rejected", marketplace_admin_status: "rejected", paused_reason: "Policy rejection", chat_id: "-100317" },
  ]);
  const { eligibilityMod, refreshPolicyMod, lifecycleMod } = loadBatch3Modules(harness);

  assert.equal(refreshPolicyMod.canAutoRestore(harness.channels.get(317)), false);
  for (const context of ["automatic_recovery", "subscriber_refresh_restore", "publisher_resume"]) {
    const res = eligibilityMod.evaluateUnifiedChannelEligibility({
      ...harness.channels.get(317),
      context,
      live_verification_confirmed: true,
    });
    assert.equal(res.eligible, false);
    assert.equal(res.code, "CHANNEL_REJECTED");
  }
  await assert.rejects(() => lifecycleMod.reactivateChannelAfterHealthCheck(317, "-100317"), /Rejected channels/i);
});

test("Scenario 18: Deleted channel cannot be reactivated by any automated process", async () => {
  const harness = createBatch3Harness([
    { id: 318, status: "deleted", is_deleted: 1, chat_id: "-100318" },
  ]);
  const { eligibilityMod, refreshPolicyMod, lifecycleMod } = loadBatch3Modules(harness);

  assert.equal(refreshPolicyMod.canAutoRestore(harness.channels.get(318)), false);
  for (const context of ["ad_delivery", "admin_approval", "admin_resume", "publisher_resume", "automatic_recovery", "subscriber_refresh_restore"]) {
    const res = eligibilityMod.evaluateUnifiedChannelEligibility({
      ...harness.channels.get(318),
      context,
      live_verification_confirmed: true,
    });
    assert.equal(res.eligible, false);
    assert.equal(res.code, "CHANNEL_DELETED");
  }
  await assert.rejects(() => lifecycleMod.reactivateChannelAfterHealthCheck(318, "-100318"), /Deleted channels/i);
});

test("Scenario 19: Pending channel cannot become active without approval and verified Telegram access", async () => {
  const harness = createBatch3Harness([
    { id: 319, status: "pending", marketplace_admin_status: "pending", chat_id: "-100319" },
  ]);
  const { eligibilityMod, lifecycleMod } = loadBatch3Modules(harness);

  const deliveryGate = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(319),
    context: "ad_delivery",
  });
  assert.equal(deliveryGate.eligible, false);
  assert.equal(deliveryGate.code, "MARKETPLACE_APPROVAL_REQUIRED");

  const approvalWithoutTelegram = eligibilityMod.evaluateUnifiedChannelEligibility({
    ...harness.channels.get(319),
    telegram_access_state: "unchecked",
    context: "admin_approval",
    live_verification_confirmed: false,
  });
  assert.equal(approvalWithoutTelegram.eligible, false);
  assert.equal(approvalWithoutTelegram.code, "BOT_VERIFICATION_REQUIRED");

  await assert.rejects(() => lifecycleMod.reactivateChannelAfterHealthCheck(319, "-100319"), /Pending channels/i);
});

test("Scenario 20: Below-minimum-subscriber channel recovers only when subscriber count is restored AND no other restriction exists", () => {
  const harness = createBatch3Harness([
    {
      id: 320,
      status: "paused",
      monetization_paused_reason: "below_minimum",
      paused_reason: null,
      chat_id: "-100320",
    },
  ]);
  const { refreshPolicyMod } = loadBatch3Modules(harness);

  assert.equal(refreshPolicyMod.canAutoRestore(harness.channels.get(320)), true);
  assert.equal(
    refreshPolicyMod.canAutoRestore({ ...harness.channels.get(320), paused_by_actor: "admin" }),
    false,
  );
  assert.equal(
    refreshPolicyMod.canAutoRestore({ ...harness.channels.get(320), paused_by_actor: "publisher" }),
    false,
  );
  assert.equal(
    refreshPolicyMod.canAutoRestore({ ...harness.channels.get(320), telegram_access_state: "bot_removed" }),
    false,
  );
  assert.equal(
    refreshPolicyMod.canAutoRestore({ ...harness.channels.get(320), chat_id: null }),
    false,
  );
});

test("Scenario 21: Fraud/moderation/settlement hold prevents activation and automatic recovery", async () => {
  const futureDate = new Date(Date.now() + 3600_000).toISOString();
  const harness = createBatch3Harness([
    { id: 321, status: "paused", settlement_excluded_until: futureDate, chat_id: "-100321" },
    { id: 322, status: "paused", automation_suspension_status: "temporary", chat_id: "-100322" },
    { id: 323, status: "paused", paused_reason: "fraudulent_or_low_quality_traffic", chat_id: "-100323" },
  ]);
  const { eligibilityMod, lifecycleMod } = loadBatch3Modules(harness);

  assert.equal(
    eligibilityMod.evaluateUnifiedChannelEligibility({ ...harness.channels.get(321), context: "automatic_recovery", live_verification_confirmed: true }).code,
    "SETTLEMENT_HOLD_ACTIVE",
  );
  assert.equal(
    eligibilityMod.evaluateUnifiedChannelEligibility({ ...harness.channels.get(322), context: "admin_resume", live_verification_confirmed: true }).code,
    "AUTOMATION_SUSPENDED",
  );
  assert.equal(
    eligibilityMod.evaluateUnifiedChannelEligibility({ ...harness.channels.get(323), context: "publisher_resume", live_verification_confirmed: true }).code,
    "POLICY_OR_FRAUD_PAUSE",
  );
  await assert.rejects(() => lifecycleMod.reactivateChannelAfterHealthCheck(321, "-100321"), /settlement hold/i);
});

test("Scenario 22: Concurrent health check cannot overwrite a newer publisher or admin pause", async () => {
  const harness = createBatch3Harness([
    { id: 324, status: "paused", paused_reason: "Paused by admin control center", telegram_access_version: 9, chat_id: "-100324" },
  ]);
  const { accessMod } = loadBatch3Modules(harness);

  const staleResult = await accessMod.persistTelegramChannelAccess(
    {
      channelId: 324,
      source: "periodic_health",
      autoPauseActive: true,
      expectedVersion: 8,
    },
    {
      ok: true,
      state: "healthy",
      reason: null,
      reasonCode: null,
      checkedAt: new Date(),
      telegramChatId: "-100324",
      username: "chan_324",
      title: "Chan 324",
      channelType: "public",
      botRole: "administrator",
      canPostMessages: true,
      permanent: false,
      retryable: false,
      retryAfterSeconds: null,
    },
  );
  assert.equal(staleResult.skippedStale, true);
  assert.equal(harness.channels.get(324).status, "paused");
  assert.equal(harness.channels.get(324).paused_reason, "Paused by admin control center");
});

test("Scenario 23: Repeated checks do not emit duplicate publisher or admin notifications", async () => {
  const harness = createBatch3Harness([{ id: 325, status: "active", chat_id: "-100325" }]);
  const { accessMod } = loadBatch3Modules(harness, async () => ({
    status: 403,
    body: { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the channel chat" },
  }));

  await accessMod.verifyTelegramChannelAccess({ channelId: 325, chatId: "-100325", source: "periodic_health", persist: true, autoPauseActive: true });
  assert.equal(harness.notifications.length, 1);

  await accessMod.verifyTelegramChannelAccess({ channelId: 325, chatId: "-100325", source: "periodic_health", persist: true, autoPauseActive: true });
  await accessMod.verifyTelegramChannelAccess({ channelId: 325, chatId: "-100325", source: "periodic_health", persist: true, autoPauseActive: true });
  assert.equal(harness.notifications.length, 1);
});

test("Scenario 24: Missing-ID repair dry-run classifies the 41 missing-ID scenario types without mutating channel statuses", async () => {
  const harness = createBatch3Harness([
    { id: 401, user_id: 1, status: "active", chat_id: null, username: "resolvable_active_chan" },
    { id: 402, user_id: 1, status: "active", chat_id: "-100402999", username: "existing_valid_chan" },
    { id: 403, user_id: 2, status: "active", chat_id: "", username: "colliding_with_402" },
    { id: 404, user_id: 3, status: "active", chat_id: "0", username: "bot_not_admin_chan" },
    { id: 405, user_id: 4, status: "pending", chat_id: null, username: null, channel_type: "private" },
  ]);
  const { missingIdRepairMod } = loadBatch3Modules(harness, async (method, payload) => {
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 9001 } } };
    if (method === "getChat" && payload.chat_id === "@resolvable_active_chan") {
      return { status: 200, body: { ok: true, result: { id: -100401111, username: "resolvable_active_chan", title: "Resolvable", type: "channel" } } };
    }
    if (method === "getChat" && payload.chat_id === "@colliding_with_402") {
      return { status: 200, body: { ok: true, result: { id: -100402999, username: "colliding_with_402", title: "Collide", type: "channel" } } };
    }
    if (method === "getChat" && payload.chat_id === "@bot_not_admin_chan") {
      return { status: 200, body: { ok: true, result: { id: -100404111, username: "bot_not_admin_chan", title: "NoBot", type: "channel" } } };
    }
    if (method === "getChatMember") {
      if (String(payload.chat_id) === "-100404111") {
        return { status: 200, body: { ok: true, result: { status: "left" } } };
      }
      return { status: 200, body: { ok: true, result: { status: "administrator", can_post_messages: true } } };
    }
    return { status: 400, body: { ok: false } };
  });

  const cliArgs = parseMissingIdRepairCliArgs(["--dry-run", "--limit=25"]);
  assert.equal(cliArgs.dryRun, true);
  assert.equal(cliArgs.limit, 25);

  const summary = await missingIdRepairMod.runMissingChannelIdentityRepairBatch({
    dryRun: true,
    limit: 25,
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.scannedCount, 4);
  assert.equal(summary.activeMissingIdCount, 3);
  assert.equal(summary.wouldRepairCount, 1);
  assert.equal(summary.repairedCount, 0);
  assert.equal(summary.conflictCount, 1);
  assert.equal(summary.reviewRequiredCount, 2);

  // Verify no channel statuses or chat_ids were mutated during dry-run
  assert.equal(harness.channels.get(401).chat_id, null);
  assert.equal(harness.channels.get(401).status, "active");
  assert.equal(harness.channels.get(403).chat_id, "");
  assert.equal(harness.channels.get(403).status, "active");
  assert.equal(harness.channels.get(404).chat_id, "0");
  assert.equal(harness.channels.get(404).status, "active");
  assert.equal(harness.channels.get(405).chat_id, null);
  assert.equal(harness.channels.get(405).status, "pending");
});

test("Scenario 25: Existing CPC/CPM accounting, balances, settlements, and historical placements remain untouched", () => {
  const filesToCheck = [
    "src/lib/channelEligibility.ts",
    "src/lib/channelMissingIdRepair.ts",
    "src/lib/telegramChannelAccess.ts",
    "src/lib/publicChannelApproval.ts",
    "src/lib/channelRefreshPolicy.ts",
    "src/lib/channelLifecycle.ts",
  ];
  for (const rel of filesToCheck) {
    const src = readSource(rel);
    assert.doesNotMatch(src, /DELETE FROM campaign_posts/i);
    assert.doesNotMatch(src, /UPDATE campaign_posts/i);
    assert.doesNotMatch(src, /UPDATE channel_advertiser_debits/i);
    assert.doesNotMatch(src, /UPDATE transactions/i);
    assert.doesNotMatch(src, /UPDATE withdrawals/i);
    assert.doesNotMatch(src, /earning_balance|ad_balance/i);
  }
});
