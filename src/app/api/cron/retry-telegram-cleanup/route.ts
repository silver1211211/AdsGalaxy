import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { assertCampaignLifecycleColumns } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts, retryCampaignPostCleanup } from "@/lib/campaignPostDeletion";
import { settleCampaignEngagementBeforeDeletion } from "@/lib/channelSettlement";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import type { RowDataPacket } from "mysql2/promise";

export const dynamic = "force-dynamic";

type PausedCleanupCampaign = RowDataPacket & {
  id: number;
  channel_settlement_finalized_at: Date | string | null;
};

async function processPausedCampaignCleanup() {
  await assertCampaignLifecycleColumns();
  const [campaigns] = await pool.query<PausedCleanupCampaign[]>(`
    SELECT c.id, c.channel_settlement_finalized_at
    FROM campaigns c
    WHERE c.status = 'paused'
      AND c.pause_reason = 'user_paused'
      AND c.type IN ('views', 'clicks')
      AND EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.campaign_id = c.id
          AND cp.status IN ('active', 'posted', 'sent', 'delete_failed', 'cleanup_pending')
          AND COALESCE(cp.cleanup_status, '') <> 'failed'
      )
    ORDER BY c.paused_at ASC, c.id ASC
    LIMIT 20
  `);

  const jobs = [];
  for (const campaign of campaigns) {
    try {
      if (!campaign.channel_settlement_finalized_at) {
        const settlement = await settleCampaignEngagementBeforeDeletion(
          Number(campaign.id),
          "advertiser_pause",
          { includePausedCampaign: true }
        );
        if (!settlement.ok) {
          jobs.push({ campaign_id: campaign.id, settled: false, cleanup_deferred: true });
          continue;
        }
        await pool.query(
          "UPDATE campaigns SET channel_settlement_finalized_at = COALESCE(channel_settlement_finalized_at, NOW()) WHERE id = ? AND status = 'paused'",
          [campaign.id]
        );
      }

      const cleanup = await deleteActiveCampaignPosts(campaign.id);
      jobs.push({ campaign_id: campaign.id, settled: true, cleanup });
    } catch (error) {
      const message = error instanceof Error ? error.message : "paused_campaign_cleanup_failed";
      console.error("Paused campaign background cleanup failed", { campaign_id: campaign.id, error: message });
      jobs.push({ campaign_id: campaign.id, settled: false, cleanup_deferred: true, error: message });
    }
  }
  return jobs;
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("retry-telegram-cleanup", 1200);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Telegram cleanup retry is already running" }, { status: 409 });
  }

  try {
    const pausedCampaigns = await processPausedCampaignCleanup();
    const result = await retryCampaignPostCleanup();
    return NextResponse.json({
      success: true,
      paused_campaigns: pausedCampaigns,
      checked: result.checked,
      deleted: result.deleted,
      failed: result.failed,
      retry: result.retry,
      skipped: result.skipped,
      failed_ids: result.failedIds,
      details: result.details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "retry_telegram_cleanup_failed";
    console.error("Retry Telegram cleanup cron failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
