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

async function importTsModule(relPath) {
  const source = readSource(relPath);
  const rewritten = source
    .replace(/import\s*\{[\s\S]*?\}\s*from\s+["'](?:\.\/|@\/lib\/)channelStatusAudit["'];/g, 'async function recordChannelStatusTransitionAudit(){ return { recorded: true, duplicate: false }; }')
    .replace(/import\s+pool\s+from\s+["']@\/lib\/db["'];/g, 'const pool = {};')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s+["']@\/lib\/systemLogs["'];/g, 'async function createSystemLog(){} function maskEntityId(t,id){return String(id);}')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s+["']@\/lib\/platformNotifications["'];/g, 'async function enqueueAssetNotification(){}');
  const transpiled = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  return import(dataUrl);
}

async function importRecoveryServiceWithAccess() {
  const accessMod = await importTsModule("src/lib/telegramChannelAccess.ts");
  const eligibilityMod = await importTsModule("src/lib/channelEligibility.ts");
  globalThis.__adsGalaxyAccessMod = accessMod;
  globalThis.__adsGalaxyEligibilityMod = eligibilityMod;
  const source = readSource("src/lib/channelRecoveryService.ts");
  const rewritten = source
    .replace(/import\s*\{[\s\S]*?\}\s*from\s+["'](?:\.\/|@\/lib\/)channelStatusAudit["'];/g, 'async function recordChannelStatusTransitionAudit(){ return { recorded: true, duplicate: false }; }')
    .replace(/import\s+pool\s+from\s+["']@\/lib\/db["'];/g, 'const pool = {};')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s+["']@\/lib\/systemLogs["'];/g, 'async function createSystemLog(){} function maskEntityId(t,id){return String(id);}')
    .replace(
      /import\s*\{[\s\S]*?\}\s*from\s+["']@\/lib\/telegramChannelAccess["'];/,
      'const { verifyTelegramChannelAccess } = globalThis.__adsGalaxyAccessMod;',
    )
    .replace(
      /import\s*\{[\s\S]*?\}\s*from\s+["']@\/lib\/channelEligibility["'];/,
      'const { evaluateUnifiedChannelEligibility } = globalThis.__adsGalaxyEligibilityMod;',
    );
  const transpiled = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  return {
    accessMod,
    recoveryMod: await import(dataUrl),
  };
}

function makeHealthyVerification(overrides = {}) {
  return {
    ok: true,
    state: "healthy",
    reason: null,
    reasonCode: null,
    evidenceCategory: "confirmed",
    checkedAt: new Date("2026-11-06T20:00:00Z"),
    telegramChatId: "-1001234567890",
    username: "adsgalaxy_verified",
    title: "AdsGalaxy Verified Channel",
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
    id: 501,
    user_id: 77,
    title: "AdsGalaxy Verified Channel",
    chat_id: "-1001234567890",
    username: "adsgalaxy_verified",
    channel_type: "public",
    status: "channel_not_found",
    is_deleted: 0,
    under_review: 0,
    marketplace_admin_status: "approved",
    paused_reason: "Telegram channel could not be found or accessed using its stored identity.",
    monetization_paused_reason: null,
    below_minimum_review_required: 0,
    settlement_excluded_until: null,
    automation_suspension_status: "active",
    automation_suspended_until: null,
    revenue_protection_status: "normal",
    tracking_account_member_status: "not_required",
    telegram_access_version: 4,
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

test("Scenario 1: Previously approved channel successfully recovers after confirmed bot administrator verification", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  for (const disconnectedStatus of ["channel_not_found", "bot_removed", "permission_missing"]) {
    const channel = makeBaseCandidate({ status: disconnectedStatus });
    const verification = makeHealthyVerification();
    const decision = recoveryMod.evaluateChannelRecoveryEligibility({
      channel,
      verification,
      audits: [{ action: "bulk_approve", created_at: "2026-09-01T00:00:00Z" }],
      now: new Date("2026-11-06T20:05:00Z"),
    });
    assert.equal(decision.eligible, true);
    assert.equal(decision.targetStatus, "active");
    assert.equal(decision.outcome, "recovered_active");
  }
});

test("Scenario 2: Previously deactivated channel with missing posting permissions remains inactive", async () => {
  const { accessMod, recoveryMod } = await importRecoveryServiceWithAccess();
  const channel = makeBaseCandidate({ status: "permission_missing" });
  const verification = accessMod.telegramAccessResultFromMembership({
    chatId: "-1001234567890",
    username: "adsgalaxy_verified",
    title: "AdsGalaxy Verified Channel",
    channelType: "public",
    status: "administrator",
    canPostMessages: false,
  });
  assert.equal(verification.ok, false);
  assert.equal(verification.state, "permission_missing");
  assert.equal(verification.evidenceCategory, "confirmed");

  const decision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel,
    verification,
    now: new Date("2026-11-06T20:05:00Z"),
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.targetStatus, "permission_missing");
  assert.equal(decision.outcome, "blocked_missing_permissions");
});

test("Scenario 3: Bot removed and later legitimately re-added recovers to active", async () => {
  const { accessMod, recoveryMod } = await importRecoveryServiceWithAccess();
  const removedResult = accessMod.telegramAccessResultFromMembership({
    chatId: "-1001234567890",
    username: "adsgalaxy_verified",
    status: "kicked",
    canPostMessages: false,
  });
  assert.equal(removedResult.state, "bot_removed");
  assert.equal(removedResult.permanent, true);

  const readdedResult = accessMod.telegramAccessResultFromMembership({
    chatId: "-1001234567890",
    username: "adsgalaxy_verified",
    status: "administrator",
    canPostMessages: true,
  });
  assert.equal(readdedResult.ok, true);
  assert.equal(readdedResult.state, "healthy");

  const decision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "bot_removed" }),
    verification: readdedResult,
    now: new Date("2026-11-06T20:05:00Z"),
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.targetStatus, "active");
  assert.equal(decision.reason, "recovered_after_bot_readded");
});

test("Scenario 4: Publisher-paused channel never auto-resumes", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const policyMod = await import("../scripts/channel-recovery-policy.mjs");
  const channel = makeBaseCandidate({
    status: "paused",
    paused_reason: "Paused by publisher",
  });
  const decision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel,
    verification: makeHealthyVerification(),
    now: new Date("2026-11-06T20:05:00Z"),
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.targetStatus, "paused");
  assert.equal(decision.outcome, "blocked_publisher_paused");

  const syncDecision = policyMod.recoveryDecision({
    currentStatus: "paused",
    telegramHealthy: true,
    publisherPaused: true,
  });
  assert.equal(syncDecision.status, "paused");
  assert.equal(syncDecision.reason, "publisher_pause_preserved");
});

test("Scenario 5: Admin-paused channel never auto-resumes", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const policyMod = await import("../scripts/channel-recovery-policy.mjs");
  const channel = makeBaseCandidate({
    status: "paused",
    paused_reason: "Paused by admin",
  });
  const decision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel,
    verification: makeHealthyVerification(),
    audits: [{ action: "pause", created_at: "2026-11-06T10:00:00Z" }],
    now: new Date("2026-11-06T20:05:00Z"),
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.targetStatus, "paused");
  assert.equal(decision.outcome, "blocked_admin_paused");

  const syncDecision = policyMod.recoveryDecision({
    currentStatus: "paused",
    telegramHealthy: true,
    adminPaused: true,
  });
  assert.equal(syncDecision.status, "paused");
  assert.equal(syncDecision.reason, "admin_pause_preserved");
});

test("Scenario 6: Rejected or banned channel never auto-resumes", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const rejectedDecision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "rejected" }),
    verification: makeHealthyVerification(),
    audits: [{ action: "reject", old_value: { status: "pending" }, created_at: "2026-11-01T00:00:00Z" }],
  });
  assert.equal(rejectedDecision.eligible, false);
  assert.equal(rejectedDecision.targetStatus, "rejected");
  assert.equal(rejectedDecision.outcome, "blocked_rejected_or_banned");

  const bannedPublisherDecision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "bot_removed", publisher_is_banned: 1, publisher_status: "banned" }),
    verification: makeHealthyVerification(),
  });
  assert.equal(bannedPublisherDecision.eligible, false);
  assert.equal(bannedPublisherDecision.outcome, "blocked_rejected_or_banned");
});

