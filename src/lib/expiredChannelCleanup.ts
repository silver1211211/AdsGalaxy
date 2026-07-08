import pool from "@/lib/db";
import type { ResultSetHeader } from "mysql2/promise";
import { deleteCampaignPosts, getConfiguredPostLifetimeHours, markStalePendingDeliveryPosts } from "@/lib/campaignPostDeletion";
import { settlePendingChannelPublisherCredits } from "@/lib/channelFastBilling";
import { settleChannelCampaigns } from "@/lib/channelSettlement";

const MAX_POSTS_PER_RUN = Math.min(50, Math.max(1, Number.parseInt(process.env.DELETE_EXPIRED_POSTS_LIMIT || "30", 10) || 30));
const DELETE_DELAY_MS = Math.min(5_000, Math.max(100, Number.parseInt(process.env.DELETE_EXPIRED_POSTS_DELAY_MS || "500", 10) || 500));

export async function cleanupExpiredChannelPosts() {
  const pendingRecovery = await markStalePendingDeliveryPosts(
    Number.parseInt(process.env.PENDING_DELIVERY_TIMEOUT_MINUTES || "10", 10)
  );
  const settlement = await settleChannelCampaigns({ skipGlobalMaintenance: true });
  if (settlement.failedPosts > 0) {
    console.warn("Expired channel post cleanup stopped before deletion because settlement failed", {
      failed_posts: settlement.failedPosts,
      failed_details: settlement.failedDetails,
    });
    return {
      success: false,
      status: 409,
      body: {
        success: false,
        message: "expired_post_settlement_failed",
        settlement,
        pending_recovery: pendingRecovery,
      },
    };
  }
  const fastDebitPublisherSettlement = await settlePendingChannelPublisherCredits();
  console.info("Expired channel post cleanup settlement-before-delete complete", {
    classic_candidates: settlement.candidates,
    classic_settled_posts: settlement.settledPosts,
    fast_debit_candidates: fastDebitPublisherSettlement.candidates,
    fast_debit_settled: fastDebitPublisherSettlement.settled,
  });

  const lifetimeHours = await getConfiguredPostLifetimeHours();
  const summary = await deleteCampaignPosts({
    olderThan24Hours: true,
    lifetimeHours,
    batchSize: MAX_POSTS_PER_RUN,
    maxPostsPerRun: MAX_POSTS_PER_RUN,
    batchDelayMs: DELETE_DELAY_MS,
  });

  return {
    success: true,
    status: 200,
    body: {
      success: true,
      lifetime_hours: lifetimeHours,
      max_posts_per_run: MAX_POSTS_PER_RUN,
      delay_ms: DELETE_DELAY_MS,
      checked: summary.checked,
      deleted: summary.deleted,
      failed: summary.failed,
      retry: summary.retry,
      skipped: summary.skipped,
      failed_ids: summary.failedIds,
      pending_recovery: pendingRecovery,
      settlement,
      fast_debit_publisher_settlement: fastDebitPublisherSettlement,
      details: summary.details,
    },
  };
}

export async function cleanupExpiredChannelViewRuns() {
  const settlement = await settleChannelCampaigns({ skipGlobalMaintenance: true });
  if (settlement.failedPosts > 0) {
    return {
      success: false,
      status: 409,
      body: {
        success: false,
        message: "channel_view_cleanup_settlement_failed",
        settlement,
      },
    };
  }

  const retentionDays = Math.max(7, Number.parseInt(process.env.CHANNEL_VIEW_FETCH_RUN_RETENTION_DAYS || "30", 10) || 30);
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM channel_view_fetch_runs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [retentionDays]
  );

  return {
    success: true,
    status: 200,
    body: {
      success: true,
      retention_days: retentionDays,
      deleted_run_logs: Number(result?.affectedRows || 0),
      settlement,
      note: "No channel view facts were deleted; AdsGalaxy stores channel views on campaign_posts and only prunes expired fetch-run logs.",
    },
  };
}
