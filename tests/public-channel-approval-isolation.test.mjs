import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(relativePath, mocks) {
  const source = readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require(name) {
      if (!(name in mocks)) throw new Error("unexpected import: " + name);
      return mocks[name];
    },
    console,
    process,
  }, { filename: relativePath });
  return exports;
}

test("public eligibility uses stored identity and internal restrictions only", async () => {
  let calls = 0;
  const db = { async query() {
    calls++;
    return [[{
      id: 20, status: "pending", is_deleted: 0, channel_type: "public",
      chat_id: "-1001234567890", username: "valid_channel", under_review: 0,
      marketplace_admin_status: "approved", publisher_status: "active",
      publisher_is_banned: 0, duplicate_chat_id: 0, duplicate_username: 0, subscriber_count: 1000,
    }]];
  }};
  const policy = loadTypeScript("src/lib/publicChannelApproval.ts", {
    "@/lib/db": db,
    "@/lib/telegramChannelInput": { normalizePublicChannelUsername: value => /^[A-Za-z0-9_]{3,32}$/.test(value) ? value : null },
  });
  assert.equal((await policy.getPublicChannelApprovalEligibility(20, db)).eligible, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(readFileSync(new URL("../src/lib/publicChannelApproval.ts", import.meta.url), "utf8"), /fetch\(|getChat|verifyTelegram|MTProto/);
});

test("bulk public channels still approve after a private Telegram cooldown", async () => {
  const candidates = [
    { id: 11, user_id: 1, title: "Private", chat_id: "-10011", username: null, channel_type: "private", telegram_id: "1" },
    { id: 12, user_id: 2, title: "Public A", chat_id: "-10012", username: "public_a", channel_type: "public", telegram_id: "2" },
    { id: 13, user_id: 3, title: "Public B", chat_id: "-10013", username: "public_b", channel_type: "public", telegram_id: "3" },
  ];
  const approvedIds = [];
  let telegramCalls = 0;
  const pool = { async query(sql, params) {
    if (sql.includes("SELECT ch.id,ch.user_id,ch.title")) return [candidates];
    if (sql.includes("UPDATE channels SET status='active'")) {
      approvedIds.push(Number(params[0]));
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO channel_admin_action_audits")) return [{ affectedRows: 1 }];
    throw new Error("unexpected query: " + sql.slice(0, 90));
  }};
  pool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (sql.includes("SELECT c.id, c.status")) return [[{ id: params[0], status: "pending", is_deleted: 0, publisher_status: "active", publisher_is_banned: 0, subscriber_count: 1000, telegram_access_version: 0 }]];
      if (sql.includes("UPDATE channels") && sql.includes("status='active'")) { approvedIds.push(Number(params[1])); return [{ affectedRows: 1 }]; }
      if (sql.includes("INSERT INTO channel_admin_action_audits")) return [{ affectedRows: 1 }];
      throw new Error("unexpected transaction query: " + sql.slice(0, 100));
    },
  });
  class ChannelVerificationError extends Error {
    constructor(code, message, retryAfterSeconds) {
      super(message);
      this.code = code;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
  const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
  const route = loadTypeScript("src/app/api/admin/channels/bulk-approve/route.ts", {
    "next/server": next,
    "@/lib/channelStatusAudit": { recordChannelStatusTransitionAudit: async () => {} },
    "@/lib/db": pool,
    "@/lib/adminAuth": { requireAdminPermission: async () => ({ admin: { id: 1 }, response: null }) },
    "@/lib/campaignLifecycle": { recordAdminActionAudit: async () => {} },
    "@/lib/publisherNotifications": { notifyChannelApproved: async () => {}, notifyChannelRejected: async () => {} },
    "@/lib/channelPrivacy": { getChannelPrivacySchema: async () => ({}) },
    "@/lib/privateChannelTrackingOnboarding": { onboardPrivateChannelTracking: async () => { telegramCalls++; return { status: "pending_manual", reason: "rate_limited" }; }, privateTrackingFailureMessage: () => "Telegram is rate-limited; retry manually." },
    "@/lib/channelTelegramIdentity": {
      ChannelVerificationError,
      verifyAndStoreChannelIdentity: async () => {
        telegramCalls++;
        throw new ChannelVerificationError("temporarily_rate_limited", "Telegram cooldown", 3600);
      },
    },
    "@/lib/moderationRejections": { rejectEntityWithPolicy: async () => { throw new Error("must not reject"); } },
    "@/lib/publicChannelApproval": { getPublicChannelApprovalEligibility: async () => ({ eligible: true }) },
    "@/lib/platformNotifications": { enqueueAssetNotification: async () => true },
  });
  const response = await route.POST({ json: async () => ({}) });
  assert.equal(response.status, 200);
  assert.equal(response.body.approved, 2);
  assert.deepEqual(approvedIds, [12, 13]);
  assert.equal(response.body.deferred.length, 1);
  assert.equal(response.body.deferred[0].channel_id, 11);
  assert.equal(telegramCalls, 1);
});

test("stored public approval accepts temporary or legacy unknown states but preserves confirmed failures",async()=>{
  const base={id:20,status:"pending",is_deleted:0,channel_type:"public",chat_id:"-1001234567890",username:"valid_channel",under_review:0,marketplace_admin_status:"approved",publisher_status:"active",publisher_is_banned:0,duplicate_chat_id:0,duplicate_username:0,subscriber_count:1000,bot_member_status:"administrator",bot_can_post:1};
  let row=base;const db={query:async()=>[[row]]};const policy=loadTypeScript("src/lib/publicChannelApproval.ts",{"@/lib/db":db});
  for(const state of ["unknown","temporarily_unavailable","pending_verification"]){row={...base,verification_state:state};assert.equal((await policy.getPublicChannelApprovalEligibility(20,db)).eligible,true,state)}
  for(const state of ["permission_missing","identity_mismatch","bot_removed"]){row={...base,verification_state:state};assert.equal((await policy.getPublicChannelApprovalEligibility(20,db)).eligible,false,state)}
});
