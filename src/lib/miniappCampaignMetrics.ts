import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { metricNumber } from "@/lib/statFormulas";
import { miniAppImpressionCost } from "@/lib/miniappExternalDeliveryMath";
import { combineMiniAppCampaignMetricSources } from "@/lib/miniappCampaignMetricMath";

type Queryable = Pick<PoolConnection, "query">;

type MetricSourceRow = RowDataPacket & {
  campaign_id: number;
  platform_impressions: unknown;
  external_impressions: unknown;
  platform_clicks: unknown;
  external_clicks: unknown;
  platform_spend: unknown;
  external_spend: unknown;
  today_platform_impressions: unknown;
  today_external_impressions: unknown;
  yesterday_platform_impressions: unknown;
  yesterday_external_impressions: unknown;
  today_platform_clicks: unknown;
  today_external_clicks: unknown;
  today_platform_spend: unknown;
  today_external_spend: unknown;
  last_platform_delivery_at: unknown;
  last_external_delivery_at: unknown;
};

export type MiniAppCampaignMetrics = ReturnType<typeof combineMiniAppCampaignMetricSources>;

export async function getMiniAppCampaignMetricsByIds(
  campaignIds: Array<number | string>,
  db: Queryable = pool as unknown as Queryable,
) {
  const ids = [...new Set(campaignIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const metrics = new Map<number, MiniAppCampaignMetrics>();
  if (ids.length === 0) return metrics;
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db.query<MetricSourceRow[]>(
    `SELECT c.id AS campaign_id,
       COALESCE(pi.platform_impressions, 0) AS platform_impressions,
       COALESCE(eb.external_impressions, 0) AS external_impressions,
       COALESCE(pc.platform_clicks, 0) AS platform_clicks,
       COALESCE(eb.external_clicks, 0) AS external_clicks,
       COALESCE(pi.platform_spend, 0) AS platform_spend,
       COALESCE(eb.external_spend, 0) AS external_spend,
       COALESCE(pi.today_platform_impressions, 0) AS today_platform_impressions,
       COALESCE(eb.today_external_impressions, 0) AS today_external_impressions,
       COALESCE(pi.yesterday_platform_impressions, 0) AS yesterday_platform_impressions,
       COALESCE(eb.yesterday_external_impressions, 0) AS yesterday_external_impressions,
       COALESCE(pc.today_platform_clicks, 0) AS today_platform_clicks,
       COALESCE(eb.today_external_clicks, 0) AS today_external_clicks,
       COALESCE(pi.today_platform_spend, 0) AS today_platform_spend,
       COALESCE(eb.today_external_spend, 0) AS today_external_spend,
       pi.last_platform_delivery_at, eb.last_external_delivery_at
     FROM miniapp_rewarded_campaigns c
     LEFT JOIN (
       SELECT campaign_id, COUNT(*) AS platform_impressions,
         COALESCE(SUM(advertiser_debit), 0) AS platform_spend,
         SUM(created_at >= CURDATE()) AS today_platform_impressions,
         SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE()) AS yesterday_platform_impressions,
         COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN advertiser_debit ELSE 0 END), 0) AS today_platform_spend,
         MAX(created_at) AS last_platform_delivery_at
       FROM miniapp_internal_ad_impressions WHERE campaign_id IN (${placeholders}) GROUP BY campaign_id
     ) pi ON pi.campaign_id = c.id
     LEFT JOIN (
       SELECT campaign_id, COUNT(*) AS platform_clicks,
         SUM(created_at >= CURDATE()) AS today_platform_clicks
       FROM ad_click_attribution
       WHERE campaign_type = 'miniapp' AND campaign_id IN (${placeholders}) GROUP BY campaign_id
     ) pc ON pc.campaign_id = c.id
     LEFT JOIN (
       SELECT campaign_id,
         COALESCE(SUM(external_impressions_added), 0) AS external_impressions,
         COALESCE(SUM(external_clicks_added), 0) AS external_clicks,
         COALESCE(SUM(advertiser_debit), 0) AS external_spend,
         COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN external_impressions_added ELSE 0 END), 0) AS today_external_impressions,
         COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE() THEN external_impressions_added ELSE 0 END), 0) AS yesterday_external_impressions,
         COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN external_clicks_added ELSE 0 END), 0) AS today_external_clicks,
         COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN advertiser_debit ELSE 0 END), 0) AS today_external_spend,
         MAX(created_at) AS last_external_delivery_at
       FROM miniapp_external_delivery_batches WHERE campaign_id IN (${placeholders}) GROUP BY campaign_id
     ) eb ON eb.campaign_id = c.id
     WHERE c.id IN (${placeholders})`,
    [...ids, ...ids, ...ids, ...ids],
  );
  for (const row of rows) metrics.set(Number(row.campaign_id), combineMiniAppCampaignMetricSources(row));
  return metrics;
}

export async function getMiniAppCampaignMetricsByAdvertiser(
  advertiserId: number,
  db: Queryable = pool as unknown as Queryable,
) {
  const [rows] = await db.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM miniapp_rewarded_campaigns WHERE advertiser_id = ?",
    [advertiserId],
  );
  return getMiniAppCampaignMetricsByIds(rows.map((row) => row.id), db);
}

export function applyMiniAppCampaignMetrics<T extends Record<string, unknown>>(
  row: T,
  metrics: Map<number, MiniAppCampaignMetrics>,
) {
  const value = metrics.get(Number(row.id));
  if (!value) return row;
  const remainingBudget = metricNumber(row.remaining_budget ?? row.budget);
  const totalFunded = remainingBudget + value.spend;
  const unitCost = miniAppImpressionCost(row.advertiser_cpm_bid ?? row.cpm);
  return {
    ...row,
    ...value,
    campaign_progress: totalFunded > 0 ? Math.min(100, value.spend / totalFunded * 100) : 0,
    budget_spent_percent: totalFunded > 0 ? Math.min(100, value.spend / totalFunded * 100) : 0,
    budget_exhausted: row.pause_reason === "budget_exhausted" || (unitCost > 0 && remainingBudget < unitCost),
    daily_cap_reached: metricNumber(row.daily_budget_limit) > 0 && value.today_spend >= metricNumber(row.daily_budget_limit),
    conversion_rate: value.clicks > 0 ? metricNumber(row.conversions) / value.clicks * 100 : 0,
    ...(Object.prototype.hasOwnProperty.call(row, "ads_galaxy_revenue")
      ? { ads_galaxy_revenue: metricNumber(row.ads_galaxy_revenue) + value.external_spend }
      : {}),
  };
}
