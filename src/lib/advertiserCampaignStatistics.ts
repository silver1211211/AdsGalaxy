import "server-only";

import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { metricNumber } from "@/lib/statFormulas";
import {
  campaignAverageCpc,
  campaignCostMetric,
  campaignCtr,
  campaignEffectiveCpm,
  type CampaignStatisticKind,
} from "@/lib/campaignStatisticMath";

export type CampaignStatisticsRange = "today" | "yesterday" | "7d" | "14d" | "30d" | "all" | "custom";
export const MAX_CAMPAIGN_STATISTICS_DAILY_ROWS = 30;

export type CampaignStatisticsRangeRequest = {
  key: CampaignStatisticsRange;
  from?: string;
  to?: string;
};

type CampaignAuthority = {
  id: number;
  type: CampaignStatisticKind;
  channel_spend: unknown;
  teaser_mode?: string | null;
};

type DateRange = {
  key: CampaignStatisticsRange;
  start: string | null;
  end: string;
};

type DailyEventRow = RowDataPacket & {
  date: string;
  views: unknown;
  clicks: unknown;
  billable_views: unknown;
  billable_clicks: unknown;
  spend: unknown;
  standard_spend: unknown;
  teaser_spend: unknown;
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeCampaignStatisticsRange(searchParams: URLSearchParams): CampaignStatisticsRangeRequest {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (validDateKey(from) && validDateKey(to) && from <= to) {
    return { key: "custom", from, to };
  }
  const value = searchParams.get("range");
  if (value === "today" || value === "yesterday" || value === "14d" || value === "30d" || value === "all") {
    return { key: value };
  }
  return { key: "7d" };
}

function resolveDateRange(request: CampaignStatisticsRangeRequest, today: string): DateRange {
  const key = request.key;
  if (key === "today") return { key, start: today, end: today };
  if (key === "yesterday") {
    const yesterday = addDays(today, -1);
    return { key, start: yesterday, end: yesterday };
  }
  if (key === "14d") return { key, start: addDays(today, -13), end: today };
  if (key === "30d") return { key, start: addDays(today, -29), end: today };
  if (key === "all") return { key, start: null, end: today };
  if (key === "custom" && request.from && request.to) {
    const end = request.to > today ? today : request.to;
    const earliest = addDays(end, -(MAX_CAMPAIGN_STATISTICS_DAILY_ROWS - 1));
    return { key, start: request.from < earliest ? earliest : request.from, end };
  }
  return { key: "7d", start: addDays(today, -6), end: today };
}

function rangeFilter(column: string, range: DateRange) {
  return {
    sql: `${range.start ? ` AND ${column} >= ?` : ""} AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`,
    params: range.start ? [range.start, range.end] : [range.end],
  };
}

function zeroDay(date: string): DailyEventRow {
  return {
    date,
    views: 0,
    clicks: 0,
    billable_views: 0,
    billable_clicks: 0,
    spend: 0,
    standard_spend: 0,
    teaser_spend: 0,
  } as DailyEventRow;
}

function fillBoundedDays(rows: DailyEventRow[], range: DateRange) {
  if (!range.start) return rows;
  const byDate = new Map(rows.map((row) => [String(row.date), row]));
  const days = Math.min(
    MAX_CAMPAIGN_STATISTICS_DAILY_ROWS,
    Math.max(1, Math.round((new Date(`${range.end}T00:00:00Z`).getTime() - new Date(`${range.start}T00:00:00Z`).getTime()) / 86_400_000) + 1),
  );
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(range.start!, index);
    return byDate.get(date) || zeroDay(date);
  });
}

