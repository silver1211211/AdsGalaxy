import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { deleteAllCampaignPostsForLifecycle, type CampaignPostDeletionSummary } from "@/lib/campaignPostDeletion";
import { enqueueCampaignNotification } from "@/lib/platformNotifications";
import { withFinancialTransactionRetry } from "@/lib/dbResilience";
import { channelDailySpendSql, channelNextUnitSql, getChannelDailySpend, canResumeChannelDailyCap } from "@/lib/channelDailySpend";

export async function markChannelDailyCapReached(conn: PoolConnection, campaignId: number) {
  const [result] = await conn.query<ResultSetHeader>(
    `UPDATE campaigns
     SET status='daily_cap_reached',pause_reason='daily_budget_limit',paused_at=COALESCE(paused_at,UTC_TIMESTAMP()),
       daily_cap_reached_at=COALESCE(daily_cap_reached_at,UTC_TIMESTAMP()),daily_cap_billing_date=UTC_DATE()
     WHERE id=? AND status='active'`,
    [campaignId],
  );
  if (result.affectedRows > 0) {
    await conn.query(
      `UPDATE channel_growth_invites i JOIN campaigns c ON c.id=i.campaign_id
       SET i.status='revoke_pending'
       WHERE c.id=? AND c.campaign_kind='channel_growth' AND i.status='active'`, [campaignId]);
    await conn.query(
      `UPDATE campaign_posts cp JOIN campaigns c ON c.id=cp.campaign_id
       SET cp.status='cleanup_pending'
       WHERE c.id=? AND c.campaign_kind='channel_growth' AND cp.status IN ('active','posted','sent')`, [campaignId]);
    const [[campaign]] = await conn.query<Array<RowDataPacket & { user_id: number; name: string; billing_day: string }>>(
      "SELECT user_id,name,DATE_FORMAT(UTC_DATE(),'%Y-%m-%d') billing_day FROM campaigns WHERE id=?", [campaignId]);
    if (campaign) await enqueueCampaignNotification(conn, {
      campaignId, userId: Number(campaign.user_id), event: "daily_cap", name: campaign.name, billingDay: campaign.billing_day,
    });
  }
  return result.affectedRows > 0;
}

export async function reactivateChannelCampaignsForNewBillingDay() {
  return withFinancialTransactionRetry(async (conn) => {
    const [rows] = await conn.query<Array<RowDataPacket & { id: number }>>(
      `SELECT c.id,c.status,c.budget,c.campaign_kind,c.funding_model,c.teaser_mode,u.ad_balance,c.daily_budget_limit,
         ${channelNextUnitSql()} unit_price,${channelDailySpendSql()} today_spend
       FROM campaigns c JOIN users u ON u.id=c.user_id
       WHERE c.status='daily_cap_reached'
         AND (c.daily_cap_billing_date<UTC_DATE() OR COALESCE(c.teaser_mode,'none')='none')
         AND c.pause_reason='daily_budget_limit' AND c.type IN ('views','clicks')
         AND (c.start_at IS NULL OR c.start_at<=UTC_TIMESTAMP())
         AND (c.end_at IS NULL OR c.end_at>UTC_TIMESTAMP())
         AND COALESCE(u.advertiser_trust_level,'new')<>'restricted'
         AND (COALESCE(c.campaign_kind,'channel')<>'channel_growth' OR (c.destination_chat_id IS NOT NULL AND c.growth_tracking_status='ready'))
         AND (${channelNextUnitSql()})>0 AND c.budget>=(${channelNextUnitSql()})
         AND ((COALESCE(c.teaser_mode,'none')<>'none' AND c.funding_model<>'direct_debit') OR u.ad_balance>=(${channelNextUnitSql()}))
         AND (COALESCE(c.daily_budget_limit,0)<=0 OR c.daily_budget_limit-${channelDailySpendSql()}>=(${channelNextUnitSql()}))
       FOR UPDATE`,
    );
    const ids = rows.filter(row => canResumeChannelDailyCap({
      status: row.status, unitPrice: Number(row.unit_price), budget: Number(row.budget),
      balance: Number(row.ad_balance), requiresBalance: String(row.teaser_mode || "none") === "none" || row.funding_model === "direct_debit",
      cap: Number(row.daily_budget_limit || 0), spent: Number(row.today_spend || 0),
    })).map((row) => Number(row.id));
    if (ids.length) {
      await conn.query(
        `UPDATE campaigns SET status='active',pause_reason=NULL,paused_at=NULL,
           daily_cap_reached_at=NULL,daily_cap_billing_date=NULL,
           channel_delivery_generation=channel_delivery_generation+1
         WHERE id IN (?) AND status='daily_cap_reached' AND pause_reason='daily_budget_limit'`,
        [ids],
      );
    }
    return ids;
  }, { operation: "channel_daily_cap_reactivation" });
}

