import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const eligibilityExports = {};
vm.runInNewContext(compile("src/lib/channelEligibility.ts"), {
  exports: eligibilityExports, require: () => ({}), Date, String, Number, Boolean, Set,
});
const postingExports = {};
vm.runInNewContext(compile("src/lib/channelPostingEligibility.ts"), {
  exports: postingExports,
  require: name => name === "@/lib/channelEligibility" ? eligibilityExports : {},
  Date, String, Number, Boolean, Set,
});
const check = postingExports.checkPendingChannelPostEligibility;
const base = {
  id: 7, status: "active", is_deleted: 0, channel_type: "public",
  chat_id: "-1001234567890", username: "validchannel",
  marketplace_admin_status: "approved", publisher_status: "active",
  publisher_is_banned: 0, subscriber_count: 500,
};
function fixture(overrides = {}, postStatus = "pending_delivery") {
  const row = { ...base, ...overrides };
  const db = { query: async (sql, params) => {
    assert.match(sql, /FROM campaign_posts cp/);
    assert.match(sql, /cp.status='pending_delivery'/);
    assert.match(sql, /cp.delivery_confirmed_at IS NULL/);
    assert.match(sql, /cp.delivery_failed_at IS NULL/);
    assert.deepEqual(Array.from(params), [23, 11, 7]);
    return [postStatus === "pending_delivery" ? [row] : []];
  } };
  return () => check(db, { postId: 23, campaignId: 11, channelId: 7 });
}

test("eligible approved public pending placement remains postable", async () => {
  assert.equal((await fixture()()).allowed, true);
});
for (const [name, change] of [
  ["pending approval", { status: "pending" }],
  ["rejected status", { status: "rejected" }],
  ["deleted status", { status: "deleted" }],
  ["deleted flag", { is_deleted: 1 }],
  ["disabled status", { status: "disabled" }],
  ["marketplace rejection", { marketplace_admin_status: "rejected" }],
  ["marketplace pending", { marketplace_admin_status: "pending" }],
  ["publisher disabled", { publisher_status: "disabled" }],
  ["under review", { under_review: 1 }],
  ["private membership pending", { channel_type: "private", username: null, tracking_account_status: "pending_manual", tracking_account_member_status: null }],
  ["private membership failed", { channel_type: "private", username: null, tracking_account_status: "failed", tracking_account_member_status: null }],
]) test(`current ${name} blocks a previously selected placement`, async () => {
  assert.equal((await fixture(change)()).allowed, false);
});
test("confirmed private tracking permits posting", async () => {
  assert.equal((await fixture({ channel_type: "private", username: null, tracking_account_status: "active", tracking_account_member_status: "member" })()).allowed, true);
});
test("outdated or already completed placement cannot be posted", async () => {
  assert.equal((await fixture({}, "delivery_failed")()).allowed, false);
});
test("scheduled and emergency paths invoke final guard after reservation and before Telegram", () => {
  const scheduled = fs.readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
  const emergency = fs.readFileSync("src/lib/campaignEmergencyPushHandler.ts", "utf8");
  assert.ok(scheduled.indexOf("reserveChannelPlacement(conn") < scheduled.indexOf("const finalChannelEligibility = await checkPendingChannelPostEligibility"));
  assert.ok(scheduled.indexOf("const finalChannelEligibility = await checkPendingChannelPostEligibility") < scheduled.indexOf("const result = await sendTelegramMessageWithRetries(channel.chat_id"));
  assert.ok(emergency.indexOf("reserveChannelPlacement(reservationConnection") < emergency.indexOf("const finalChannelEligibility = await checkPendingChannelPostEligibility"));
  assert.ok(emergency.indexOf("const finalChannelEligibility = await checkPendingChannelPostEligibility") < emergency.indexOf("let result = await send()"));
  assert.match(emergency, /retryChannelEligibility = await checkPendingChannelPostEligibility/);
});
test("scheduled retry checks current status before sending a second Telegram request", async () => {
  const src = fs.readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
  const section = src.slice(src.indexOf("async function sendTelegramMessageWithRetries("), src.indexOf("function buildPostMaps("));
  assert.ok(section.startsWith("async function sendTelegramMessageWithRetries("));
  const js = ts.transpileModule(section + "\nexports.sendTelegramMessageWithRetries=sendTelegramMessageWithRetries;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out = {};
  let sends = 0, checks = 0;
  vm.runInNewContext(js, {
    exports: out,
    sendTelegramMessage: async () => { sends++; return { ok: false, description: "temporary error", httpStatus: 503 }; },
    classifyTelegramAccessFailure: () => ({ reasonCode: "temporary" }),
    classifyTelegramSendFailure: () => null,
    sleep: async () => {},
    Number, String,
  });
  const result = await out.sendTelegramMessageWithRetries("-100123", "ad", {}, async () => {
    checks++; return { allowed: false, reason: "channel_no_longer_active" };
  });
  assert.equal(sends, 1);
  assert.equal(checks, 1);
  assert.equal(result.blockedReason, "channel_no_longer_active");
});

test("scheduled service marks a changed channel placement failed before send", async () => {
  const src = fs.readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
  const block = src.slice(src.indexOf("      const finalChannelEligibility = await checkPendingChannelPostEligibility(pool, {"), src.indexOf("      const replyMarkup = {"));
  const js = ts.transpileModule("exports.probe=async function(){let failedPosts=0;const incrementSkip=(reason)=>skips.push(reason);" + block.replace("continue;", "return {blocked:true,failedPosts};") + "return {blocked:false,failedPosts};}", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out = {}, skips = [], failures = [];
  vm.runInNewContext(js, {
    exports: out, pool: {}, postId: 23, slotClaimId: 9,
    campaign: { id: 11 }, channel: { id: 7, postingSlotDate: "2026-11-16", postingSlotTime: "12:00" },
    checkPendingChannelPostEligibility: async () => ({ allowed: false, reason: "CHANNEL_REJECTED" }),
    markScheduledPlacementFailed: async input => { failures.push(input); return true; },
    skips, Number,
  });
  const result = await out.probe();
  assert.equal(result.blocked, true);
  assert.equal(result.failedPosts, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "CHANNEL_REJECTED");
  assert.deepEqual(skips, ["CHANNEL_REJECTED"]);
});
test("emergency service releases a changed channel placement before send", async () => {
  const src = fs.readFileSync("src/lib/campaignEmergencyPushHandler.ts", "utf8");
  const block = src.slice(src.indexOf("  const finalChannelEligibility = await checkPendingChannelPostEligibility(pool, {"), src.indexOf("  const send = async ():Promise<TelegramSendResponse|undefined> => {"));
  const js = ts.transpileModule("exports.probe=async function(){" + block + "return {ok:true};}", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out = {}, failures = [];
  vm.runInNewContext(js, {
    exports: out, pool: {}, postId: 23,
    campaign: { id: 11 }, channel: { id: 7 },
    checkPendingChannelPostEligibility: async () => ({ allowed: false, reason: "PRIVATE_TRACKING_NOT_VERIFIED" }),
    failReservation: async reason => { failures.push(reason); return true; },
    Number,
  });
  const result = await out.probe();
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "PRIVATE_TRACKING_NOT_VERIFIED");
  assert.equal(result.claimReleased, true);
  assert.deepEqual(failures, ["PRIVATE_TRACKING_NOT_VERIFIED"]);
});
