import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  classifyRejectionHistory,
  classifyTelegramFailure,
  nextFailureState,
  recoveryDecision,
  retryDelayMs,
  technicalStatusForHealth,
} from "../scripts/channel-recovery-policy.mjs";

const ROOT = process.cwd();

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Compiles and evaluates a TypeScript module from src/lib with injected dependency mocks
 * and optional global fetch override.
 */
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

function createMockDb(initialChannels = [], initialIdentities = []) {
  const channels = new Map();
  const identities = new Map();
  const notifications = [];
  const systemLogs = [];

  for (const ch of initialChannels) {
    channels.set(Number(ch.id), {
      id: Number(ch.id),
      user_id: Number(ch.user_id ?? 101),
      title: ch.title ?? `Channel #${ch.id}`,
      chat_id: ch.chat_id ?? `-100${ch.id}`,
      username: ch.username ?? `channel_${ch.id}`,
      channel_type: ch.channel_type ?? "public",
      status: ch.status ?? "active",
      is_deleted: ch.is_deleted ? 1 : 0,
      health_status: ch.health_status ?? "healthy",
      health_failure_reason: ch.health_failure_reason ?? null,
      failure_reason: ch.failure_reason ?? null,
      paused_reason: ch.paused_reason ?? null,
      suggested_fix: ch.suggested_fix ?? null,
      telegram_access_state: ch.telegram_access_state ?? "healthy",
      telegram_access_version: Number(ch.telegram_access_version ?? 1),
      notification_state_version: Number(ch.notification_state_version ?? 0),
      health_checked_at: ch.health_checked_at ?? null,
      reactivated_at: ch.reactivated_at ?? null,
      auto_paused_at: ch.auto_paused_at ?? null,
    });
  }

  for (const idRow of initialIdentities) {
    identities.set(Number(idRow.channel_id), {
      channel_id: Number(idRow.channel_id),
      telegram_chat_id: String(idRow.telegram_chat_id ?? `-100${idRow.channel_id}`),
      channel_type: idRow.channel_type ?? "public",
      current_username: idRow.current_username ?? null,
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

    if (normalizedSql.startsWith("SELECT id,user_id,status,title,chat_id,username,channel_type,telegram_access_state,telegram_access_version")) {
      const ch = channels.get(Number(params[0]));
      if (!ch || ch.is_deleted) return [[]];
      return [[{ ...ch }]];
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

    if (normalizedSql.startsWith("INSERT INTO channel_telegram_identities")) {
      const [
        channelId,
        identityChatId,
        channelType,
        currentUsername,
        botRole,
        botCanPost,
        verificationState,
        _s1,
        _s2,
        _s3,
        _s4,
        _s5,
        nextRetryAt,
        lastFailureCode,
        lastFailureReason,
        lastCheckSource,
      ] = params;
      const existing = identities.get(Number(channelId));
      const isHealthy = verificationState === "healthy";
      identities.set(Number(channelId), {
        channel_id: Number(channelId),
        telegram_chat_id: identityChatId,
        channel_type: channelType,
        current_username: currentUsername ?? existing?.current_username ?? null,
        bot_member_status: botRole,
        bot_can_post: botCanPost,
        verification_state: verificationState,
        consecutive_failure_count: isHealthy ? 0 : Number(existing?.consecutive_failure_count || 0) + 1,
        next_retry_at: nextRetryAt,
        last_failure_code: lastFailureCode,
        last_failure_reason: lastFailureReason,
        last_check_source: lastCheckSource,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("UPDATE channels SET status=?,paused_reason=?,suggested_fix=?")) {
      const [nextStatus, pausedReason, suggestedFix, channelId] = params;
      const ch = channels.get(Number(channelId));
      if (!ch || ch.is_deleted || ch.status !== "active") return [{ affectedRows: 0 }];
      ch.status = nextStatus;
      ch.paused_reason = pausedReason;
      ch.suggested_fix = suggestedFix;
      ch.auto_paused_at = new Date();
      ch.notification_state_version = Number(ch.notification_state_version || 0) + 1;
      return [{ affectedRows: 1 }];
    }

    if (normalizedSql.startsWith("SELECT notification_state_version FROM channels WHERE id=?")) {
      const ch = channels.get(Number(params[0]));
      return [[{ notification_state_version: ch ? ch.notification_state_version : 1 }]];
    }

    if (normalizedSql.startsWith("UPDATE channels SET last_successful_post_at = NOW()")) {
      const ch = channels.get(Number(params[0]));
      if (ch) {
        ch.failure_reason = null;
        ch.telegram_access_state = "healthy";
        ch.health_status = "healthy";
      }
      return [{ affectedRows: ch ? 1 : 0 }];
    }

    if (normalizedSql.startsWith("UPDATE channel_telegram_identities SET verification_state = 'healthy'")) {
      const ti = identities.get(Number(params[0]));
      if (ti) {
        ti.verification_state = "healthy";
        ti.consecutive_failure_count = 0;
        ti.next_retry_at = null;
        ti.last_failure_code = null;
        ti.last_failure_reason = null;
      }
      return [{ affectedRows: ti ? 1 : 0 }];
    }

    return [{ affectedRows: 0 }];
  };

  return { channels, identities, notifications, systemLogs, pool: { query } };
}

function createServices(mockDb, telegramHandler = async () => ({ status: 200, body: { ok: true } })) {
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

  const accessMod = loadTsModule(
    "src/lib/telegramChannelAccess.ts",
    {
      "@/lib/db": { __esModule: true, default: mockDb.pool },
      "@/lib/systemLogs": {
        createSystemLog: async (entry) => mockDb.systemLogs.push(entry),
        maskEntityId: (_type, id) => `masked_${id}`,
      },
      "@/lib/platformNotifications": {
        enqueueAssetNotification: async (_db, payload) => mockDb.notifications.push(payload),
      },
    },
    { fetch: customFetch, process: mockProcess },
  );

  const lifecycleMod = loadTsModule(
    "src/lib/channelLifecycle.ts",
    {
      "@/lib/db": { __esModule: true, default: mockDb.pool },
      "@/lib/postingTimes": { POSTING_TIME_OPTIONS: ["09:00", "15:00", "21:00"] },
      "@/lib/channelPrivacy": { getChannelPrivacySchema: async () => ({}) },
      "@/lib/privateChannelTrackingOnboarding": { onboardPrivateChannelTracking: async () => ({ status: "active" }) },
      "@/lib/publicChannelApproval": { getPublicChannelApprovalEligibility: async () => ({ eligible: true }) },
      "@/lib/telegramChannelAccess": accessMod,
    },
    { fetch: customFetch, process: mockProcess },
  );

  const cleanupMod = loadTsModule(
    "src/lib/telegramCleanupPolicy.ts",
    {
      "@/lib/telegramChannelAccess": accessMod,
    },
    { fetch: customFetch, process: mockProcess },
  );

  return { accessMod, lifecycleMod, cleanupMod };
}

test("Scenario 1: One 'chat not found' response does not permanently deactivate an active channel", async () => {
  const mockDb = createMockDb([{ id: 101, status: "active", chat_id: "-100101", username: "legit_channel" }]);
  const { accessMod, lifecycleMod, cleanupMod } = createServices(mockDb, async () => ({
    status: 400,
    body: { ok: false, error_code: 400, description: "Bad Request: chat not found" },
  }));

  const classified = accessMod.classifyTelegramAccessFailure({
    description: "Bad Request: chat not found",
    httpStatus: 400,
    errorCode: 400,
  });
  assert.equal(classified.state, "channel_not_found");
  assert.equal(classified.reasonCode, "chat_not_found_unconfirmed");
  assert.equal(classified.permanent, false);
  assert.equal(classified.retryable, true);

  assert.equal(lifecycleMod.classifyTelegramSendFailure("Bad Request: chat not found"), null);

  const cleanupClass = cleanupMod.classifyTelegramCleanupResult({
    ok: false,
    description: "Bad Request: chat not found",
    httpStatus: 400,
  });
  assert.equal(cleanupClass.category, "TEMPORARY");

  const result = await accessMod.verifyTelegramChannelAccess({
    channelId: 101,
    chatId: "-100101",
    username: "legit_channel",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.permanent, false);

  const channelAfter = mockDb.channels.get(101);
  assert.equal(channelAfter.status, "active", "Active channel must remain active after one ambiguous chat not found");
  assert.equal(channelAfter.telegram_access_state, "temporarily_unavailable");
  assert.equal(mockDb.notifications.length, 0);
});

test("Scenario 2: 'Bad Request: member list is inaccessible' does not automatically mean bot removed", async () => {
  const mockDb = createMockDb([{ id: 102, status: "active", chat_id: "-100102", username: "member_list_chan" }]);
  const { accessMod, lifecycleMod } = createServices(mockDb, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100102, title: "Member List Chan", username: "member_list_chan" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 999001 } } };
    if (method === "getChatMember") {
      return { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: member list is inaccessible" } };
    }
    return { status: 400, body: { ok: false } };
  });

  const classified = accessMod.classifyTelegramAccessFailure({
    description: "Bad Request: member list is inaccessible",
    httpStatus: 400,
  });
  assert.equal(classified.state, "temporarily_unavailable");
  assert.equal(classified.reasonCode, "member_list_inaccessible");
  assert.equal(classified.permanent, false);
  assert.equal(classified.retryable, true);

  assert.equal(lifecycleMod.classifyTelegramSendFailure("Bad Request: member list is inaccessible"), null);

  const recoveryClass = classifyTelegramFailure({
    description: "Bad Request: member list is inaccessible",
  });
  assert.equal(recoveryClass.code, "member_list_inaccessible");
  assert.equal(recoveryClass.permanent, false);
  assert.equal(technicalStatusForHealth(recoveryClass.code), null);

  const verifyRes = await accessMod.verifyTelegramChannelAccess({
    channelId: 102,
    chatId: "-100102",
    username: "member_list_chan",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(verifyRes.permanent, false);
  assert.equal(mockDb.channels.get(102).status, "active");
});

test("Scenario 3: Telegram 429 never causes permanent removal", async () => {
  const mockDb = createMockDb([{ id: 103, status: "active", chat_id: "-100103" }]);
  const { accessMod, lifecycleMod } = createServices(mockDb, async () => ({
    status: 429,
    body: {
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 42",
      parameters: { retry_after: 42 },
    },
  }));

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 103,
    chatId: "-100103",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });

  assert.equal(res.state, "temporarily_unavailable");
  assert.equal(res.reasonCode, "telegram_rate_limited");
  assert.equal(res.permanent, false);
  assert.equal(res.retryable, true);
  assert.equal(lifecycleMod.classifyTelegramSendFailure("Too Many Requests: retry after 42", { httpStatus: 429 }), null);
  assert.equal(mockDb.channels.get(103).status, "active");
  assert.equal(mockDb.notifications.length, 0);
});

test("Scenario 4: retry_after is respected in classification, persistence backoff, and health monitor rotation", async () => {
  const mockDb = createMockDb([{ id: 104, status: "active", chat_id: "-100104" }]);
  const { accessMod } = createServices(mockDb, async () => ({
    status: 429,
    body: {
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 120",
    },
  }));

  const beforeMs = Date.now();
  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 104,
    chatId: "-100104",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });

  assert.equal(res.retryAfterSeconds, 120);
  const identityRow = mockDb.identities.get(104);
  assert.ok(identityRow?.next_retry_at instanceof Date);
  const scheduledWaitSec = (identityRow.next_retry_at.getTime() - beforeMs) / 1000;
  assert.ok(scheduledWaitSec >= 120 && scheduledWaitSec <= 135, `Expected next_retry_at ~120s+jitter, got ${scheduledWaitSec}s`);
  assert.equal(retryDelayMs({ parameters: { retry_after: 15 } }, 1), 16_000);

  const monitorSource = readSource("src/lib/channelHealthMonitor.ts");
  assert.match(monitorSource, /ti\.next_retry_at IS NULL OR ti\.next_retry_at<=UTC_TIMESTAMP\(6\)/);
});

test("Scenario 5: Network timeout leaves the established channel status intact", async () => {
  const mockDb = createMockDb([{ id: 105, status: "active", chat_id: "-100105" }]);
  const { accessMod } = createServices(mockDb, async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  });

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 105,
    chatId: "-100105",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });

  assert.equal(res.state, "temporarily_unavailable");
  assert.equal(res.permanent, false);
  assert.equal(mockDb.channels.get(105).status, "active");
});