test("Scenario 7: Deleted channel never auto-resumes", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const decision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "bot_removed", is_deleted: 1 }),
    verification: makeHealthyVerification(),
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.targetStatus, "deleted");
  assert.equal(decision.outcome, "blocked_deleted");
});

test("Scenario 8: Pending channel does not bypass approval", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const decision = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "pending", marketplace_admin_status: "pending" }),
    verification: makeHealthyVerification(),
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.targetStatus, "pending");
  assert.equal(decision.outcome, "blocked_pending_approval");
});

test("Scenario 9: Failed verification preserves last successful evidence", async () => {
  const { accessMod } = await importRecoveryServiceWithAccess();
  const identityState = {
    bot_member_status: "administrator",
    bot_can_post: 1,
    verification_state: "healthy",
    last_verified_at: "2026-11-01T12:00:00.000000Z",
    last_success_at: "2026-11-01T12:00:00.000000Z",
    last_checked_at: "2026-11-01T12:00:00.000000Z",
    consecutive_failure_count: 0,
    last_failure_code: null,
  };
  let identityParams = null;

  const mockDb = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("SELECT id,user_id,status")) {
        return [[{
          id: 501,
          user_id: 77,
          status: "active",
          title: "AdsGalaxy Verified Channel",
          chat_id: "-1001234567890",
          username: "adsgalaxy_verified",
          channel_type: "public",
          telegram_access_state: "healthy",
          telegram_access_version: 2,
          health_checked_at: new Date("2026-11-01T12:00:00Z"),
        }]];
      }
      if (text.includes("INSERT INTO channel_telegram_identities")) {
        identityParams = params;
        // Simulate MySQL ON DUPLICATE KEY UPDATE expressions for temporary/uncertain failure
        const newVerificationState = params[6];
        const evidenceCategory = params[16];
        identityState.bot_member_status = newVerificationState === "healthy"
          ? params[4]
          : evidenceCategory === "confirmed"
            ? (params[4] ?? identityState.bot_member_status)
            : identityState.bot_member_status;
        identityState.bot_can_post = newVerificationState === "healthy"
          ? 1
          : evidenceCategory === "confirmed"
            ? 0
            : identityState.bot_can_post;
        identityState.verification_state = newVerificationState;
        identityState.consecutive_failure_count += 1;
        identityState.last_failure_code = params[13];
        identityState.last_checked_at = "2026-11-06T20:00:00.000000Z";
        return [{ affectedRows: 2 }];
      }
      return [{ affectedRows: 1 }];
    },
  };

  for (const rawDesc of [
    "Bad Request: chat not found",
    "Bad Request: member list is inaccessible",
    "Request timed out",
  ]) {
    const fail = accessMod.classifyTelegramAccessFailure({ description: rawDesc });
    assert.notEqual(fail.evidenceCategory, "confirmed");
    await accessMod.persistTelegramChannelAccess(
      { channelId: 501, source: "periodic_health", autoPauseActive: true, expectedVersion: 2 },
      {
        ...fail,
        checkedAt: new Date("2026-11-06T20:00:00Z"),
        telegramChatId: "-1001234567890",
        username: "adsgalaxy_verified",
        title: "AdsGalaxy Verified Channel",
        channelType: "public",
        botRole: null,
        canPostMessages: false,
      },
      mockDb,
    );
    assert.equal(identityState.bot_member_status, "administrator");
    assert.equal(identityState.bot_can_post, 1);
    assert.equal(identityState.last_verified_at, "2026-11-01T12:00:00.000000Z");
    assert.ok(identityParams);
  }
});