async function fetchDaily(campaignId: number, range: DateRange) {
  const statsFilter = rangeFilter("stat_date", range);
  const fastFilter = rangeFilter("created_at", range);
  const ledgerFilter = rangeFilter("l.created_at", range);
  const teaserFilter = rangeFilter("ts.created_at", range);
  const teaserClickFilter = rangeFilter("tc.created_at", range);
  const [rows] = await pool.query<DailyEventRow[]>(
    `SELECT * FROM (
       SELECT date,
         SUM(views) views, SUM(clicks) clicks,
         SUM(billable_views) billable_views, SUM(billable_clicks) billable_clicks,
         SUM(spend) spend, SUM(standard_spend) standard_spend, SUM(teaser_spend) teaser_spend
       FROM (
         SELECT DATE_FORMAT(stat_date, '%Y-%m-%d') date,
           SUM(views) views, SUM(clicks) clicks,
           0 billable_views, 0 billable_clicks, 0 spend, 0 standard_spend, 0 teaser_spend
         FROM channel_post_daily_stats
         WHERE campaign_id = ?${statsFilter.sql}
         GROUP BY stat_date
         UNION ALL
         SELECT DATE_FORMAT(created_at, '%Y-%m-%d'), 0, 0,
           SUM(CASE WHEN settlement_type='view' THEN units ELSE 0 END),
           SUM(CASE WHEN settlement_type='click' THEN units ELSE 0 END),
           SUM(advertiser_debit), SUM(advertiser_debit), 0
         FROM channel_advertiser_debits
         WHERE campaign_id = ?${fastFilter.sql}
         GROUP BY DATE(created_at)
         UNION ALL
         SELECT DATE_FORMAT(l.created_at, '%Y-%m-%d'), 0, 0,
           SUM(CASE WHEN l.settlement_type='view' THEN l.new_units ELSE 0 END),
           SUM(CASE WHEN l.settlement_type='click' THEN l.new_units ELSE 0 END),
           SUM(l.advertiser_debit), SUM(l.advertiser_debit), 0
         FROM channel_settlement_ledger l
         LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
         WHERE l.campaign_id = ? AND a.id IS NULL${ledgerFilter.sql}
         GROUP BY DATE(l.created_at)
         UNION ALL
         SELECT DATE_FORMAT(ts.created_at, '%Y-%m-%d'), SUM(ts.impression_delta), 0,
           SUM(ts.impression_delta), 0, SUM(ts.gross_amount), 0, SUM(ts.gross_amount)
         FROM teaser_settlements ts
         JOIN teaser_placements tp ON tp.id=ts.placement_id
         WHERE tp.campaign_id = ?${teaserFilter.sql}
         GROUP BY DATE(ts.created_at)
         UNION ALL
         SELECT DATE_FORMAT(tc.created_at, '%Y-%m-%d'), 0, COUNT(*), 0, 0, 0, 0, 0
         FROM teaser_clicks tc
         JOIN teaser_placements tp ON tp.id=tc.placement_id
         WHERE tp.campaign_id = ?${teaserClickFilter.sql}
         GROUP BY DATE(tc.created_at)
       ) events
       GROUP BY date
       ORDER BY date DESC
       LIMIT ${MAX_CAMPAIGN_STATISTICS_DAILY_ROWS}
     ) bounded ORDER BY date ASC`,
    [
      campaignId, ...statsFilter.params,
      campaignId, ...fastFilter.params,
      campaignId, ...ledgerFilter.params,
      campaignId, ...teaserFilter.params,
      campaignId, ...teaserClickFilter.params,
    ],
  );
  return fillBoundedDays(rows, range);
}

async function fetchAnalyticsSummary(campaignId: number, range: DateRange) {
  const filter = rangeFilter("stat_date", range);
  const [[row]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(clicks),0) clicks
     FROM channel_post_daily_stats WHERE campaign_id=?${filter.sql}`,
    [campaignId, ...filter.params],
  );
  return row;
}

async function fetchChargeSummary(campaignId: number, range: DateRange) {
  const fastFilter = rangeFilter("created_at", range);
  const ledgerFilter = rangeFilter("l.created_at", range);
  const teaserFilter = rangeFilter("ts.created_at", range);
  const [[row]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT
       COALESCE(SUM(billable_views),0) billable_views,
       COALESCE(SUM(billable_clicks),0) billable_clicks,
       COALESCE(SUM(spend),0) spend,
       COALESCE(SUM(CASE WHEN source='teaser' THEN billable_views ELSE 0 END),0) teaser_views,
       COALESCE(SUM(CASE WHEN source='teaser' THEN spend ELSE 0 END),0) teaser_spend
     FROM (
       SELECT created_at,
         CASE WHEN settlement_type='view' THEN units ELSE 0 END billable_views,
         CASE WHEN settlement_type='click' THEN units ELSE 0 END billable_clicks,
         advertiser_debit spend, 'standard' source
       FROM channel_advertiser_debits WHERE campaign_id=?${fastFilter.sql}
       UNION ALL
       SELECT l.created_at,
         CASE WHEN l.settlement_type='view' THEN l.new_units ELSE 0 END,
         CASE WHEN l.settlement_type='click' THEN l.new_units ELSE 0 END,
         l.advertiser_debit, 'standard'
       FROM channel_settlement_ledger l
       LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
       WHERE l.campaign_id=? AND a.id IS NULL${ledgerFilter.sql}
       UNION ALL
       SELECT ts.created_at, ts.impression_delta, 0, ts.gross_amount, 'teaser'
       FROM teaser_settlements ts
       JOIN teaser_placements tp ON tp.id=ts.placement_id
       WHERE tp.campaign_id=?${teaserFilter.sql}
     ) charges`,
    [
      campaignId, ...fastFilter.params,
      campaignId, ...ledgerFilter.params,
      campaignId, ...teaserFilter.params,
    ],
  );
  return row;
}

