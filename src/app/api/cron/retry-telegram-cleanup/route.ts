import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { assertCampaignLifecycleColumns } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts, retryCampaignPostCleanup } from "@/lib/campaignPostDeletion";
import { settleCampaignEngagementBeforeDeletion, unpaidAcceptedClickSql } from "@/lib/channelSettlement";
import { outstandingViewsSql } from "@/lib/channelViewWaivers";
import { isUnifiedSchemaReady } from "@/lib/channelUnifiedSettlement";
import { retryRejectedBotCampaignMessages } from "@/lib/botCampaignCleanup";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import type { RowDataPacket } from "mysql2/promise";

export const dynamic = "force-dynamic";

type PausedCleanupCampaign = RowDataPacket & {
  id: number;
  pause_reason: string;
  channel_settlement_finalized_at: Date | string | null;
};

async function processPausedCampaignCleanup() {
  await assertCampaignLifecycleColumns();
  const [campaigns] = await pool.query<PausedCleanupCampaign[]>(`
    SELECT c.id, c.pause_reason, c.channel_settlement_finalized_at
    FROM campaigns c
    WHERE c.status = 'paused'
      AND c.pause_reason IN ('user_paused','moderation_cleanup')
      AND c.type IN ('views', 'clicks')
      AND (c.pause_reason='moderation_cleanup' AND COALESCE(c.telegram_cleanup_status,'')<>'success'
        OR EXISTS (
          SELECT 1 FROM campaign_posts cp
          WHERE cp.campaign_id = c.id
            AND cp.status IN ('active', 'posted', 'sent', 'delete_failed', 'cleanup_pending')
            AND COALESCE(cp.cleanup_status, '') <> 'failed'
        ))
    ORDER BY c.paused_at ASC, c.id ASC
    LIMIT 20
  `);

  const jobs = [];
  for (const campaign of campaigns) {
    try {
      if (campaign.pause_reason === "moderation_cleanup" || !campaign.channel_settlement_finalized_at) {
        const settlement = await settleCampaignEngagementBeforeDeletion(
          Number(campaign.id),
          campaign.pause_reason === "moderation_cleanup" ? "moderation_cleanup" : "advertiser_pause",
          { includePausedCampaign: true }
        );
        if (!settlement.ok) {
          jobs.push({ campaign_id: campaign.id, settled: false, cleanup_deferred: true });
          continue;
        }
        if (campaign.pause_reason !== "moderation_cleanup") await pool.query(
          "UPDATE campaigns SET channel_settlement_finalized_at = COALESCE(channel_settlement_finalized_at, NOW()) WHERE id = ? AND status = 'paused'",
          [campaign.id]
        );
      }

      const cleanup = await deleteActiveCampaignPosts(campaign.id);
      if (campaign.pause_reason === "moderation_cleanup") {
        const [[remaining]] = await pool.query<Array<RowDataPacket & { posts: number; payouts: number }>>(
          `SELECT
            (SELECT COUNT(*) FROM campaign_posts WHERE campaign_id=? AND delivery_confirmed_at IS NOT NULL
              AND deleted_at IS NULL AND status IN ('active','posted','sent','cleanup_pending','delete_failed')) posts,
            (SELECT COUNT(*) FROM channel_advertiser_debits WHERE campaign_id=? AND publisher_status<>'settled') payouts`,
          [campaign.id, campaign.id],
        );
        jobs.push({ campaign_id: campaign.id, settled: true, cleanup,
          remaining_posts: Number(remaining.posts), remaining_payouts: Number(remaining.payouts) });
      } else jobs.push({ campaign_id: campaign.id, settled: true, cleanup });
    } catch (error) {
      const message = error instanceof Error ? error.message : "paused_campaign_cleanup_failed";
      console.error("Paused campaign background cleanup failed", { campaign_id: campaign.id, error: message });
      jobs.push({ campaign_id: campaign.id, settled: false, cleanup_deferred: true, error: message });
    }
  }
  return jobs;
}

async function finalizeModerationCleanup() {
  const unpaidClickSql=unpaidAcceptedClickSql(await isUnifiedSchemaReady(pool));
  const [rows] = await pool.query<Array<RowDataPacket & {id:number}>>(
    `SELECT id FROM campaigns WHERE status='paused' AND pause_reason='moderation_cleanup'
       AND COALESCE(telegram_cleanup_status,'')<>'success' ORDER BY id LIMIT 50`);
  let completed=0;
  for(const row of rows){
    const [result] = await pool.query<import('mysql2/promise').ResultSetHeader>(
      `UPDATE campaigns c SET c.telegram_cleanup_status='success',
         c.channel_settlement_finalized_at=COALESCE(c.channel_settlement_finalized_at,UTC_TIMESTAMP(6))
       WHERE c.id=? AND c.status='paused' AND c.pause_reason='moderation_cleanup'
         AND NOT EXISTS (SELECT 1 FROM campaign_posts cp WHERE cp.campaign_id=c.id
           AND cp.delivery_confirmed_at IS NOT NULL AND cp.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM teaser_placements tp WHERE tp.campaign_id=c.id
           AND tp.inserted_at IS NOT NULL AND tp.removed_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM broadcast_deliveries bd WHERE bd.campaign_id=c.id
           AND bd.telegram_message_id IS NOT NULL AND bd.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM channel_advertiser_debits d WHERE d.campaign_id=c.id
            AND d.publisher_status<>'settled')
          AND NOT EXISTS (SELECT 1 FROM channel_cpm_pending_allocations pa WHERE pa.campaign_id=c.id
            AND pa.status='pending')
          AND NOT EXISTS (SELECT 1 FROM campaign_posts cp WHERE cp.campaign_id=c.id
            AND cp.deleted_at IS NOT NULL AND cp.billing_cutoff_at IS NOT NULL
            AND ((c.type='views' AND cp.view_accepted_at IS NOT NULL
              AND cp.view_accepted_at<=cp.billing_cutoff_at AND ${outstandingViewsSql('cp')}>0)
              OR (c.type='clicks' AND EXISTS(SELECT 1 FROM campaign_clicks cc WHERE cc.post_id=cp.id
                  AND cc.campaign_id=c.id AND cc.is_bot=0 AND cc.accepted_at IS NOT NULL
                  AND cc.accepted_at<=cp.billing_cutoff_at AND ${unpaidClickSql}))))`,[row.id]);
    completed+=result.affectedRows;
  }
  return {checked:rows.length,completed};
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
    const botMessages = await retryRejectedBotCampaignMessages();
    const moderationCleanup = await finalizeModerationCleanup();
    return NextResponse.json({
      success: true,
      paused_campaigns: pausedCampaigns,
      bot_messages: botMessages,
      moderation_cleanup:moderationCleanup,
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