test("Scenario 10: New authoritative removal overrides older successful evidence", async () => {
  const { accessMod } = await importRecoveryServiceWithAccess();
  const identityState = {
    bot_member_status: "administrator",
    bot_can_post: 1,
    verification_state: "healthy",
    last_verified_at: "2026-11-01T12:00:00.000000Z",
  };
  let channelNewStatus = "active";

  const mockDb = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("SELECT id,user_id,status")) {
        return [[{
          id: 501,
          user_id: 77,
          status: "active",
          title: "AdsGalaxy Verified Channel",
          chat_id: "-1001234567890",
          username: "adsgalaxy_verified",
          channel_type: "public",
          telegram_access_state: "healthy",
          telegram_access_version: 2,
          health_checked_at: new Date("2026-11-01T12:00:00Z"),
        }]];
      }
      if (text.includes("INSERT INTO channel_telegram_identities")) {
        const newVerificationState = params[6];
        const evidenceCategory = params[16];
        identityState.bot_member_status = newVerificationState === "healthy"
          ? params[4]
          : evidenceCategory === "confirmed"
            ? (params[4] ?? identityState.bot_member_status)
            : identityState.bot_member_status;
        identityState.bot_can_post = newVerificationState === "healthy"
          ? 1
          : evidenceCategory === "confirmed"
            ? 0
            : identityState.bot_can_post;
        identityState.verification_state = newVerificationState;
        return [{ affectedRows: 2 }];
      }
      if (text.includes("UPDATE channels SET status=?")) {
        channelNewStatus = params[0];
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SELECT notification_state_version")) {
        return [[{ notification_state_version: 3 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };

  const kickedResult = accessMod.telegramAccessResultFromMembership({
    chatId: "-1001234567890",
    username: "adsgalaxy_verified",
    status: "kicked",
    canPostMessages: false,
  });
  assert.equal(kickedResult.evidenceCategory, "confirmed");
  assert.equal(kickedResult.permanent, true);

  const persisted = await accessMod.persistTelegramChannelAccess(
    { channelId: 501, source: "webhook", autoPauseActive: true, expectedVersion: 2 },
    kickedResult,
    mockDb,
  );
  assert.equal(persisted.autoPaused, true);
  assert.equal(channelNewStatus, "bot_removed");
  assert.equal(identityState.bot_member_status, "kicked");
  assert.equal(identityState.bot_can_post, 0);
  assert.equal(identityState.verification_state, "bot_removed");
  // Historical last_verified_at timestamp remains preserved for audit while current permissions reflect authoritative removal
  assert.equal(identityState.last_verified_at, "2026-11-01T12:00:00.000000Z");
});

test("Scenario 11: Stale verification cannot override newer admin actions", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const staleVerification = makeHealthyVerification({
    checkedAt: new Date("2026-11-06T12:00:00Z"),
  });
  const decisionByAuditTime = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "bot_removed", telegram_access_version: 5 }),
    verification: staleVerification,
    audits: [{ action: "pause", created_at: "2026-11-06T12:05:00Z" }],
    expectedVersion: 5,
  });
  assert.equal(decisionByAuditTime.eligible, false);

  const decisionByVersionMismatch = recoveryMod.evaluateChannelRecoveryEligibility({
    channel: makeBaseCandidate({ status: "bot_removed", telegram_access_version: 6 }),
    verification: makeHealthyVerification({ checkedAt: new Date("2026-11-06T12:10:00Z") }),
    expectedVersion: 5,
  });
  assert.equal(decisionByVersionMismatch.eligible, false);
  assert.equal(decisionByVersionMismatch.outcome, "blocked_stale_verification");
});

