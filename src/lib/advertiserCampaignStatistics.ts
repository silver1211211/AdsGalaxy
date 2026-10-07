import "server-only";

import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { channelFinancialEventsSql, getChannelReportingMetrics, isStandardChannelReport, presentChannelMetrics } from "@/lib/channelReporting";
import { getGrowthLiveImpressions, getGrowthTodayImpressions } from "@/lib/channelGrowthStatistics";
import { metricNumber } from "@/lib/statFormulas";
import { getCampaignClickAnalytics } from "@/lib/campaignAnalyticsAdjustments";
import {
  campaignAverageCpc,
  channelAdvertiserMetrics,
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
  public_id?: number | null;
  type: CampaignStatisticKind;
  channel_spend: unknown;
  teaser_mode?: string | null;
  campaign_kind?: string | null;
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
  subscribers?: unknown;
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
    subscribers: 0,
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

async function buildLiveChannelStatistics(campaign: CampaignAuthority, requestedRange: CampaignStatisticsRangeRequest) {
  const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>("SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') today");
  const today = String(calendar.today);
  const range = resolveDateRange(requestedRange, today);
  const growth = campaign.campaign_kind === "channel_growth";
  const lifetime = (await getChannelReportingMetrics(pool, [campaign.id])).get(campaign.id)!;
  const viewFilter = rangeFilter("ps.stat_date", range);
  const clickFilter = rangeFilter("cc.created_at", range);
  const moneyFilter = rangeFilter("event_at", range);
  // Aggregate every day before bounding the chart, so lifetime totals are never truncated.
  const [source] = await pool.query<DailyEventRow[]>(`SELECT date,SUM(views) views,SUM(clicks) clicks,
      SUM(subscribers) subscribers,SUM(spend) spend,SUM(billable_views) billable_views,SUM(billable_clicks) billable_clicks
    FROM (
      SELECT DATE_FORMAT(ps.stat_date,'%Y-%m-%d') date,ps.views,0 clicks,0 subscribers,0 spend,0 billable_views,0 billable_clicks
      FROM channel_post_daily_stats ps JOIN campaign_posts cp ON cp.id=ps.post_id
      WHERE ps.campaign_id=? AND cp.delivery_confirmed_at IS NOT NULL AND cp.delivery_failed_at IS NULL${viewFilter.sql}
      UNION ALL
      SELECT DATE_FORMAT(cc.created_at,'%Y-%m-%d'),0,COUNT(*),0,0,0,0
      FROM campaign_clicks cc WHERE cc.campaign_id=?${clickFilter.sql} GROUP BY DATE(cc.created_at)
      UNION ALL
      SELECT DATE_FORMAT(event_at,'%Y-%m-%d'),0,0,subscribers,spend,billable_views,billable_clicks
      FROM (${channelFinancialEventsSql()}) financial WHERE campaign_id=?${moneyFilter.sql}
    ) events GROUP BY date ORDER BY date`,
    [campaign.id,...viewFilter.params,campaign.id,...clickFilter.params,campaign.id,...moneyFilter.params]);
  if (range.end === today) {
    let current = source.find(row => String(row.date) === today);
    if (!current) { current = zeroDay(today); source.push(current); }
    // Replace, never add to, today's rollup. Aggregation uses the same snapshot baseline.
    current.views = await getGrowthTodayImpressions(pool, campaign.id);
  }
  const sums = source.reduce((sum,row) => ({ views: sum.views + metricNumber(row.views), clicks: sum.clicks + metricNumber(row.clicks),
    subscribers: sum.subscribers + metricNumber(row.subscribers), spend: sum.spend + metricNumber(row.spend),
    billable_views: sum.billable_views + metricNumber(row.billable_views), billable_clicks: sum.billable_clicks + metricNumber(row.billable_clicks) }),
    { views:0,clicks:0,subscribers:0,spend:0,billable_views:0,billable_clicks:0 });
  const totals = presentChannelMetrics(range.key === "all" ? lifetime : sums, lifetime.views, growth);
  const daily = fillBoundedDays(source,range).slice(-MAX_CAMPAIGN_STATISTICS_DAILY_ROWS).map(row => {
    const metrics = presentChannelMetrics({ views:metricNumber(row.views),clicks:metricNumber(row.clicks),subscribers:metricNumber(row.subscribers),
      spend:metricNumber(row.spend),billable_views:metricNumber(row.billable_views),billable_clicks:metricNumber(row.billable_clicks) }, lifetime.views,growth);
    return { ...metrics,date:String(row.date),raw_views:metrics.views,
      cost_metric:growth ? metrics.effective_cps : campaign.type === "clicks" ? metrics.average_cpc : metrics.effective_cpm };
  });
  return { campaign_id:Number(campaign.public_id || campaign.id),internal_campaign_id:campaign.id,campaign_type:campaign.type,
    primary_metric:campaign.type === "clicks" ? "clicks" : "views",billing_model:growth ? "cps" : campaign.type === "clicks" ? "cpc" : "cpm",
    range:{key:range.key,from:range.start,to:range.end,bounded_to:MAX_CAMPAIGN_STATISTICS_DAILY_ROWS},
    totals:{...totals,raw_views:totals.views,actual_tracked_clicks:totals.clicks,displayed_clicks:totals.clicks},
    source_breakdown:{standard:{views:totals.views,clicks:totals.clicks,spend:totals.spend},teaser:{views:0,clicks:0,spend:0}},
    teaser_enabled:false,daily_rows:daily,data_available:totals.views>0 || totals.spend>0 };
}

function summarizeDaily(row: DailyEventRow, kind: CampaignStatisticKind) {
  const spend = metricNumber(row.spend);
  const metrics = channelAdvertiserMetrics({
    kind,
    rawViews: row.views,
    actualClicks: row.clicks,
    billableViews: row.billable_views,
    billableClicks: row.billable_clicks,
    spend,
  });
  return {
    date: String(row.date),
    views: metrics.visibleViews,
    clicks: metrics.visibleClicks,
    raw_views: metrics.rawViews,
    billable_views: metrics.billableViews,
    billable_clicks: metrics.billableClicks,
    ctr: metrics.ctr,
    spend,
    effective_cpm: metrics.effectiveCpm,
    average_cpc: metrics.averageCpc,
    cost_metric: metrics.costMetric,
  };
}

export async function buildAdvertiserCampaignStatistics(
  campaign: CampaignAuthority,
  requestedRange: CampaignStatisticsRangeRequest,
) {
  if (isStandardChannelReport(campaign)) return buildLiveChannelStatistics(campaign, requestedRange);
  const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>(
    "SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') today",
  );
  const range = resolveDateRange(requestedRange, String(calendar.today));
  const [analytics, charges, teaserClicks, dailySource, clickAnalytics] = await Promise.all([
    fetchAnalyticsSummary(campaign.id, range),
    fetchChargeSummary(campaign.id, range),
    fetchTeaserClickSummary(campaign.id, range),
    fetchDaily(campaign.id, range),
    getCampaignClickAnalytics(campaign.id),
  ]);

  const teaserViews = metricNumber(charges.teaser_views);
  const rawViews = metricNumber(analytics.views) + teaserViews;
  const actualStandardClicks = metricNumber(analytics.clicks);
  const displayedStandardClicks = Math.max(actualStandardClicks, clickAnalytics.recoveryBaseline)
    + clickAnalytics.additiveAdjustment;
  const totalClicks = displayedStandardClicks + metricNumber(teaserClicks.clicks);
  const totalSpend = metricNumber(charges.spend);
  const billableViews = metricNumber(charges.billable_views);
  const billableClicks = metricNumber(charges.billable_clicks);
  const teaserSpend = metricNumber(charges.teaser_spend);
  const daily = dailySource.map((row) => summarizeDaily(row, campaign.type));
  const metrics = channelAdvertiserMetrics({
    kind: campaign.type,
    rawViews,
    actualClicks: totalClicks,
    billableViews,
    billableClicks,
    spend: totalSpend,
  });

  return {
    campaign_id: Number(campaign.public_id || campaign.id),
    internal_campaign_id: campaign.id,
    campaign_type: campaign.type,
    primary_metric: campaign.type === "clicks" ? "clicks" : "views",
    range: {
      key: range.key,
      from: range.start,
      to: range.end,
      bounded_to: MAX_CAMPAIGN_STATISTICS_DAILY_ROWS,
    },
    totals: {
      views: metrics.visibleViews,
      clicks: metrics.visibleClicks,
      actual_tracked_clicks: actualStandardClicks + metricNumber(teaserClicks.clicks),
      historical_click_recovery_adjustment: clickAnalytics.recoveryBaseline + clickAnalytics.additiveAdjustment,
      displayed_clicks: totalClicks,
      raw_views: metrics.rawViews,
      ctr: metrics.ctr,
      spend: totalSpend,
      billable_views: billableViews,
      billable_clicks: billableClicks,
      effective_cpm: metrics.effectiveCpm,
      average_cpc: metrics.averageCpc,
    },
    source_breakdown: {
      standard: {
        views: metricNumber(analytics.views),
        clicks: displayedStandardClicks,
        actual_tracked_clicks: actualStandardClicks,
        historical_click_recovery_adjustment: clickAnalytics.recoveryBaseline + clickAnalytics.additiveAdjustment,
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
    data_available: rawViews > 0 || totalClicks > 0 || totalSpend > 0,
  };
}

export async function buildUnifiedNonChannelCampaignStatistics(
  campaignId: number,
  kind: "miniapp" | "bot" | "growth",
  requestedRange: CampaignStatisticsRangeRequest,
) {
  if (String(kind) === "growth") return buildLiveChannelStatistics({ id: campaignId, type: "views", campaign_kind: "channel_growth", channel_spend: 0 }, requestedRange);
  const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>(
    kind === "growth" ? "SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') today" : "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') today");
  const range = resolveDateRange(requestedRange, String(calendar.today));
  const column = kind === "growth" ? "billed_at" : "created_at";
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
    const viewFilter = rangeFilter("stat_date", range);
    const clickFilter = rangeFilter("created_at", range);
    sql = `SELECT date,SUM(views) views,SUM(clicks) clicks,SUM(subscribers) subscribers,SUM(spend) spend
      FROM (
        SELECT DATE_FORMAT(stat_date,'%Y-%m-%d') date,COALESCE(SUM(views),0) views,0 clicks,0 subscribers,0 spend
        FROM channel_post_daily_stats WHERE campaign_id=?${viewFilter.sql} GROUP BY DATE(stat_date)
        UNION ALL
        SELECT DATE_FORMAT(created_at,'%Y-%m-%d'),0,COUNT(*),0,0
        FROM campaign_clicks WHERE campaign_id=?${clickFilter.sql} GROUP BY DATE(created_at)
        UNION ALL
        SELECT DATE_FORMAT(billed_at,'%Y-%m-%d'),0,0,COUNT(*),COALESCE(SUM(advertiser_debit),0)
        FROM channel_growth_conversions WHERE campaign_id=? AND status='billed' AND fraud_status='clear'${filter.sql}
        GROUP BY DATE(billed_at)
      ) events GROUP BY date ORDER BY date DESC LIMIT ${MAX_CAMPAIGN_STATISTICS_DAILY_ROWS}`;
    params = [campaignId, ...viewFilter.params, campaignId, ...clickFilter.params, campaignId, ...filter.params];
  }
  const [source] = await pool.query<DailyEventRow[]>(sql, params);
  let growthLiveViews: number | null = null;
  if (kind === "growth" && range.end === String(calendar.today)) {
    growthLiveViews = await getGrowthLiveImpressions(pool, campaignId);
    const todayViews = await getGrowthTodayImpressions(pool, campaignId);
    let today = source.find((row) => row.date === range.end);
    if (!today) { today = zeroDay(range.end); source.unshift(today); }
    today.views = todayViews;
  }
  const rows = fillBoundedDays(source, range);
  const daily = kind === "growth"
    ? rows.map((row) => {
        const views = metricNumber(row.views);
        const clicks = metricNumber(row.clicks);
        const subscribers = metricNumber(row.subscribers);
        const spend = metricNumber(row.spend);
        return {
          date: String(row.date), views, clicks, subscribers, spend,
          ctr: campaignCtr(clicks, views),
          conversion_rate: clicks > 0 ? metricNumber((subscribers / clicks) * 100) : 0,
          effective_cpm: 0, average_cpc: 0,
          cost_metric: subscribers > 0 ? metricNumber(spend / subscribers) : 0,
        };
      })
    : rows.map((row) => summarizeDaily(row, "views"));
  const views = kind === "growth" && range.key === "all" && growthLiveViews !== null
    ? growthLiveViews : daily.reduce((sum, row) => sum + row.views, 0);
  let clicks = daily.reduce((sum, row) => sum + row.clicks, 0);
  let spend = daily.reduce((sum, row) => sum + row.spend, 0);
  let subscribers = kind === "growth" ? daily.reduce((sum, row) => sum + Number("subscribers" in row ? row.subscribers : 0), 0) : 0;
  if (kind === "growth") {
    const clickFilter = rangeFilter("created_at", range);
    const [[totals]] = await pool.query<Array<RowDataPacket & { subscribers: number; spend: number; clicks: number }>>(
      `SELECT COUNT(*) subscribers,COALESCE(SUM(advertiser_debit),0) spend,
         (SELECT COUNT(*) FROM campaign_clicks WHERE campaign_id=?${clickFilter.sql}) clicks
       FROM channel_growth_conversions WHERE campaign_id=? AND status='billed' AND fraud_status='clear'${filter.sql}`,
      [campaignId, ...clickFilter.params, campaignId, ...filter.params]);
    clicks = Number(totals?.clicks || 0); spend = Number(totals?.spend || 0); subscribers = Number(totals?.subscribers || 0);
  }
  const unitCost = kind === "growth" && subscribers > 0 ? spend / subscribers : campaignEffectiveCpm(spend, views);
  return {
    campaign_id: campaignId, campaign_type: "views" as const, primary_metric: "views" as const,
    range: { key: range.key, from: range.start, to: range.end, bounded_to: MAX_CAMPAIGN_STATISTICS_DAILY_ROWS },
    totals: { views, clicks, subscribers, ctr: campaignCtr(clicks, views), conversion_rate: clicks > 0 ? metricNumber((subscribers / clicks) * 100) : 0, spend, billable_views: views, billable_clicks: 0, effective_cpm: unitCost, average_cpc: campaignAverageCpc(spend, clicks) },
    source_breakdown: { standard: { views, clicks, spend }, teaser: { views: 0, clicks: 0, spend: 0 } },
    teaser_enabled: false, daily_rows: daily.map((row) => ({ ...row, subscribers: kind === "growth" && "subscribers" in row ? Number(row.subscribers || 0) : 0 })),
    data_available: views > 0 || clicks > 0 || spend > 0,
  };
}