test("Scenario 6: Telegram 5xx errors and malformed/incomplete responses are treated as temporary", async () => {
  const mockDb = createMockDb([{ id: 106, status: "active", chat_id: "-100106" }]);
  const { accessMod } = createServices(mockDb, async () => ({
    status: 502,
    body: { ok: false, error_code: 502, description: "Bad Gateway" },
  }));

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 106,
    chatId: "-100106",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });

  assert.equal(res.state, "temporarily_unavailable");
  assert.equal(res.permanent, false);
  assert.equal(mockDb.channels.get(106).status, "active");

  const malformedMembership = accessMod.telegramAccessResultFromMembership({
    chatId: "-100106",
    status: "",
    canPostMessages: null,
  });
  assert.equal(malformedMembership.ok, false);
  assert.equal(malformedMembership.state, "temporarily_unavailable");
  assert.equal(malformedMembership.permanent, false);
});

test("Scenario 7: Confirmed bot 'left' or 'kicked' triggers the correct access-loss classification (bot_removed)", async () => {
  const mockDb = createMockDb([
    { id: 107, status: "active", chat_id: "-100107", title: "Kicked Chan" },
    { id: 108, status: "active", chat_id: "-100108", title: "Left Chan" },
  ]);
  const { accessMod } = createServices(mockDb, async (method, payload) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: payload.chat_id, title: "Test", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 999001 } } };
    if (method === "getChatMember") {
      return {
        status: 200,
        body: { ok: true, result: { status: String(payload.chat_id) === "-100107" ? "kicked" : "left" } },
      };
    }
    return { status: 400, body: { ok: false } };
  });

  const kickedRes = await accessMod.verifyTelegramChannelAccess({
    channelId: 107,
    chatId: "-100107",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(kickedRes.state, "bot_removed");
  assert.equal(kickedRes.permanent, true);
  assert.equal(mockDb.channels.get(107).status, "bot_removed");

  const leftRes = await accessMod.verifyTelegramChannelAccess({
    channelId: 108,
    chatId: "-100108",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(leftRes.state, "bot_removed");
  assert.equal(leftRes.permanent, true);
  assert.equal(mockDb.channels.get(108).status, "bot_removed");
});

test("Scenario 8: Confirmed missing posting permission triggers permission_missing", async () => {
  const mockDb = createMockDb([{ id: 109, status: "active", chat_id: "-100109", title: "No Post Right Chan" }]);
  const { accessMod } = createServices(mockDb, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100109, title: "No Post Right Chan", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 999001 } } };
    if (method === "getChatMember") {
      return {
        status: 200,
        body: { ok: true, result: { status: "administrator", can_post_messages: false } },
      };
    }
    return { status: 400, body: { ok: false } };
  });

  const res = await accessMod.verifyTelegramChannelAccess({
    channelId: 109,
    chatId: "-100109",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });

  assert.equal(res.state, "permission_missing");
  assert.equal(res.permanent, true);
  assert.equal(mockDb.channels.get(109).status, "permission_missing");
});