test("Scenario 12: Telegram 429 respects retry-after and pauses recovery batch", async () => {
  const { accessMod, recoveryMod } = await importRecoveryServiceWithAccess();
  const rateLimited = accessMod.classifyTelegramAccessFailure({
    httpStatus: 429,
    description: "Too Many Requests: retry after 95",
    retryAfterSeconds: 95,
  });
  assert.equal(rateLimited.reasonCode, "telegram_rate_limited");
  assert.equal(rateLimited.evidenceCategory, "temporary");
  assert.equal(rateLimited.retryAfterSeconds, 95);

  let verifiedCount = 0;
  const mockDb = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM channel_recovery_checkpoints")) return [[{ last_channel_id: 0 }]];
      if (text.includes("FROM channels c") && text.includes("ORDER BY")) {
        return [[
          makeBaseCandidate({ id: 601, status: "channel_not_found" }),
          makeBaseCandidate({ id: 602, status: "bot_removed" }),
        ]];
      }
      if (text.includes("FROM channel_admin_action_audits")) return [[]];
      return [{ affectedRows: 1 }];
    },
  };

  const summary = await recoveryMod.runControlledChannelRecoveryBatch(
    {
      batchSize: 5,
      workerId: "test-worker-429",
      verifier: async () => {
        verifiedCount += 1;
        return {
          ...rateLimited,
          checkedAt: new Date(),
          telegramChatId: "-1001234567890",
          username: "adsgalaxy_verified",
          title: "AdsGalaxy Verified Channel",
          channelType: "public",
          botRole: null,
          canPostMessages: false,
        };
      },
    },
    mockDb,
  );

  assert.equal(verifiedCount, 1, "Batch must stop immediately after hitting 429 rate limit");
  assert.equal(summary.rateLimited, true);
  assert.equal(summary.retryAfterSeconds, 95);
  assert.equal(summary.recovered, 0);
});

