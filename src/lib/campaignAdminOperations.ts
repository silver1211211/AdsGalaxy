import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { refreshCampaignViews } from "@/lib/channelAdminViewRefresh";
import { retryCampaignPostCleanup } from "@/lib/campaignPostDeletion";
import { settlePendingChannelPublisherCredits } from "@/lib/channelFastBilling";
import { settleChannelCampaigns, type ChannelSettlementResult } from "@/lib/channelSettlement";

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function campaignPostColumns() {
  const [rows] = await pool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'campaign_posts'`
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function countEligibleRefreshPosts(campaignId: number) {
  const [[row]] = await pool.query<Array<RowDataPacket & { total: number | string }>>(
    `SELECT COUNT(*) AS total
     FROM campaign_posts cp
     JOIN channels ch ON ch.id = cp.channel_id
     WHERE cp.campaign_id = ?
       AND cp.status = 'active'
       AND cp.deleted_at IS NULL
       AND cp.delivery_failed_at IS NULL
       AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.message_id IS NOT NULL
       AND ch.is_deleted = FALSE`,
    [campaignId]
  );
  return numberValue(row?.total);
}

async function syncStoredClickTotalsIfSupported(campaignId: number) {
  const columns = await campaignPostColumns();
  if (!columns.has("clicks")) {
    return { supported: false, postsUpdated: 0 };
  }

  const [result] = await pool.query(
    `UPDATE campaign_posts cp
     SET cp.clicks = GREATEST(
       COALESCE(cp.clicks, 0),
       (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id)
     )
     WHERE cp.campaign_id = ?`,
    [campaignId]
  );
  return {
    supported: true,
    postsUpdated: "affectedRows" in result ? Number(result.affectedRows || 0) : 0,
  };
}

export async function forceRefreshCampaignStatistics(campaignId: number) {
  const eligible = await countEligibleRefreshPosts(campaignId);
  const views = await refreshCampaignViews(campaignId, 500);
  const clicks = await syncStoredClickTotalsIfSupported(campaignId);
  return {
    postsChecked: views.checked,
    postsUpdated: views.updated,
    failedFetches: views.failed,
    skippedPosts: Math.max(0, eligible - views.checked),
    errors: views.errors,
    clickTotals: clicks,
  };
}

export function summarizeChannelSettlement(result: ChannelSettlementResult, pendingCredits?: Awaited<ReturnType<typeof settlePendingChannelPublisherCredits>> | null) {
  const totalUnitsSettled = result.details.reduce((sum, detail) => sum + detail.new_views + detail.new_clicks, 0);
  return {
    candidates: result.candidates,
    settledPosts: result.settledPosts,
    failedPosts: result.failedPosts,
    totalUnitsSettled,
    advertiserDebited: result.advertiserDebited,
    publisherCredited: result.publisherCredited,
    platformRevenue: result.platformRevenue,
    reserve: result.reserveAmount,
    failedDetails: result.failedDetails,
    pendingFastDebitCredits: pendingCredits || null,
  };
}

export async function forceSettleCampaignDeltas(campaignId: number) {
  const pendingCredits = await settlePendingChannelPublisherCredits({ campaignId, limit: 5000 });
  const settlement = await settleChannelCampaigns({
    campaignId,
    skipGlobalMaintenance: true,
    campaignStatuses: ["active", "paused"],
  });
  return summarizeChannelSettlement(settlement, pendingCredits);
}

export async function refreshAndSettleCampaign(campaignId: number) {
  const refresh = await forceRefreshCampaignStatistics(campaignId);
  const settlement = await forceSettleCampaignDeltas(campaignId);
  return { refresh, settlement };
}

export async function retryFailedCampaignCleanup(campaignId: number) {
  const result = await retryCampaignPostCleanup(campaignId);
  return {
    attempted: result.checked,
    deleted: result.deleted,
    stillFailed: result.failed + result.retry,
    failed: result.failed,
    retry: result.retry,
    skipped: result.skipped,
    errorDetails: result.details.filter((item) => item.status !== "deleted"),
    raw: result,
  };
}

export async function getCampaignSettlementSummary(campaignId: number) {
  const [[row]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT
       COUNT(cp.id) AS total_posts,
       SUM(CASE WHEN cp.status IN ('active','posted','sent','pending_delivery') THEN 1 ELSE 0 END) AS active_posts,
       SUM(CASE WHEN cp.status = 'deleted' OR cp.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_posts,
       SUM(CASE WHEN cp.status = 'delete_failed' OR cp.delete_failed_reason IS NOT NULL OR cp.cleanup_status IN ('failed','retry') THEN 1 ELSE 0 END) AS failed_cleanup_posts,
       COALESCE(SUM(cp.views), 0) AS total_views,
       COALESCE(SUM(cp.settled_views), 0) AS settled_views,
       COALESCE(SUM(GREATEST(COALESCE(cp.views, 0) - COALESCE(cp.settled_views, 0), 0)), 0) AS unsettled_views,
       COALESCE(SUM((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id)), 0) AS total_clicks,
       COALESCE(SUM(cp.settled_clicks), 0) AS settled_clicks,
       COALESCE(SUM(GREATEST((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) - COALESCE(cp.settled_clicks, 0), 0)), 0) AS unsettled_clicks,
       COALESCE(c.channel_spend, 0) AS total_spend,
       COALESCE(c.channel_publisher_earnings, 0) AS publisher_earnings,
       COALESCE(c.channel_platform_revenue, 0) AS platform_revenue,
       COALESCE(c.channel_reserve_amount, 0) AS reserve,
       COALESCE(c.budget, 0) AS campaign_budget_remaining,
       (SELECT MAX(created_at) FROM channel_settlement_ledger WHERE campaign_id = c.id) AS last_settlement_time
     FROM campaigns c
     LEFT JOIN campaign_posts cp ON cp.campaign_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
    [campaignId]
  );

  return {
    totalPosts: numberValue(row?.total_posts),
    activePosts: numberValue(row?.active_posts),
    deletedPosts: numberValue(row?.deleted_posts),
    failedCleanupPosts: numberValue(row?.failed_cleanup_posts),
    totalViews: numberValue(row?.total_views),
    settledViews: numberValue(row?.settled_views),
    unsettledViews: numberValue(row?.unsettled_views),
    totalClicks: numberValue(row?.total_clicks),
    settledClicks: numberValue(row?.settled_clicks),
    unsettledClicks: numberValue(row?.unsettled_clicks),
    totalSpend: numberValue(row?.total_spend),
    publisherEarnings: numberValue(row?.publisher_earnings),
    platformRevenue: numberValue(row?.platform_revenue),
    reserve: numberValue(row?.reserve),
    campaignBudgetRemaining: numberValue(row?.campaign_budget_remaining),
    lastSettlementTime: row?.last_settlement_time || null,
    failedSettlementDetails: [],
  };
}

export async function getCampaignDeliveryStatus(campaignId: number) {
  const [[campaign]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT id, status, budget, daily_budget_limit, type
     FROM campaigns
     WHERE id = ?`,
    [campaignId]
  );
  const [[posts]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT
       COUNT(*) AS post_count,
       MAX(delivery_attempted_at) AS last_delivery_attempt,
       MAX(delivery_confirmed_at) AS last_successful_delivery,
       SUM(CASE WHEN delivery_failed_at IS NOT NULL OR status = 'delivery_failed' THEN 1 ELSE 0 END) AS delivery_failures
     FROM campaign_posts
     WHERE campaign_id = ?`,
    [campaignId]
  );
  const [[channels]] = await pool.query<Array<RowDataPacket & { eligible_channels: number | string }>>(
    `SELECT COUNT(*) AS eligible_channels
     FROM channels
     WHERE status = 'active'
       AND is_deleted = FALSE`,
    []
  );
  const [[dailySpend]] = await pool.query<Array<RowDataPacket & { spend: number | string }>>(
    `SELECT
       COALESCE((SELECT SUM(advertiser_debit) FROM channel_settlement_ledger WHERE campaign_id = ? AND created_at >= CURDATE()), 0)
       + COALESCE((SELECT SUM(advertiser_debit) FROM channel_advertiser_debits WHERE campaign_id = ? AND created_at >= CURDATE()), 0) AS spend`,
    [campaignId, campaignId]
  );

  const status = String(campaign?.status || "missing");
  const budget = numberValue(campaign?.budget);
  const dailyLimit = numberValue(campaign?.daily_budget_limit);
  const dailyRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - numberValue(dailySpend?.spend)) : null;
  const eligibleChannels = numberValue(channels?.eligible_channels);
  const skippedReasons: string[] = [];
  if (status !== "active") skippedReasons.push(`campaign_status_${status}`);
  if (budget <= 0) skippedReasons.push("budget_empty");
  if (dailyRemaining !== null && dailyRemaining <= 0) skippedReasons.push("daily_budget_exhausted");
  if (eligibleChannels <= 0) skippedReasons.push("no_eligible_channels");

  return {
    campaignStatus: status,
    budget,
    dailyBudgetRemaining: dailyRemaining,
    postCount: numberValue(posts?.post_count),
    eligibleChannels,
    skippedReasons,
    lastDeliveryAttempt: posts?.last_delivery_attempt || null,
    lastSuccessfulDelivery: posts?.last_successful_delivery || null,
    deliveryFailures: numberValue(posts?.delivery_failures),
    wouldProcessAdsPickCampaign: skippedReasons.length === 0 && campaign?.type !== "broadcast",
  };
}

export async function getCampaignCleanupErrors(campaignId: number) {
  const [rows] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT
       cp.id AS post_id,
       cp.channel_id,
       cp.channel_username,
       cp.message_id,
       cp.delete_failed_reason,
       cp.cleanup_error,
       cp.delete_attempts,
       cp.cleanup_retry_count,
       cp.delete_failed_at,
       cp.cleanup_status
     FROM campaign_posts cp
     WHERE cp.campaign_id = ?
       AND (
         cp.status = 'delete_failed'
         OR cp.delete_failed_reason IS NOT NULL
         OR cp.cleanup_status IN ('failed','retry')
         OR cp.cleanup_error IS NOT NULL
       )
     ORDER BY COALESCE(cp.delete_failed_at, cp.cleanup_attempted_at, cp.created_at) DESC
     LIMIT 200`,
    [campaignId]
  );

  return rows.map((row) => {
    const error = String(row.cleanup_error || row.delete_failed_reason || "");
    const retryable = String(row.cleanup_status || "") === "retry" || /RATE_LIMITED|TEMPORARY|TIMEOUT|MISSING_BOT_TOKEN/i.test(error);
    return {
      postId: Number(row.post_id),
      channelId: Number(row.channel_id),
      channelUsername: row.channel_username || null,
      messageId: row.message_id || null,
      error: error || null,
      attempts: numberValue(row.cleanup_retry_count || row.delete_attempts),
      deleteFailedAt: row.delete_failed_at || null,
      retryAvailable: retryable,
      likelyPermanent: !retryable,
      cleanupStatus: row.cleanup_status || null,
    };
  });
}