test("Scenario 9: Uncertain access prevents unsafe new delivery without falsely deactivating the channel", async () => {
  const mockDb = createMockDb([{ id: 110, status: "active", chat_id: "-100110", title: "Uncertain Access Chan" }]);
  const { accessMod } = createServices(mockDb, async () => ({
    status: 400,
    body: { ok: false, error_code: 400, description: "Bad Request: chat not found" },
  }));

  await accessMod.verifyTelegramChannelAccess({
    channelId: 110,
    chatId: "-100110",
    source: "process_ads",
    persist: true,
    autoPauseActive: true,
  });

  const ch = mockDb.channels.get(110);
  const ti = mockDb.identities.get(110);
  assert.equal(ch.status, "active", "Channel approval/status record remains active");
  assert.equal(ch.telegram_access_state, "temporarily_unavailable", "Access state is marked temporarily_unavailable");
  assert.ok(ti?.next_retry_at instanceof Date && ti.next_retry_at.getTime() > Date.now(), "Delivery retry backoff is scheduled");

  const processAdsSource = readSource("src/app/api/cron/process-ads/route.ts");
  assert.match(processAdsSource, /ti\.next_retry_at AS identity_next_retry_at/);
  assert.match(processAdsSource, /retryNotBeforeMs > schedulerNow\.getTime\(\)/);
  assert.match(processAdsSource, /channel\.telegram_access_state === "temporarily_unavailable"/);

  const emergencySource = readSource("src/lib/campaignEmergencyPushHandler.ts");
  assert.match(emergencySource, /LEFT JOIN channel_telegram_identities ti ON ti\.channel_id=c\.id/);
  assert.match(emergencySource, /ti\.next_retry_at IS NULL OR ti\.next_retry_at <= UTC_TIMESTAMP\(\)/);
});