test("Scenario 13: Concurrent recovery workers cannot cause duplicate status updates", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  const sharedState = {
    status: "channel_not_found",
    telegram_access_version: 4,
    auditInserts: 0,
  };

  function createWorkerDb() {
    return {
      async query(sql, params) {
        const text = String(sql);
        if (text.includes("FROM channel_recovery_checkpoints")) return [[{ last_channel_id: 0 }]];
        if (text.includes("FROM channels c") && text.includes("ORDER BY")) {
          return [[makeBaseCandidate({ id: 701, status: "channel_not_found", telegram_access_version: 4 })]];
        }
        if (text.includes("FROM channel_admin_action_audits")) return [[]];
        if (text.includes("WHERE c.id=? LIMIT 1")) {
          return [[makeBaseCandidate({ id: 701, status: "channel_not_found", telegram_access_version: 4 })]];
        }
        if (text.includes("UPDATE channels") && text.includes("SET status = 'active'")) {
          const expectedStatus = params[1];
          const expectedVer = params[2];
          if (sharedState.status === expectedStatus && sharedState.telegram_access_version === expectedVer) {
            sharedState.status = "active";
            sharedState.telegram_access_version += 1;
            return [{ affectedRows: 1 }];
          }
          return [{ affectedRows: 0 }];
        }
        if (text.includes("INSERT INTO channel_admin_action_audits")) {
          sharedState.auditInserts += 1;
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
      },
    };
  }

  const [workerA, workerB] = await Promise.all([
    recoveryMod.runControlledChannelRecoveryBatch(
      {
        batchSize: 1,
        workerId: "worker-A",
        verifier: async () => makeHealthyVerification(),
      },
      createWorkerDb(),
    ),
    recoveryMod.runControlledChannelRecoveryBatch(
      {
        batchSize: 1,
        workerId: "worker-B",
        verifier: async () => makeHealthyVerification(),
      },
      createWorkerDb(),
    ),
  ]);

  assert.equal(workerA.recovered + workerB.recovered, 1, "Exactly one worker may transition the channel to active");
  assert.equal(workerA.skippedConcurrentOrProtected + workerB.skippedConcurrentOrProtected, 1);
  assert.equal(sharedState.auditInserts, 1, "Only one recovery audit record may be written");
});

test("Scenario 14: Crash recovery resumes from the correct checkpoint", async () => {
  const { recoveryMod } = await importRecoveryServiceWithAccess();
  let savedCursor = 0;
  const allCandidates = [
    makeBaseCandidate({ id: 801, status: "channel_not_found" }),
    makeBaseCandidate({ id: 802, status: "bot_removed" }),
    makeBaseCandidate({ id: 803, status: "permission_missing" }),
  ];

  const mockDb = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("FROM channel_recovery_checkpoints")) {
        return [[{ last_channel_id: savedCursor }]];
      }
      if (text.includes("FROM channels c") && text.includes("ORDER BY")) {
        const cursor = Number(params[0] || 0);
        const limit = Number(params[1] || 10);
        const remaining = allCandidates.filter((c) => c.id > cursor).slice(0, limit);
        return [remaining];
      }
      if (text.includes("FROM channel_admin_action_audits")) return [[]];
      if (text.includes("WHERE c.id=? LIMIT 1")) {
        const id = Number(params[0]);
        return [allCandidates.filter((c) => c.id === id)];
      }
      if (text.includes("UPDATE channels") && text.includes("SET status = 'active'")) {
        const id = Number(params[0]);
        const item = allCandidates.find((c) => c.id === id);
        if (item) item.status = "active";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("INSERT INTO channel_recovery_checkpoints")) {
        savedCursor = Number(params[1]);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    },
  };

  const firstRun = await recoveryMod.runControlledChannelRecoveryBatch(
    {
      batchSize: 2,
      workerId: "worker-crash-test-1",
      verifier: async () => makeHealthyVerification(),
    },
    mockDb,
  );
  assert.equal(firstRun.cursorBefore, 0);
  assert.equal(firstRun.cursorAfter, 802);
  assert.equal(firstRun.recovered, 2);

  const resumedRun = await recoveryMod.runControlledChannelRecoveryBatch(
    {
      batchSize: 2,
      workerId: "worker-crash-test-2",
      verifier: async () => makeHealthyVerification(),
    },
    mockDb,
  );
  assert.equal(resumedRun.cursorBefore, 802);
  assert.equal(resumedRun.cursorAfter, 803);
  assert.equal(resumedRun.recovered, 1);
  assert.equal(resumedRun.details[0].channelId, 803);
});

