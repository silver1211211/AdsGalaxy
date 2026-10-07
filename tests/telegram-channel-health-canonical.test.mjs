import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const service = read("src/lib/telegramChannelAccess.ts");
const submission = read("src/app/api/publisher/channels/route.ts");
const adminApi = read("src/app/api/admin/channels/route.ts");
const adminUi = read("src/app/admin/channels/page.tsx");
const processAds = read("src/app/api/cron/process-ads/route.ts");
const webhook = read("src/app/api/webhook/telegram/route.ts");
const monitor = read("src/lib/channelHealthMonitor.ts");
const identity = read("src/lib/channelTelegramIdentity.ts");

test("1 pending healthy submission persists canonical health without activation", () => {
  assert.match(submission, /source: "submission"/);
  assert.match(submission, /autoPauseActive: false/);
  assert.match(submission, /"pending"/);
  assert.match(service, /telegram_access_state='healthy'/);
});

test("2 pending permission failure stays moderation-pending", () => {
  assert.match(service, /state === "permission_missing"/);
  assert.match(service, /input\.autoPauseActive && channel\.status === "active"/);
  assert.doesNotMatch(submission, /if \(!hasRequiredAdminAccess\)/);
});

test("3 pending bot removal is represented canonically without auto-reject", () => {
  assert.match(service, /"bot_removed"/);
  assert.doesNotMatch(service, /status='rejected'/);
});

test("4 active permission loss uses the canonical guarded pause transition", () => {
  assert.match(service, /status='active'/);
  assert.match(service, /statusForPermanentState/);
  assert.match(service, /notification_state_version=notification_state_version\+1/);
});

test("5 active bot removal is permanent and auto-pausable", () => {
  assert.match(service, /bot was kicked\|bot is not a member/);
  assert.match(service, /make\("bot_removed", "bot_removed", true, false\)/);
});

test("6 missing Telegram channel is permanent", () => {
  assert.match(service, /make\("channel_not_found", "channel_not_found", true, false\)/);
});

test("7 CHAT_RESTRICTED has its own permanent state", () => {
  assert.match(service, /chat_restricted\|chat restricted/);
  assert.match(service, /make\("restricted", "chat_restricted", true, false\)/);
});

test("8 network timeout is retryable and cannot enter active-only pause branch", () => {
  assert.match(service, /timeout\|timed out/);
  assert.match(service, /make\("temporarily_unavailable", "telegram_temporarily_unavailable", false, true\)/);
});

test("9 Telegram 429 preserves retry-after semantics", () => {
  assert.match(service, /status === 429 \|\| retryAfterSeconds/);
  assert.match(service, /retryAfterSeconds/);
});

test("10 repeated permanent events are idempotent", () => {
  assert.match(service, /WHERE id=\? AND is_deleted=FALSE AND status='active'/);
  assert.match(service, /enqueueAssetNotification/);
  assert.match(service, /notification_state_version=notification_state_version\+1/);
});

test("11 healthy my_chat_member does not reactivate monetization", () => {
  assert.match(webhook, /persistTelegramMembershipUpdate/);
  assert.doesNotMatch(webhook, /reactivated_at/);
  assert.doesNotMatch(webhook, /telegram_access_previous_status='active' THEN 'active'/);
});

test("12 process-ads uses the canonical verifier", () => {
  assert.match(processAds, /verifyTelegramChannelAccess/);
  assert.match(processAds, /source: "process_ads"/);
  assert.doesNotMatch(processAds, /checkChannelHealth\(\{ id: channel\.id/);
});

test("13 Admin models and badges use canonical persisted state", () => {
  assert.match(adminApi, /telegram_access_checked_at/);
  assert.match(adminUi, /channel\.telegram_access_state \|\| channel\.telegram_verification_state/);
  assert.match(adminUi, /Telegram healthy/);
});

test("14 Telegram health service has no financial service dependency", () => {
  assert.doesNotMatch(service, /advertiserDirectDebit|channelSettlement|publisherCredit|wallet|withdrawal|deposit/i);
});

test("15 failed checks preserve last positive verification time", () => {
  assert.match(service, /last_verified_at=IF\(VALUES\(verification_state\)='healthy',UTC_TIMESTAMP\(6\),last_verified_at\)/);
});

test("16 successful checks update checked and verified timestamps", () => {
  assert.match(service, /last_verified_at=IF\(VALUES\(verification_state\)='healthy',UTC_TIMESTAMP\(6\),last_verified_at\)/);
  assert.match(service, /last_checked_at=UTC_TIMESTAMP\(6\)/);
});

test("17 never-checked Admin state remains Not checked", () => {
  assert.match(adminUi, /return \{ label: "Not checked"/);
  assert.doesNotMatch(adminUi, /if \(channel\.telegram_last_verified_at\) return \{ label: "Telegram healthy"/);
});

test("18 periodic verification includes pending inventory and is independent of campaigns", () => {
  assert.match(monitor, /status NOT IN \('rejected','deleted'\)/);
  assert.match(monitor, /TELEGRAM_ACCESS_STALE_HOURS/);
  assert.doesNotMatch(monitor, /JOIN campaigns/);
  assert.match(identity, /verifyTelegramChannelAccess/);
});