async function fetchTeaserClickSummary(campaignId: number, range: DateRange) {
  const filter = rangeFilter("tc.created_at", range);
  const [[row]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT COUNT(*) clicks
     FROM teaser_clicks tc
     JOIN teaser_placements tp ON tp.id=tc.placement_id
     WHERE tp.campaign_id=?${filter.sql}`,
    [campaignId, ...filter.params],
  );
  return row;
}

function summarizeDaily(row: DailyEventRow, kind: CampaignStatisticKind) {
  const views = metricNumber(row.views);
  const clicks = metricNumber(row.clicks);
  const spend = metricNumber(row.spend);
  return {
    date: String(row.date),
    views,
    clicks,
    ctr: campaignCtr(clicks, views),
    spend,
    effective_cpm: campaignEffectiveCpm(spend, views),
    average_cpc: campaignAverageCpc(spend, clicks),
    cost_metric: campaignCostMetric(kind, spend, views, clicks),
  };
}

export async function buildAdvertiserCampaignStatistics(
  campaign: CampaignAuthority,
  requestedRange: CampaignStatisticsRangeRequest,
) {
  const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>(
    "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') today",
  );
  const range = resolveDateRange(requestedRange, String(calendar.today));
  const [analytics, charges, teaserClicks, dailySource] = await Promise.all([
    fetchAnalyticsSummary(campaign.id, range),
    fetchChargeSummary(campaign.id, range),
    fetchTeaserClickSummary(campaign.id, range),
    fetchDaily(campaign.id, range),
  ]);

  const teaserViews = metricNumber(charges.teaser_views);
  const totalViews = metricNumber(analytics.views) + teaserViews;
  const totalClicks = metricNumber(analytics.clicks) + metricNumber(teaserClicks.clicks);
  const totalSpend = metricNumber(charges.spend);
  const billableViews = metricNumber(charges.billable_views);
  const billableClicks = metricNumber(charges.billable_clicks);
  const teaserSpend = metricNumber(charges.teaser_spend);
  const daily = dailySource.map((row) => summarizeDaily(row, campaign.type));

  return {
    campaign_id: campaign.id,
    campaign_type: campaign.type,
    primary_metric: campaign.type === "clicks" ? "clicks" : "views",
    range: {
      key: range.key,
      from: range.start,
      to: range.end,
      bounded_to: MAX_CAMPAIGN_STATISTICS_DAILY_ROWS,
    },
    totals: {
      views: totalViews,
      clicks: totalClicks,
      ctr: campaignCtr(totalClicks, totalViews),
      spend: totalSpend,
      billable_views: billableViews,
      billable_clicks: billableClicks,
      effective_cpm: campaignEffectiveCpm(totalSpend, totalViews),
      average_cpc: campaignAverageCpc(totalSpend, totalClicks),
    },
    source_breakdown: {
      standard: {
        views: metricNumber(analytics.views),
        clicks: metricNumber(analytics.clicks),
        spend: Math.max(0, totalSpend - teaserSpend),
      },
      teaser: {
        views: teaserViews,
        clicks: metricNumber(teaserClicks.clicks),
        spend: teaserSpend,
      },
    },
    teaser_enabled: String(campaign.teaser_mode || "none") !== "none",
    daily_rows: daily,
    data_available: totalViews > 0 || totalClicks > 0 || totalSpend > 0,
  };
}

export async function buildUnifiedNonChannelCampaignStatistics(
  campaignId: number,
  kind: "miniapp" | "bot" | "growth",
  requestedRange: CampaignStatisticsRangeRequest,
) {
  const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') today");
  const range = resolveDateRange(requestedRange, String(calendar.today));
  const column = kind === "growth" ? "joined_at" : "created_at";
  const filter = rangeFilter(column, range);
  let sql: string;
  let params: unknown[];
  if (kind === "miniapp") {
    sql = `SELECT DATE_FORMAT(date,'%Y-%m-%d') date,SUM(views) views,SUM(clicks) clicks,SUM(spend) spend FROM (
      SELECT created_at date,1 views,0 clicks,advertiser_debit spend FROM miniapp_internal_ad_impressions WHERE campaign_id=?${filter.sql}
      UNION ALL SELECT created_at,external_impressions_added,external_clicks_added,advertiser_debit FROM miniapp_external_delivery_batches WHERE campaign_id=?${filter.sql}
      UNION ALL SELECT created_at,0,1,0 FROM ad_click_attribution WHERE campaign_type='miniapp' AND campaign_id=?${filter.sql}
    ) events GROUP BY DATE(date) ORDER BY date DESC LIMIT ${MAX_CAMPAIGN_STATISTICS_DAILY_ROWS}`;
    params = [campaignId, ...filter.params, campaignId, ...filter.params, campaignId, ...filter.params];
  } else if (kind === "bot") {
    sql = `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') date,COUNT(*) views,0 clicks,COALESCE(SUM(cost),0) spend
      FROM broadcast_deliveries WHERE campaign_id=? AND status='sent'${filter.sql}
      GROUP BY DATE(created_at) ORDER BY date DESC LIMIT ${MAX_CAMPAIGN_STATISTICS_DAILY_ROWS}`;
    params = [campaignId, ...filter.params];
  } else {
    sql = `SELECT DATE_FORMAT(joined_at,'%Y-%m-%d') date,COUNT(*) views,0 clicks,COALESCE(SUM(advertiser_debit),0) spend
      FROM channel_growth_conversions WHERE campaign_id=? AND status='billed' AND fraud_status='clear'${filter.sql}
      GROUP BY DATE(joined_at) ORDER BY date DESC LIMIT ${MAX_CAMPAIGN_STATISTICS_DAILY_ROWS}`;
    params = [campaignId, ...filter.params];
  }
  const [source] = await pool.query<DailyEventRow[]>(sql, params);
  const rows = fillBoundedDays(source, range);
  const daily = rows.map((row) => summarizeDaily(row, "views"));
  const views = daily.reduce((sum, row) => sum + row.views, 0);
  const clicks = daily.reduce((sum, row) => sum + row.clicks, 0);
  const spend = daily.reduce((sum, row) => sum + row.spend, 0);
  const unitCost = kind === "growth" && views > 0 ? spend / views : campaignEffectiveCpm(spend, views);
  return {
    campaign_id: campaignId, campaign_type: "views" as const, primary_metric: "views" as const,
    range: { key: range.key, from: range.start, to: range.end, bounded_to: MAX_CAMPAIGN_STATISTICS_DAILY_ROWS },
    totals: { views, clicks, subscribers: kind === "growth" ? views : 0, ctr: campaignCtr(clicks, views), spend, billable_views: views, billable_clicks: 0, effective_cpm: unitCost, average_cpc: campaignAverageCpc(spend, clicks) },
    source_breakdown: { standard: { views, clicks, spend }, teaser: { views: 0, clicks: 0, spend: 0 } },
    teaser_enabled: false, daily_rows: daily.map((row) => ({ ...row, subscribers: kind === "growth" ? row.views : 0, cost_metric: kind === "growth" && row.views > 0 ? row.spend / row.views : row.cost_metric })),
    data_available: views > 0 || clicks > 0 || spend > 0,
  };
}