test("Scenario 15: Recovered channels cannot generate duplicate ad posts", () => {
  const recoveryServiceSource = readSource("src/lib/channelRecoveryService.ts");
  const processAdsSource = readSource("src/app/api/cron/process-ads/route.ts");

  // Recovery service never inserts into campaign_posts or triggers ad sends directly
  assert.doesNotMatch(recoveryServiceSource, /INSERT\s+INTO\s+campaign_posts/i);
  assert.doesNotMatch(recoveryServiceSource, /sendTelegramAd/i);

  // Scheduled ad delivery enforces slot claims and 24-hour duplicate prevention
  assert.match(processAdsSource, /reserveChannelPlacement/);
  assert.match(processAdsSource, /recent24h/);
});

test("Scenario 16: Existing CPC/CPM billing remains intact", () => {
  const recoveryServiceSource = readSource("src/lib/channelRecoveryService.ts");
  const accessSource = readSource("src/lib/telegramChannelAccess.ts");
  const syncSource = readSource("scripts/sync-channel-identities.mjs");

  for (const src of [recoveryServiceSource, accessSource, syncSource]) {
    assert.doesNotMatch(
      src,
      /UPDATE\s+(users|campaigns|campaign_posts|campaign_clicks|ad_settlements|ad_settlements_views|channel_settlement_ledger|withdrawals)/i,
    );
    assert.doesNotMatch(
      src,
      /INSERT\s+INTO\s+(campaign_clicks|ad_settlements|ad_settlements_views|channel_settlement_ledger|withdrawals)/i,
    );
  }
});

test("Scenario 17: All channel verification callers use the shared policy", () => {
  const callers = [
    { file: "src/app/api/publisher/channels/route.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "src/app/api/admin/channels/[id]/actions/route.ts", pattern: /verifyAndStoreChannelIdentity/ },
    { file: "src/app/api/admin/channels/bulk-approve/route.ts", pattern: /verifyAndStoreChannelIdentity/ },
    { file: "src/lib/channelTelegramIdentity.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "src/lib/channelLifecycle.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "src/app/api/webhook/telegram/route.ts", pattern: /persistTelegramMembershipUpdate/ },
    { file: "src/lib/channelHealthMonitor.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "src/app/api/cron/process-ads/route.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "src/lib/campaignEmergencyPushHandler.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "src/lib/telegramCleanupPolicy.ts", pattern: /classifyTelegramAccessFailure/ },
    { file: "src/lib/channelRecoveryService.ts", pattern: /verifyTelegramChannelAccess/ },
    { file: "scripts/sync-channel-identities.mjs", pattern: /classifyTelegramFailure/ },
    { file: "scripts/check-paused-channels-once.js", pattern: /classifyError/ },
  ];

  for (const { file, pattern } of callers) {
    const content = readSource(file);
    assert.match(content, pattern, `Expected ${file} to use shared verification policy (${pattern})`);
  }
});

test("Scenario 18: Batch 1 regressions remain passing under Batch 2", async () => {
  const { accessMod } = await importRecoveryServiceWithAccess();
  // 1. Single chat not found is unconfirmed & non-permanent
  const unconfirmedNotFound = accessMod.classifyTelegramAccessFailure({
    description: "Bad Request: chat not found",
  });
  assert.equal(unconfirmedNotFound.permanent, false);
  assert.equal(unconfirmedNotFound.reasonCode, "chat_not_found_unconfirmed");
  assert.equal(unconfirmedNotFound.evidenceCategory, "uncertain");

  // 2. Member list inaccessible is non-permanent & uncertain
  const memberInaccessible = accessMod.classifyTelegramAccessFailure({
    description: "Bad Request: member list is inaccessible",
  });
  assert.equal(memberInaccessible.permanent, false);
  assert.equal(memberInaccessible.reasonCode, "member_list_inaccessible");
  assert.equal(memberInaccessible.evidenceCategory, "uncertain");

  // 3. Confirmed kicked/left is permanent & confirmed
  const botKicked = accessMod.classifyTelegramAccessFailure({
    description: "Forbidden: bot was kicked from the channel chat",
  });
  assert.equal(botKicked.permanent, true);
  assert.equal(botKicked.state, "bot_removed");
  assert.equal(botKicked.evidenceCategory, "confirmed");
});
