import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { campaignCtr, campaignEffectiveCpm, campaignAverageCpc } from "@/lib/campaignStatisticMath";

type Db = Pick<PoolConnection, "query">;
export function isStandardChannelReport(c: Record<string, unknown>) {
  return c.source !== "miniapp" && c.campaign_kind !== "miniapp"
    && (c.type === "views" || c.type === "clicks") && String(c.teaser_mode || "none") === "none";
}

/** Immutable money events; same exclusion rules as channelDailySpend. Never post cursors. */
export function channelFinancialEventsSql() {
  return `SELECT d.campaign_id,d.post_id,d.created_at event_at,d.advertiser_debit spend,
      CASE WHEN d.settlement_type='view' THEN d.units ELSE 0 END billable_views,
      CASE WHEN d.settlement_type='click' THEN d.units ELSE 0 END billable_clicks,0 subscribers
    FROM channel_advertiser_debits d JOIN campaigns c ON c.id=d.campaign_id
    WHERE COALESCE(c.campaign_kind,'channel')<>'channel_growth'
    UNION ALL
    SELECT l.campaign_id,l.post_id,l.created_at,l.advertiser_debit,
      CASE WHEN l.settlement_type='view' THEN l.new_units ELSE 0 END,
      CASE WHEN l.settlement_type='click' THEN l.new_units ELSE 0 END,0
    FROM channel_settlement_ledger l JOIN campaigns c ON c.id=l.campaign_id
    WHERE COALESCE(c.campaign_kind,'channel')<>'channel_growth'
      AND NOT EXISTS (SELECT 1 FROM channel_fraud_billing_adjustments a WHERE a.settlement_ledger_id=l.id)
    UNION ALL
    SELECT g.campaign_id,g.campaign_post_id,g.billed_at,g.advertiser_debit,0,0,1
    FROM channel_growth_conversions g
    WHERE g.status='billed' AND g.fraud_status='clear'`;
}

export type ChannelReport = { views: number; clicks: number; subscribers: number; spend: number; billable_views: number; billable_clicks: number; cpm?: number; cpc?: number; cost_per_subscriber?: number };
const number = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
export function presentChannelMetrics(row: Partial<ChannelReport>, lifetimeViews: number = number(row.views), growth = false) {
  const views = number(row.views);
  const unlocked = lifetimeViews > 0;
  const clicks = unlocked ? number(row.clicks) : 0;
  const subscribers = unlocked ? number(row.subscribers) : 0;
  const spend = number(row.spend);
  return { views, clicks, subscribers, spend, billable_views: number(row.billable_views), billable_clicks: number(row.billable_clicks),
    ctr: campaignCtr(clicks, views), conversion_rate: campaignCtr(subscribers, clicks),
    effective_cps: growth && subscribers > 0 ? spend / subscribers : 0,
    effective_cpm: growth ? 0 : campaignEffectiveCpm(spend, row.billable_views),
    average_cpc: growth ? 0 : campaignAverageCpc(spend, row.billable_clicks),
    display_unlocked: unlocked };
}

export function channelMetricPayload(row: ChannelReport, growth: boolean) {
  const m = presentChannelMetrics(row, row.views, growth);
  return { ...m, cpm: row.cpm, cpc: row.cpc, cost_per_subscriber: row.cost_per_subscriber,
    impressions: m.views, total_views: m.views, raw_views: m.views, raw_total_views: m.views,
    total_clicks: m.clicks, displayed_clicks: m.clicks, actual_tracked_clicks: m.clicks,
    historical_click_recovery_adjustment: 0,
    verified_subscribers: m.subscribers, subscribers_acquired: m.subscribers,
    subscriber_spend: growth ? m.spend : 0, settled_spend: m.spend, actual_spend: m.spend };
}

export async function getChannelReportingMetrics(db: Db, ids: number[]) {
  const result = new Map<number, ChannelReport>();
  if (!ids.length) return result;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT c.id,c.cpm,c.cpc,c.cost_per_subscriber,
    COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id=c.id
      AND cp.delivery_confirmed_at IS NOT NULL AND cp.delivery_failed_at IS NULL),0) views,
    (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id=c.id) clicks,
    COALESCE(f.spend,0) spend,COALESCE(f.billable_views,0) billable_views,
    COALESCE(f.billable_clicks,0) billable_clicks,COALESCE(f.subscribers,0) subscribers
    FROM campaigns c LEFT JOIN (
      SELECT campaign_id,SUM(spend) spend,SUM(billable_views) billable_views,
        SUM(billable_clicks) billable_clicks,SUM(subscribers) subscribers
      FROM (${channelFinancialEventsSql()}) events WHERE campaign_id IN (?) GROUP BY campaign_id
    ) f ON f.campaign_id=c.id WHERE c.id IN (?)`, [ids, ids]);
  for (const r of rows) result.set(Number(r.id), { views:number(r.views),clicks:number(r.clicks),spend:number(r.spend),
    billable_views:number(r.billable_views),billable_clicks:number(r.billable_clicks),subscribers:number(r.subscribers),
    cpm:number(r.cpm),cpc:number(r.cpc),cost_per_subscriber:number(r.cost_per_subscriber) });
  return result;
}