test("Scenario 10: Publisher-paused channels remain paused across temporary and permanent checks", async () => {
  const mockDb = createMockDb([
    {
      id: 111,
      status: "paused",
      paused_reason: "Paused by publisher.",
      suggested_fix: "Reactivate when you want AdsGalaxy to resume posting.",
      failure_reason: null,
      chat_id: "-100111",
    },
  ]);
  const { accessMod } = createServices(mockDb, async () => ({
    status: 400,
    body: { ok: false, error_code: 400, description: "Bad Request: chat not found" },
  }));

  await accessMod.verifyTelegramChannelAccess({
    channelId: 111,
    chatId: "-100111",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });

  const ch = mockDb.channels.get(111);
  assert.equal(ch.status, "paused");
  assert.equal(ch.paused_reason, "Paused by publisher.");
  assert.equal(ch.suggested_fix, "Reactivate when you want AdsGalaxy to resume posting.");
  assert.equal(ch.failure_reason, null);
});

test("Scenario 11: Admin-paused, rejected, pending, and deleted channels remain protected", async () => {
  const mockDb = createMockDb([
    { id: 112, status: "paused", paused_reason: "Paused by admin control center", suggested_fix: "Contact support" },
    { id: 113, status: "rejected", paused_reason: "Rejected by admin control center", suggested_fix: null },
    { id: 114, status: "pending", paused_reason: null, suggested_fix: null },
    { id: 115, status: "deleted", is_deleted: 1, paused_reason: "Channel removed by publisher." },
  ]);
  const { accessMod } = createServices(mockDb, async () => ({
    status: 403,
    body: { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the channel chat" },
  }));

  for (const id of [112, 113, 114, 115]) {
    const beforeStatus = mockDb.channels.get(id).status;
    const beforeReason = mockDb.channels.get(id).paused_reason;
    await accessMod.verifyTelegramChannelAccess({
      channelId: id,
      chatId: `-100${id}`,
      source: "periodic_health",
      persist: true,
      autoPauseActive: true,
    });
    assert.equal(mockDb.channels.get(id).status, beforeStatus, `Channel ${id} status must remain ${beforeStatus}`);
    assert.equal(mockDb.channels.get(id).paused_reason, beforeReason, `Channel ${id} paused_reason must remain intact`);
  }
});

test("Scenario 12: Older or concurrent verification results cannot overwrite newer authoritative decisions", async () => {
  const newerTime = new Date(Date.now() + 60_000);
  const mockDb = createMockDb([
    {
      id: 116,
      status: "paused",
      paused_reason: "Paused by publisher.",
      telegram_access_version: 5,
      health_checked_at: newerTime,
    },
  ]);
  const { accessMod } = createServices(mockDb);

  // 1) Stale expectedVersion check
  const versionGuardResult = await accessMod.persistTelegramChannelAccess(
    {
      channelId: 116,
      source: "periodic_health",
      autoPauseActive: true,
      expectedVersion: 4,
    },
    {
      ok: false,
      state: "bot_removed",
      reasonCode: "bot_removed",
      reason: "Ads Galaxy bot was removed from the channel.",
      checkedAt: new Date(newerTime.getTime() + 5000),
      telegramChatId: "-100116",
      username: null,
      title: null,
      channelType: "public",
      botRole: "kicked",
      canPostMessages: false,
      permanent: true,
      retryable: false,
      retryAfterSeconds: null,
    },
  );
  assert.equal(versionGuardResult.skippedStale, true);
  assert.equal(mockDb.channels.get(116).telegram_access_version, 5);

  // 2) Stale checkedAt timestamp check
  const timestampGuardResult = await accessMod.persistTelegramChannelAccess(
    {
      channelId: 116,
      source: "periodic_health",
      autoPauseActive: true,
      expectedVersion: 5,
    },
    {
      ok: false,
      state: "bot_removed",
      reasonCode: "bot_removed",
      reason: "Ads Galaxy bot was removed from the channel.",
      checkedAt: new Date(Date.now() - 10_000),
      telegramChatId: "-100116",
      username: null,
      title: null,
      channelType: "public",
      botRole: "kicked",
      canPostMessages: false,
      permanent: true,
      retryable: false,
      retryAfterSeconds: null,
    },
  );
  assert.equal(timestampGuardResult.skippedStale, true);
  assert.equal(mockDb.channels.get(116).telegram_access_version, 5);
});

test("Scenario 13: Normal healthy channel verification and posting recovery remain functional", async () => {
  const mockDb = createMockDb(
    [
      {
        id: 117,
        status: "active",
        chat_id: "-100117",
        username: "healthy_channel",
        telegram_access_state: "temporarily_unavailable",
        health_status: "warning",
        failure_reason: "Previous timeout",
      },
    ],
    [
      {
        channel_id: 117,
        telegram_chat_id: "-100117",
        consecutive_failure_count: 2,
        last_failure_code: "telegram_temporarily_unavailable",
        next_retry_at: new Date(Date.now() - 1000),
      },
    ],
  );

  const { accessMod, lifecycleMod } = createServices(mockDb, async (method) => {
    if (method === "getChat") return { status: 200, body: { ok: true, result: { id: -100117, title: "Healthy Channel", username: "healthy_channel", type: "channel" } } };
    if (method === "getMe") return { status: 200, body: { ok: true, result: { id: 999001 } } };
    if (method === "getChatMember") {
      return {
        status: 200,
        body: { ok: true, result: { status: "administrator", can_post_messages: true } },
      };
    }
    return { status: 400, body: { ok: false } };
  });

  const verified = await accessMod.verifyTelegramChannelAccess({
    channelId: 117,
    chatId: "-100117",
    username: "healthy_channel",
    source: "process_ads",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.state, "healthy");

  const ch = mockDb.channels.get(117);
  const ti = mockDb.identities.get(117);
  assert.equal(ch.status, "active");
  assert.equal(ch.telegram_access_state, "healthy");
  assert.equal(ch.health_status, "healthy");
  assert.equal(ch.failure_reason, null);
  assert.equal(ti.consecutive_failure_count, 0);
  assert.equal(ti.next_retry_at, null);

  await lifecycleMod.recordChannelPostSuccess(117);
  assert.equal(mockDb.channels.get(117).telegram_access_state, "healthy");
  assert.equal(mockDb.identities.get(117).next_retry_at, null);
});

test("Scenario 14: No duplicate notifications or deactivation events are generated by repeated temporary failures", async () => {
  const mockDb = createMockDb([{ id: 118, status: "active", chat_id: "-100118" }]);
  let callIndex = 0;
  const transientResponses = [
    { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: chat not found" } },
    { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: member list is inaccessible" } },
    { status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 30", parameters: { retry_after: 30 } } },
    { status: 504, body: { ok: false, error_code: 504, description: "Gateway Timeout" } },
  ];

  const { accessMod } = createServices(mockDb, async () => {
    const res = transientResponses[callIndex % transientResponses.length];
    callIndex += 1;
    return res;
  });

  for (let i = 0; i < 4; i += 1) {
    const res = await accessMod.verifyTelegramChannelAccess({
      channelId: 118,
      chatId: "-100118",
      source: "periodic_health",
      persist: true,
      autoPauseActive: true,
    });
    assert.equal(res.permanent, false);
  }

  const ch = mockDb.channels.get(118);
  assert.equal(ch.status, "active");
  assert.equal(ch.notification_state_version, 0);
  assert.equal(mockDb.notifications.length, 0);

  // Confirmed permanent failure twice: notification fires only on first transition from active -> bot_removed
  const { accessMod: permAccessMod } = createServices(mockDb, async () => ({
    status: 403,
    body: { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the channel chat" },
  }));

  await permAccessMod.verifyTelegramChannelAccess({
    channelId: 118,
    chatId: "-100118",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(mockDb.channels.get(118).status, "bot_removed");
  assert.equal(mockDb.notifications.length, 1);

  await permAccessMod.verifyTelegramChannelAccess({
    channelId: 118,
    chatId: "-100118",
    source: "periodic_health",
    persist: true,
    autoPauseActive: true,
  });
  assert.equal(mockDb.notifications.length, 1, "Second check on already-paused channel must not emit duplicate notification");
});

test("Scenario 15: Existing CPC/CPM accounting and previously delivered placements remain unaffected by verification failures", () => {
  const accessSource = readSource("src/lib/telegramChannelAccess.ts");
  const lifecycleSource = readSource("src/lib/channelLifecycle.ts");

  for (const src of [accessSource, lifecycleSource]) {
    assert.doesNotMatch(src, /DELETE FROM campaign_posts/i);
    assert.doesNotMatch(src, /UPDATE campaign_posts/i);
    assert.doesNotMatch(src, /UPDATE channel_advertiser_debits/i);
    assert.doesNotMatch(src, /UPDATE transactions/i);
    assert.doesNotMatch(src, /UPDATE withdrawals/i);
    assert.doesNotMatch(src, /earning_balance|ad_balance/i);
  }
});
