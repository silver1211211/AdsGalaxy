import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const actionSpec = readFileSync("src/lib/campaignLifecycleActions.ts", "utf8");
const adminActionRoute = readFileSync("src/app/api/admin/campaigns/[id]/actions/route.ts", "utf8");
const settlement = readFileSync("src/lib/channelSettlement.ts", "utf8");
const cleanup = readFileSync("src/lib/campaignPostDeletion.ts", "utf8");
const retryCleanupCron = readFileSync("src/app/api/cron/retry-telegram-cleanup/route.ts", "utf8");
const retryCleanupEndpoint = readFileSync("src/app/api/admin/campaigns/[id]/cleanup/retry/route.ts", "utf8");
const adminPage = readFileSync("src/app/admin/campaigns/[id]/page.tsx", "utf8");
const adminOperations = readFileSync("src/lib/campaignAdminOperations.ts", "utf8");
const settlementSummaryRoute = readFileSync("src/app/api/admin/campaigns/[id]/settlement-summary/route.ts", "utf8");
const deliveryStatusRoute = readFileSync("src/app/api/admin/campaigns/[id]/delivery-status/route.ts", "utf8");
const cleanupErrorsRoute = readFileSync("src/app/api/admin/campaigns/[id]/cleanup-errors/route.ts", "utf8");
const adminCampaignRoute = readFileSync("src/app/api/admin/campaigns/[id]/route.ts", "utf8");
const advertiserCampaignRoute = readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts", "utf8");

function actionBlock(action) {
  return actionSpec.match(new RegExp(`${action}:\\s*{(?<body>[\\s\\S]*?)\\n  },`))?.groups?.body || "";
}

test("pause_only stops delivery without settlement, stats refresh, or cleanup", () => {
  const block = actionBlock("pause_only");
  assert.match(block, /stopsDelivery:\s*true/);
  assert.match(block, /refreshesTelegramStats:\s*false/);
  assert.match(block, /settlesFinancials:\s*false/);
  assert.match(block, /cleansTelegramPosts:\s*false/);
  assert.match(adminActionRoute, /admin_pause_only/);
});

test("legacy pause, pause_finalize, and delete finalize before cleanup/delete", () => {
  for (const action of ["pause", "pause_finalize", "delete"]) {
    const block = actionBlock(action);
    assert.match(block, /stopsDelivery:\s*true/);
    assert.match(block, /refreshesTelegramStats:\s*true/);
    assert.match(block, /settlesFinancials:\s*true/);
    assert.match(block, /cleansTelegramPosts:\s*true/);
  }
  assert.match(adminActionRoute, /if \(spec\.settlesFinancials\)/);
  assert.match(adminActionRoute, /if \(spec\.cleansTelegramPosts\)/);
  assert.ok(adminActionRoute.indexOf("if (spec.settlesFinancials)") < adminActionRoute.indexOf("if (spec.cleansTelegramPosts)"));
  assert.ok(adminActionRoute.indexOf("if (spec.settlesFinancials)") < adminActionRoute.indexOf('if (lifecycleAction === "delete")'));
});

test("admin resume allows paused campaigns, blocks terminal statuses, and preserves finalization metadata", () => {
  assert.match(adminActionRoute, /const terminalStatuses = \["deleted", "completed", "rejected", "budget_exhausted"\]/);
  assert.match(adminActionRoute, /if \(campaign\.status !== "paused"\)/);
  assert.match(adminActionRoute, /pause_reason = NULL/);
  assert.match(adminActionRoute, /resume_locked_until = NULL/);
  assert.doesNotMatch(adminActionRoute, /channel_settlement_finalized_at = NULL/);
});

test("paused campaigns with live posts remain settlement eligible", () => {
  assert.match(settlement, /campaignStatuses\?: Array<"active" \| "paused">/);
  assert.match(settlement, /options\.campaignStatuses\?\.length \? options\.campaignStatuses : \["active", "paused"\]/);
  assert.match(settlement, /WHERE c\.status IN/);
  assert.match(settlement, /includePausedCampaign \? \["active", "paused"\] : \["active"\]/);
});

test("settlement keeps click accounting and idempotency source-key protections", () => {
  assert.match(settlement, /\(SELECT COUNT\(\*\) FROM campaign_clicks cc WHERE cc\.post_id = cp\.id\) AS current_clicks/);
  assert.match(settlement, /channel_settlement_ledger/);
  assert.match(settlement, /old_settled_count/);
  assert.match(settlement, /settled_through/);
});

test("cleanup retry surfaces do not run settlement or financial writes", () => {
  assert.match(retryCleanupCron, /retryCampaignPostCleanup/);
  assert.match(retryCleanupEndpoint, /retryCampaignPostCleanup/);
  assert.doesNotMatch(retryCleanupCron, /settleChannelCampaigns|settlePendingChannelPublisherCredits|channelSettlement|channelFastBilling/);
  assert.doesNotMatch(retryCleanupEndpoint, /settleChannelCampaigns|settlePendingChannelPublisherCredits|channelSettlement|channelFastBilling/);
});

test("Telegram cleanup stores best-effort states and classifies non-fatal errors", () => {
  for (const code of [
    "CHAT_NOT_FOUND",
    "CHANNEL_INVALID",
    "MESSAGE_NOT_FOUND",
    "BOT_REMOVED",
    "BOT_IS_NOT_MEMBER",
    "CHAT_ADMIN_REQUIRED",
    "MESSAGE_CANT_BE_DELETED",
    "MESSAGE_ID_INVALID",
    "PEER_ID_INVALID",
    "403_FORBIDDEN",
  ]) {
    assert.match(cleanup, new RegExp(code));
  }
  assert.match(cleanup, /cleanup_status = 'pending'/);
  assert.match(cleanup, /cleanup_status = 'success'/);
  assert.match(cleanup, /cleanupStatus === "retry"/);
  assert.match(cleanup, /cleanup_retry_count = COALESCE\(cleanup_retry_count, 0\) \+ 1/);
});