export async function reactivateCampaignAfterDailyCapIncrease(campaignId: number, userId: number) {
  return withFinancialTransactionRetry(async (conn) => {
    const [[campaign]] = await conn.query<Array<RowDataPacket & {
      status: string; daily_budget_limit: string | number; budget: string | number;
      funding_model: string; ad_balance: string | number; unit_price: string | number;
    }>>(
      `SELECT c.status,c.daily_budget_limit,c.budget,c.funding_model,c.teaser_mode,u.ad_balance,c.campaign_kind,
         ${channelNextUnitSql()} unit_price
       FROM campaigns c JOIN users u ON u.id=c.user_id
       WHERE c.id=? AND c.user_id=? AND c.pause_reason='daily_budget_limit'
         AND c.type IN ('views','clicks')
         AND (c.start_at IS NULL OR c.start_at<=UTC_TIMESTAMP())
         AND (c.end_at IS NULL OR c.end_at>UTC_TIMESTAMP())
         AND COALESCE(u.advertiser_trust_level,'new')<>'restricted'
         AND (COALESCE(c.campaign_kind,'channel')<>'channel_growth' OR (c.destination_chat_id IS NOT NULL AND c.growth_tracking_status='ready')) FOR UPDATE`, [campaignId, userId]);
    if (!campaign || campaign.status !== "daily_cap_reached") {
      return false;
    }
    const todaySpend = await getChannelDailySpend(conn, campaignId);
    const unitPrice = Number(campaign.unit_price || 0);
    if (!canResumeChannelDailyCap({
      status: campaign.status, unitPrice, budget: Number(campaign.budget), balance: Number(campaign.ad_balance),
      requiresBalance: String(campaign.teaser_mode || "none") === "none" || campaign.funding_model === "direct_debit",
      cap: Number(campaign.daily_budget_limit || 0), spent: todaySpend,
    })) {
      return false;
    }
    const [updated] = await conn.query<ResultSetHeader>(
      `UPDATE campaigns SET status='active',pause_reason=NULL,paused_at=NULL,
         daily_cap_reached_at=NULL,daily_cap_billing_date=NULL,
         channel_delivery_generation=channel_delivery_generation+1
       WHERE id=? AND user_id=? AND status='daily_cap_reached'`, [campaignId, userId]);
    return updated.affectedRows === 1;
  }, { operation: "channel_daily_cap_increase_reactivation" });
}

export async function reconcileChannelDailyCapLifecycle() {
  const reactivated = await reactivateChannelCampaignsForNewBillingDay();
  const [rows] = await pool.query<Array<RowDataPacket & { id: number }>>(
    `SELECT c.id
     FROM campaigns c
     WHERE c.status='active' AND c.type IN ('views','clicks')
       AND COALESCE(c.daily_budget_limit,0)>0
       AND c.daily_budget_limit-${channelDailySpendSql()} < (${channelNextUnitSql()})`,
  );
  const capped: number[] = [];
  for (const row of rows) {
    const changed = await withFinancialTransactionRetry(
      async (conn) => {
        const [[current]] = await conn.query<Array<RowDataPacket & { daily_budget_limit: number; unit_price: number; budget: number; ad_balance: number; funding_model: string; campaign_kind: string }>>(
          `SELECT c.daily_budget_limit,c.budget,c.funding_model,c.campaign_kind,u.ad_balance,${channelNextUnitSql()} unit_price
           FROM campaigns c JOIN users u ON u.id=c.user_id
           WHERE c.id=? AND c.status='active' FOR UPDATE`, [row.id]);
        if (!current || Number(current.daily_budget_limit) <= 0) return false;
        // Lack of campaign funds/wallet funds is not a daily-cap condition.
        const unit = Number(current.unit_price);
        if (!(unit > 0) || Number(current.budget) < unit ||
          ((current.funding_model === "direct_debit" || current.campaign_kind === "channel_growth") && Number(current.ad_balance) < unit)) return false;
        const spend = await getChannelDailySpend(conn, Number(row.id));
        if (spend + Number(current.unit_price) <= Number(current.daily_budget_limit) + 1e-10) return false;
        return markChannelDailyCapReached(conn, Number(row.id));
      },
      { operation: "channel_daily_cap_reconciliation" },
    );
    if (changed) capped.push(Number(row.id));
  }
  for (const campaignId of capped) await cleanupChannelDailyCapPosts(campaignId);
  return { reactivated, capped };
}

export async function cleanupChannelDailyCapPosts(campaignId: number): Promise<CampaignPostDeletionSummary> {
  return deleteAllCampaignPostsForLifecycle(campaignId);
}
