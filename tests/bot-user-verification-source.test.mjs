import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const publisherImport = read("src/app/api/publisher/bots/[id]/users/route.ts");
const adminImport = read("src/app/api/admin/bots/[id]/users/manual/route.ts");
const integration = read("src/app/api/bot/integration/[botId]/[secret]/route.ts");
const audience = read("src/lib/botAudience.ts");
const worker = read("src/lib/botUserVerification.ts");
const broadcast = read("src/app/api/cron/process-broadcast/route.ts");
const migration = read("db/migrations/20260711_0102_bot_user_verification.sql");
const deployment = read("deploy-vps.sh");
const cleanup = read("src/lib/campaignPostDeletion.ts");
const manualPopup = read("src/components/publisher/ManualAddUsersPopup.tsx");
const botDetails = read("src/components/publisher/BotDetailsScreen.tsx");
const publisherBots = read("src/app/api/publisher/bots/route.ts");

test("manual imports are pending while integration users activate by bot_id and chat_id", () => {
  assert.match(publisherImport, /id === ownerTelegramId \? "active" : "pending_verification"/);
  assert.match(adminImport, /isOwner \? "active" : "pending_verification"/);
  assert.match(integration, /WHERE bot_id = \? AND chat_id = \?/);
  assert.doesNotMatch(integration, /user_id = \? OR chat_id = \?/);
  assert.match(integration, /status = 'active'/);
  assert.match(integration, /is_active = TRUE/);
});

test("bot owner is activated without entering any outbound audience", () => {
  assert.match(publisherImport, /id === ownerTelegramId/);
  assert.match(adminImport, /user\.id === ownerTelegramId/);
  assert.match(audience, /export function botOwnerExclusionCondition/);
  assert.match(audience, /CAST\(bot_owner\.telegram_id AS CHAR\) = CAST\(\$\{userAlias\}\.chat_id AS CHAR\)/);
  assert.match(broadcast, /botUserBroadcastEligibleCondition/);
  assert.match(worker, /CAST\(bu\.chat_id AS CHAR\) <> CAST\(owner\.telegram_id AS CHAR\)/);
});

test("verification payload and success, permanent failure, and retry states are fixed", () => {
  assert.match(worker, /https:\/\/i\.ibb\.co\/sd79Stcx\/IMG-4980\.jpg/);
  assert.match(worker, /🌌 <b>Discover AdsGalaxy<\/b>/);
  assert.match(worker, /parse_mode: "HTML"/);
  assert.match(worker, /https:\/\/t\.me\/Ads_Galaxy_bot\?startapp=REF770190998629F/);
  assert.match(worker, /SET status = 'active', is_active = TRUE/);
  assert.match(worker, /SET status = 'inactive', is_active = FALSE/);
  assert.match(worker, /export function classifyTelegramRecipientFailure/);
  assert.match(worker, /SET verification_last_error = \?, verification_next_attempt_at = \?/);
});

test("verification queue prevents concurrent sends and never requeues successful users", () => {
  for (const column of ["verification_attempt_count", "verification_last_attempt_at", "verification_next_attempt_at", "verification_last_error", "verification_success_at", "verification_message_id", "verification_claim_token", "verification_claim_expires_at"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(worker, /verification_claim_expires_at = DATE_ADD\(NOW\(\), INTERVAL 5 MINUTE\)/);
  assert.match(worker, /bu\.status = 'pending_verification'/);
  assert.match(worker, /bu\.source IN \('manual_publisher', 'manual_admin'\)/);
  assert.match(worker, /verification_claim_token IS NULL OR bu\.verification_claim_expires_at < NOW\(\)/);
  assert.doesNotMatch(worker, /advertiser|publisher_earn|settlement|balance|budget/);
});

test("deployment applies verification schema and installs each managed recovery route once", () => {
  const migrationOrder = [
    "20260710_0100_campaign_status_compatibility.sql",
    "20260710_0101_broadcast_payout_configuration.sql",
    "20260711_0102_bot_user_verification.sql",
  ].map((name) => deployment.indexOf(`\"${name}\"`));
  assert.ok(migrationOrder.every((position) => position >= 0));
  assert.ok(migrationOrder[0] < migrationOrder[1] && migrationOrder[1] < migrationOrder[2]);
  assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS[\s\S]*verification_attempt_count/);
  assert.match(migration, /INFORMATION_SCHEMA\.STATISTICS/);
  assert.match(deployment, /echo "\*\/5 \* \* \* \* \$CRON_BASE\/verify-bot-users/);
  assert.match(deployment, /echo "\* \* \* \* \* \$CRON_BASE\/retry-telegram-cleanup/);
  assert.match(deployment, /grep -Ev '[^\n]*verify-bot-users/);
});

test("campaign post deletion makes at most two attempts and bypasses permanent failures", () => {
  assert.match(cleanup, /const MAX_DELETE_ATTEMPTS = 2;/);
  assert.match(cleanup, /if \(!classification\.retryable\) break;/);
  assert.match(cleanup, /for \(const post of posts\)[\s\S]*try \{[\s\S]*catch \(postErr/);
  for (const permanentCode of ["MESSAGE_NOT_FOUND", "MESSAGE_CANT_BE_DELETED", "BOT_IS_NOT_MEMBER", "CHAT_ADMIN_REQUIRED", "CHAT_NOT_FOUND"]) {
    assert.match(cleanup, new RegExp(`${permanentCode}[\\s\\S]*?retryable: false`));
  }
});

test("publisher-visible counts hide pending users without changing internal queue state", () => {
  assert.match(audience, /export function botUserPublisherVisibleCondition/);
  assert.match(audience, /status = '\$\{BOT_USER_VERIFIED_STATUS\}' OR/);
  assert.match(audience, /SUM\(CASE WHEN \$\{botUserPublisherVisibleCondition\("bu"\)\} THEN 1 ELSE 0 END\) AS total_users/);
  assert.match(publisherBots, /botUserCountExpressions\("b", \{ publisherVisible: true \}\)/);
  assert.match(publisherImport, /pending_verification/);
  assert.match(worker, /SET status = 'active', is_active = TRUE/);
  assert.match(worker, /SET status = 'inactive', is_active = FALSE/);
  assert.match(audience, /status <> '\$\{BOT_USER_PENDING_STATUS\}'/);
});

test("manual import shows queue progress, prevents duplicates, closes, and refreshes after success", () => {
  assert.match(manualPopup, /User verification in progress\.\.\./);
  assert.match(manualPopup, /if \(loading \|\| queued \|\| parsed\.numeric\.length === 0\) return/);
  assert.match(manualPopup, /if \(!response\.ok\) throw new Error/);
  assert.match(manualPopup, /setTimeout\(\(\) => \{[\s\S]*onClose\(\);[\s\S]*onAdded\?\.\(\)/);
  assert.match(manualPopup, /parsed\.invalid\.length > 0/);
  assert.match(botDetails, /onAdded=\{\(\) => setDetailsRefreshKey/);
});