test("admin UI exposes Phase 1 lifecycle actions", () => {
  assert.match(adminPage, /openActionConfirm\("pause_only"\)/);
  assert.match(adminPage, /Pause \+ Finalize/);
  assert.match(adminPage, /openActionConfirm\("retry_cleanup"\)/);
  assert.match(adminPage, /Cleanup Status/);
});

test("force refresh statistics updates stats without settlement", () => {
  const block = actionBlock("force_refresh_stats");
  assert.match(block, /refreshesTelegramStats:\s*true/);
  assert.match(block, /settlesFinancials:\s*false/);
  assert.match(adminOperations, /forceRefreshCampaignStatistics/);
  assert.match(adminOperations, /refreshCampaignViews\(campaignId, 500\)/);
  assert.match(adminOperations, /GREATEST\(\s*COALESCE\(cp\.clicks, 0\)/);
  assert.doesNotMatch(adminOperations.match(/export async function forceRefreshCampaignStatistics[\s\S]*?^}/m)?.[0] || "", /settleChannelCampaigns|settlePendingChannelPublisherCredits|channel_settlement_ledger/);
});

test("force settlement uses existing settlement engine and does not fetch Telegram", () => {
  const block = actionBlock("force_settlement");
  assert.match(block, /refreshesTelegramStats:\s*false/);
  assert.match(block, /settlesFinancials:\s*true/);
  const settleBlock = adminOperations.match(/export async function forceSettleCampaignDeltas[\s\S]*?^}/m)?.[0] || "";
  assert.match(settleBlock, /settleChannelCampaigns/);
  assert.match(settleBlock, /campaignStatuses:\s*\["active", "paused"\]/);
  assert.doesNotMatch(settleBlock, /refreshCampaignViews|getPrivatePostViews|PHP_VIEWS_API_URL|fetch\(/);
});

test("refresh and settle runs refresh before settlement", () => {
  const block = adminOperations.match(/export async function refreshAndSettleCampaign[\s\S]*?^}/m)?.[0] || "";
  assert.ok(block.indexOf("forceRefreshCampaignStatistics") < block.indexOf("forceSettleCampaignDeltas"));
});

test("Phase 2 admin action route audits new operations", () => {
  for (const action of ["force_refresh_stats", "force_settlement", "refresh_and_settle"]) {
    assert.match(adminActionRoute, new RegExp(`lifecycleAction === "${action}"`));
  }
  assert.match(adminActionRoute, /campaign_force_refresh_stats/);
  assert.match(adminActionRoute, /campaign_force_settlement/);
  assert.match(adminActionRoute, /campaign_refresh_and_settle/);
});

test("Phase 2 summary endpoints require admin permission", () => {
  for (const route of [settlementSummaryRoute, deliveryStatusRoute, cleanupErrorsRoute]) {
    assert.match(route, /requireAdminPermission\("operate"\)/);
  }
  assert.match(settlementSummaryRoute, /getCampaignSettlementSummary/);
  assert.match(deliveryStatusRoute, /getCampaignDeliveryStatus/);
  assert.match(cleanupErrorsRoute, /getCampaignCleanupErrors/);
});

test("admin UI exposes Phase 2 controls and visibility cards", () => {
  for (const action of ["force_refresh_stats", "force_settlement", "refresh_and_settle"]) {
    assert.match(adminPage, new RegExp(`openActionConfirm\\("${action}"\\)`));
  }
  assert.match(adminPage, /Settlement Summary/);
  assert.match(adminPage, /Delivery Status/);
  assert.match(adminPage, /Cleanup Errors/);
});

test("advertiser pause finalizes, locks resume for one hour, and keeps cleanup best-effort", () => {
  assert.match(advertiserCampaignRoute, /settleCampaignEngagementBeforeDeletion\(Number\(id\), "advertiser_pause"\)/);
  assert.match(advertiserCampaignRoute, /resume_locked_until = DATE_ADD\(NOW\(\), INTERVAL 1 HOUR\)/);
  assert.match(advertiserCampaignRoute, /pause_reason = 'user_paused'/);
  assert.match(advertiserCampaignRoute, /lockedUntil\.getTime\(\) > Date\.now\(\)/);
  assert.doesNotMatch(advertiserCampaignRoute, /BOT_TOKEN is missing; cannot delete active posts safely/);
});

test("admin campaign edit uses existing details route, whitelist, and audit logging", () => {
  assert.equal(existsSync("src/app/api/admin/campaigns/[id]/edit/route.ts"), false);
  assert.doesNotMatch(adminPage, /\/edit/);
  assert.match(adminCampaignRoute, /export async function PATCH/);
  assert.match(adminCampaignRoute, /EDITABLE_CAMPAIGN_FIELDS/);
  assert.match(adminCampaignRoute, /Unknown or read-only field/);
  assert.match(adminCampaignRoute, /campaign_edit/);
  assert.match(adminCampaignRoute, /old_values/);
  assert.match(adminCampaignRoute, /new_values/);
  for (const field of ["budget", "channel_spend", "settled_views", "settled_clicks", "status"]) {
    assert.doesNotMatch(adminCampaignRoute, new RegExp(`${field}: \\{`));
  }
});

test("admin campaign page has mobile containment for actions and tables", () => {
  assert.match(adminPage, /max-w-full min-w-0 overflow-x-hidden/);
  assert.match(adminPage, /overflow-x-auto pb-1/);
  assert.match(adminPage, /overflow-x-auto/);
  assert.match(adminPage, /grid grid-cols-1 sm:grid-cols-2/);
});
