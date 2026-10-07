import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("all normal Admin campaign identity routes enforce Main scope", () => {
  for (const path of [
    "src/app/api/admin/campaigns/route.ts",
    "src/app/api/admin/campaigns/[id]/route.ts",
    "src/app/api/admin/campaigns/[id]/actions/route.ts",
    "src/app/api/admin/campaigns/[id]/emergency-push/route.ts",
    "src/app/api/admin/audits/route.ts",
    "src/app/api/admin/broadcast-audits/route.ts",
    "src/app/api/admin/dashboard/route.ts",
    "src/app/api/admin/dashboard/summary/route.ts",
    "src/app/api/admin/production-safety/route.ts",
    "src/app/api/admin/revenue-protection/route.ts",
  ]) assert.match(read(path), /mainCampaignScopeSql/);
});

test("secondary Main channel statistics and readiness exclude Silver posts", () => {
  for (const path of [
    "src/app/api/admin/availability/route.ts",
    "src/app/api/admin/inventory-optimization/route.ts",
    "src/app/api/admin/channels/[id]/actions/route.ts",
  ]) assert.match(read(path), /mainCampaignScopeSql/);
  const logs = read("src/app/api/admin/system-logs/route.ts");
  assert.match(logs, /campaign_admin_isolation/);
  assert.match(logs, /campaign_placement_distribution/);
  assert.match(logs, /silverCampaignIds/);
});

test("scheduled allocation filters owner exemptions before scoring and rechecks before Telegram", () => {
  const scheduler = read("src/app/api/cron/process-ads/route.ts");
  const early = scheduler.indexOf("silverExemptPairs.has");
  const score = scheduler.indexOf("calculateCampaignScore", early);
  const finalGuard = scheduler.indexOf("isChannelAllowedForCampaign", score);
  const send = scheduler.lastIndexOf("sendTelegramMessageWithRetries");
  assert.ok(early >= 0 && score > early && finalGuard > score && send > finalGuard);
});

test("public and private Silver exemption is based only on persistent channel owner", () => {
  const control = read("src/lib/silverCampaignControl.ts");
  assert.match(control, /seu\.user_id=ch\.user_id/);
  assert.doesNotMatch(control, /seu\.(?:username|chat_id)/);
});

test("cleanup keeps DB rows and retries through existing cleanup lifecycle", () => {
  const cleanup = read("src/lib/campaignPostDeletion.ts");
  assert.match(cleanup, /deleteCampaignPostsByIds/);
  assert.match(cleanup, /requiredSilverExemptUserId/);
  assert.match(cleanup, /campaign_admin_isolation/);
  assert.match(cleanup, /cleanup_pending/);
  assert.match(cleanup, /cleanupStatus: lastRetryable \? "retry"/);
  assert.doesNotMatch(cleanup, /DELETE FROM campaign_posts/);
});
