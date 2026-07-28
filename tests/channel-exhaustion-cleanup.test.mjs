import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fastBilling = readFileSync("src/lib/channelFastBilling.ts", "utf8");
const settlement = readFileSync("src/lib/channelSettlement.ts", "utf8");
const deletion = readFileSync("src/lib/campaignPostDeletion.ts", "utf8");
const processAds = readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
const advertiserRoute = readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts", "utf8");
const broadcastWorker = readFileSync("src/app/api/cron/process-broadcast/route.ts", "utf8");
const lifecycle = readFileSync("src/lib/campaignLifecycle.ts", "utf8");

test("fast billing commits exhaustion before invoking channel cleanup", () => {
  assert.match(fastBilling, /becameExhausted = budget \+ 1e-10 < unitPrice/);
  assert.match(fastBilling, /markCampaignBudgetExhausted\(post\.campaign_id, input\.conn\)/);
  for (const functionName of ["debitChannelClick", "debitConfirmedChannelViews"]) {
    const start = fastBilling.indexOf(`export async function ${functionName}`);
    const end = fastBilling.indexOf("\nexport async function", start + 1);
    const block = fastBilling.slice(start, end < 0 ? fastBilling.length : end);
    assert.ok(block.indexOf("await conn.commit()") < block.indexOf("cleanupAfterFastDebit(result)"));
    assert.ok(block.indexOf("conn.release()") < block.indexOf("cleanupAfterFastDebit(result)"));
  }
});

test("settlement exhaustion commits before cleanup and cleanup failures cannot roll it back", () => {
  const transactionCommit = settlement.indexOf("await connection.commit()");
  const cleanupLoop = settlement.indexOf("for (const [campaignId, campaign] of exhausted)");
  assert.ok(transactionCommit >= 0 && cleanupLoop > transactionCommit);
  assert.match(settlement, /deleteExhaustedChannelCampaignPosts\(campaignId\)/);
  assert.match(settlement, /catch \(error\)[\s\S]*Post-commit channel exhaustion cleanup failed/);
  assert.doesNotMatch(settlement, /Skipping exhausted campaign post deletion because unsettled engagement remains/);
});

test("exhaustion cleanup selects only exhausted CHANNEL posts and never BOT deliveries", () => {
  assert.match(deletion, /c\.type IN \('views', 'clicks'\)/);
  assert.match(deletion, /requiredCampaignStatus: "budget_exhausted"/);
  assert.match(deletion, /filters\.push\("c\.status = \?"\)/);
  assert.match(lifecycle, /SET cp\.status = 'cleanup_pending'/);
  assert.match(lifecycle, /c\.type IN \('views', 'clicks'\)/);
  assert.match(lifecycle, /c\.status = 'budget_exhausted'/);
  assert.doesNotMatch(deletion, /broadcast_deliveries/);
  assert.doesNotMatch(broadcastWorker, /deleteExhaustedChannelCampaignPosts|deleteActiveCampaignPosts/);
});

test("cleanup persists success, failure, retry state, and bounded idempotency", () => {
  assert.match(deletion, /status = 'cleanup_pending'/);
  assert.match(deletion, /cleanup_status = 'success'/);
  assert.match(deletion, /status = 'delete_failed'/);
  assert.match(deletion, /cleanup_status = \?/);
  assert.match(deletion, /cleanup_retry_count = COALESCE\(cleanup_retry_count, 0\) \+ 1/);
  assert.match(deletion, /MAX_CLEANUP_RETRY_RUNS = 5/);
  assert.match(deletion, /COALESCE\(cp\.cleanup_retry_count, 0\) < \?/);
  assert.match(deletion, /cp\.cleanup_status = 'retry' OR cp\.status = 'cleanup_pending'/);
  assert.match(deletion, /MESSAGE_NOT_FOUND/);
  assert.match(deletion, /cp\.deleted_at IS NULL/);
});

test("multiple cleanup failures remain independent and retryable", () => {
  assert.match(deletion, /for \(const post of posts\)/);
  assert.match(deletion, /catch \(postErr: unknown\)/);
  assert.match(deletion, /await recordDeleteFailure\(post\.id, 0, reason, columns, "retry"\)/);
  assert.match(deletion, /export async function retryCampaignPostCleanup/);
});

test("stale process-ads placement rechecks active status under lock before insertion", () => {
  const lock = processAds.indexOf("SELECT status, budget, cpm, cpc, type, daily_budget_limit FROM campaigns WHERE id = ? FOR UPDATE");
  const statusCheck = processAds.indexOf('lockedCampaign?.status !== "active"', lock);
  const insert = processAds.indexOf("INSERT INTO campaign_posts", statusCheck);
  assert.ok(lock >= 0 && statusCheck > lock && insert > statusCheck);
});

test("pause cleanup remains distinct from exhaustion cleanup", () => {
  assert.match(advertiserRoute, /settleCampaignEngagementBeforeDeletion\(Number\(id\), "advertiser_pause"\)/);
  assert.match(advertiserRoute, /deleteActiveCampaignPosts\(id\)/);
  assert.doesNotMatch(deletion, /resume_locked_until|paused_at/);
});
