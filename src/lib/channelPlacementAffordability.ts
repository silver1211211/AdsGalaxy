import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getChannelUnitPrice } from "@/lib/channelBilling";
import { outstandingViewsSql } from "@/lib/channelViewWaivers";
import { getChannelDailySpend } from "@/lib/channelDailySpend";

type CampaignLockRow = RowDataPacket & {
  status: string; budget: number | string; cpm: number | string; cpc: number | string;
  type: string; campaign_kind: string; cost_per_subscriber: number | string | null;
  daily_budget_limit: number | string | null; channel_delivery_generation: number;
  advertiser_discount: number | string; funding_model: string; advertiser_ad_balance: number | string;
};

export type ChannelPlacementAffordability = {
  allowed: boolean;
  reason: "ok" | "campaign_inactive" | "campaign_unaffordable" | "daily_cap_reached" | "advertiser_balance_insufficient";
  generation: number;
  unitLiability: number;
};

/**
 * Transaction-scoped guard shared by normal and emergency delivery.
 * The campaign row lock serializes placement with fast/deferred debit transactions;
 * after waiting, their debits and settled cursors are visible together. Observed
 * unsettled units plus pending sends reserve exposure, not hypothetical clicks on
 * every historical delivered post. Direct-debit wallet checks include that exposure.
 */
export async function checkChannelPlacementAffordability(
  conn: PoolConnection,
  campaignId: number,
): Promise<ChannelPlacementAffordability> {
  const [[campaign]] = await conn.query<CampaignLockRow[]>(
    `SELECT c.status,c.budget,c.cpm,c.cpc,c.type,c.campaign_kind,c.cost_per_subscriber,
       c.daily_budget_limit,c.channel_delivery_generation,c.funding_model,u.ad_balance advertiser_ad_balance,
       CASE WHEN ard.expires_at>UTC_TIMESTAMP() THEN IF(c.type='clicks',ard.cpc_discount,ard.cpm_discount) ELSE 0 END advertiser_discount
     FROM campaigns c
     JOIN users u ON u.id=c.user_id
     LEFT JOIN advertiser_rate_discounts ard ON ard.user_id=c.user_id
     WHERE c.id=? FOR UPDATE`,
    [campaignId],
  );
  if (!campaign || campaign.status !== "active") {
    return { allowed:false, reason:"campaign_inactive", generation:Number(campaign?.channel_delivery_generation || 1), unitLiability:0 };
  }
  const unitLiability = campaign.campaign_kind === "channel_growth"
    ? Number(campaign.cost_per_subscriber || 0)
    : getChannelUnitPrice({ type:campaign.type, cpm:campaign.cpm, cpc:campaign.cpc, discount:campaign.advertiser_discount });
  const [[liability]] = await conn.query<Array<RowDataPacket & { pending_liability: number; today_spend: number }>>(
    `SELECT
       COALESCE(SUM(CASE
         WHEN ?='views' THEN ${outstandingViewsSql("cp")}
         ELSE GREATEST((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id=cp.id)-COALESCE(cp.settled_clicks,0),0)
       END * ?),0)
       + COALESCE(SUM(CASE WHEN (cp.status='pending_delivery'
           OR (?='views' AND cp.status IN ('active','posted','sent')))
           AND cp.delivery_failed_at IS NULL AND cp.deleted_at IS NULL THEN ? ELSE 0 END),0) pending_liability
     FROM campaign_posts cp WHERE cp.campaign_id=?`,
    [campaign.type,unitLiability,campaign.type,unitLiability,campaignId],
  );
  const pending = campaign.campaign_kind === "channel_growth" ? 0 : Number(liability?.pending_liability || 0);
  if (!Number.isFinite(unitLiability) || unitLiability <= 0 || Number(campaign.budget || 0)-pending+1e-10 < unitLiability) {
    return { allowed:false, reason:"campaign_unaffordable", generation:Number(campaign.channel_delivery_generation || 1), unitLiability };
  }
  const dailyCap = Number(campaign.daily_budget_limit || 0);
  const todaySpend = await getChannelDailySpend(conn, campaignId);
  if (dailyCap > 0 && dailyCap-todaySpend-pending+1e-10 < unitLiability) {
    return { allowed:false, reason:"daily_cap_reached", generation:Number(campaign.channel_delivery_generation || 1), unitLiability };
  }
  if (campaign.funding_model === "direct_debit" && Number(campaign.advertiser_ad_balance || 0)-pending+1e-10 < unitLiability) {
    return { allowed:false, reason:"advertiser_balance_insufficient", generation:Number(campaign.channel_delivery_generation || 1), unitLiability };
  }
  return { allowed:true, reason:"ok", generation:Math.max(1,Number(campaign.channel_delivery_generation || 1)), unitLiability };
}
