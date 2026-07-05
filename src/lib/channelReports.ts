/* eslint-disable @typescript-eslint/no-explicit-any -- legacy channel aggregate payloads are not schema-generated */
import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { cpc, cpm, ctr, fixedMetric, metricNumber } from "@/lib/statFormulas";

export const MAX_CHANNEL_ANALYTICS_RANGE_DAYS = 366;

type DailyRow = RowDataPacket & {
  date: string;
  views: number | string;
  clicks: number | string;
  earnings: number | string;
  view_earnings: number | string;
  click_earnings: number | string;
  view_spend: number | string;
  click_spend: number | string;
  spend: number | string;
  platform_revenue: number | string;
  reserve_amount: number | string;
  active_posts: number | string;
};

export function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000);
}

function dayKeys(start: string, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function resolveChannelAnalyticsRange(url: URL, today: string) {
  const from = url.searchParams.get("from") || url.searchParams.get("start");
  const to = url.searchParams.get("to") || url.searchParams.get("end");
  const customDate = url.searchParams.get("date");
  if (validDateKey(from) && validDateKey(to) && from <= to) {
    const end = to > today ? today : to;
    const span = Math.min(MAX_CHANNEL_ANALYTICS_RANGE_DAYS - 1, Math.max(0, daysBetween(from, end)));
    return { preset: "custom", start: addDays(end, -span), end, days: span + 1 };
  }
  if (validDateKey(customDate)) {
    const date = customDate > today ? today : customDate;
    return { preset: "custom_date", start: date, end: date, days: 1 };
  }

  const preset = (url.searchParams.get("range") || "7").toLowerCase();
  if (preset === "today" || preset === "1") return { preset: "today", start: today, end: today, days: 1 };
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return { preset: "yesterday", start: yesterday, end: yesterday, days: 1 };
  }
  const days = ["30", "30d", "last30", "last_30_days"].includes(preset) ? 30 : 7;
  return { preset: days === 30 ? "last_30_days" : "last_7_days", start: addDays(today, -(days - 1)), end: today, days };
}

export async function databaseToday() {
  const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>(
    "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today"
  );
  return String(calendar.today);
}

async function fetchDaily(channelId: number | string, start: string, endExclusive: string) {
  const [rows] = await pool.query<DailyRow[]>(
    `SELECT DATE_FORMAT(stat_date, '%Y-%m-%d') AS date, views, clicks, earnings,
       view_earnings, click_earnings, view_spend, click_spend, spend,
       platform_revenue, reserve_amount, active_posts
     FROM channel_daily_stats
     WHERE channel_id = ? AND stat_date >= ? AND stat_date < ?
     ORDER BY stat_date ASC`,
    [channelId, start, endExclusive]
  );
  return rows;
}

function summarize(rows: DailyRow[]) {
  const views = rows.reduce((sum, row) => sum + metricNumber(row.views), 0);
  const clicks = rows.reduce((sum, row) => sum + metricNumber(row.clicks), 0);
  const earnings = rows.reduce((sum, row) => sum + metricNumber(row.earnings), 0);
  const viewEarnings = rows.reduce((sum, row) => sum + metricNumber(row.view_earnings), 0);
  const clickEarnings = rows.reduce((sum, row) => sum + metricNumber(row.click_earnings), 0);
  const viewSpend = rows.reduce((sum, row) => sum + metricNumber(row.view_spend), 0);
  const clickSpend = rows.reduce((sum, row) => sum + metricNumber(row.click_spend), 0);
  const spend = rows.reduce((sum, row) => sum + metricNumber(row.spend), 0);
  const platformRevenue = rows.reduce((sum, row) => sum + metricNumber(row.platform_revenue), 0);
  const reserveAmount = rows.reduce((sum, row) => sum + metricNumber(row.reserve_amount), 0);

  return {
    earnings: fixedMetric(earnings, 8),
    publisher_revenue: fixedMetric(earnings, 8),
    spend: fixedMetric(spend, 8),
    advertiser_spend: fixedMetric(spend, 8),
    platform_revenue: fixedMetric(platformRevenue, 8),
    ads_galaxy_revenue: fixedMetric(platformRevenue, 8),
    reserve_amount: fixedMetric(reserveAmount, 8),
    views,
    impressions: views,
    clicks,
    ctr: ctr(clicks, views),
    average_cpm: cpm(viewSpend, views),
    cpm: cpm(viewSpend, views),
    average_cpc: cpc(clickSpend, clicks),
    cpc: cpc(clickSpend, clicks),
    effective_publisher_cpm: cpm(viewEarnings, views),
    effective_publisher_cpc: cpc(clickEarnings, clicks),
    active_posts: rows.length ? metricNumber(rows[rows.length - 1].active_posts) : 0,
  };
}

export async function buildChannelAnalyticsReport(channelId: number | string, range: ReturnType<typeof resolveChannelAnalyticsRange>) {
  const endExclusive = addDays(range.end, 1);
  const previousStart = addDays(range.start, -range.days);

  const [currentRows, previousRows, topPosts, topCampaigns] = await Promise.all([
    fetchDaily(channelId, range.start, endExclusive),
    fetchDaily(channelId, previousStart, range.start),
    pool.query<RowDataPacket[]>(
      `SELECT ps.post_id, cp.message_id, ps.campaign_id, COALESCE(c.name, 'Campaign') AS campaign_name,
         SUM(ps.views) AS views, SUM(ps.clicks) AS clicks, SUM(ps.earnings) AS earnings,
         IF(SUM(ps.views) > 0, (SUM(ps.clicks) / SUM(ps.views)) * 100, 0) AS ctr
       FROM channel_post_daily_stats ps
       JOIN campaign_posts cp ON cp.id = ps.post_id
       LEFT JOIN campaigns c ON c.id = ps.campaign_id
       WHERE ps.channel_id = ? AND ps.stat_date >= ? AND ps.stat_date < ?
       GROUP BY ps.post_id, cp.message_id, ps.campaign_id, c.name
       ORDER BY views DESC, clicks DESC LIMIT 10`,
      [channelId, range.start, endExclusive]
    ).then(([rows]) => rows),
    pool.query<RowDataPacket[]>(
      `SELECT ps.campaign_id, COALESCE(c.name, 'Campaign') AS campaign_name,
         SUM(ps.views) AS views, SUM(ps.clicks) AS clicks, SUM(ps.earnings) AS earnings,
         SUM(ps.spend) AS spend, COUNT(DISTINCT ps.post_id) AS posts
       FROM channel_post_daily_stats ps
       LEFT JOIN campaigns c ON c.id = ps.campaign_id
       WHERE ps.channel_id = ? AND ps.stat_date >= ? AND ps.stat_date < ?
       GROUP BY ps.campaign_id, c.name
       ORDER BY earnings DESC, views DESC LIMIT 10`,
      [channelId, range.start, endExclusive]
    ).then(([rows]) => rows),
  ]);

  const current = summarize(currentRows);
  const previous = summarize(previousRows);
  const rowsByDate = new Map(currentRows.map((row) => [row.date, row]));
  const dailyRows = dayKeys(range.start, range.days).map((date) => {
    const row = rowsByDate.get(date);
    const views = metricNumber(row?.views);
    const clicks = metricNumber(row?.clicks);
    const viewSpend = metricNumber(row?.view_spend);
    const clickSpend = metricNumber(row?.click_spend);
    const viewEarnings = metricNumber(row?.view_earnings);
    const clickEarnings = metricNumber(row?.click_earnings);
    return {
      date,
      views,
      impressions: views,
      clicks,
      ctr: ctr(clicks, views),
      earnings: fixedMetric(metricNumber(row?.earnings), 8),
      publisher_revenue: fixedMetric(metricNumber(row?.earnings), 8),
      spend: fixedMetric(metricNumber(row?.spend), 8),
      advertiser_spend: fixedMetric(metricNumber(row?.spend), 8),
      platform_revenue: fixedMetric(metricNumber(row?.platform_revenue), 8),
      ads_galaxy_revenue: fixedMetric(metricNumber(row?.platform_revenue), 8),
      reserve_amount: fixedMetric(metricNumber(row?.reserve_amount), 8),
      average_cpm: cpm(viewSpend, views),
      cpm: cpm(viewSpend, views),
      average_cpc: cpc(clickSpend, clicks),
      cpc: cpc(clickSpend, clicks),
      effective_publisher_cpm: cpm(viewEarnings, views),
      effective_publisher_cpc: cpc(clickEarnings, clicks),
      active_posts: metricNumber(row?.active_posts),
    };
  });

  return {
    range: { preset: range.preset, from: range.start, to: range.end, days: range.days },
    range_days: range.days,
    summary: {
      ...current,
      prev_earnings: previous.earnings,
      prev_views: previous.views,
      prev_clicks: previous.clicks,
      prev_ctr: previous.ctr,
      prev_cpm: previous.average_cpm,
      prev_cpc: previous.average_cpc,
      previous,
    },
    trends: {
      labels: dailyRows.map((row) => row.date),
      views: dailyRows.map((row) => row.views),
      impressions: dailyRows.map((row) => row.impressions),
      clicks: dailyRows.map((row) => row.clicks),
      earnings: dailyRows.map((row) => row.earnings),
      spend: dailyRows.map((row) => row.spend),
      ctr: dailyRows.map((row) => row.ctr),
      cpm: dailyRows.map((row) => row.cpm),
      cpc: dailyRows.map((row) => row.cpc),
    },
    trend: {
      labels: dailyRows.map((row) => row.date),
      views: dailyRows.map((row) => row.views),
      clicks: dailyRows.map((row) => row.clicks),
      earnings: dailyRows.map((row) => row.earnings),
    },
    daily_rows: dailyRows,
    top_posts: topPosts.map((row: any) => ({
      post_id: metricNumber(row.post_id),
      message_id: String(row.message_id || ""),
      campaign_id: metricNumber(row.campaign_id),
      campaign_name: String(row.campaign_name),
      views: metricNumber(row.views),
      impressions: metricNumber(row.views),
      clicks: metricNumber(row.clicks),
      ctr: fixedMetric(metricNumber(row.ctr)),
      earnings: fixedMetric(metricNumber(row.earnings), 8),
      publisher_revenue: fixedMetric(metricNumber(row.earnings), 8),
    })),
    top_campaigns: topCampaigns.map((row: any) => ({
      campaign_id: metricNumber(row.campaign_id),
      campaign_name: String(row.campaign_name),
      posts: metricNumber(row.posts),
      views: metricNumber(row.views),
      impressions: metricNumber(row.views),
      clicks: metricNumber(row.clicks),
      ctr: ctr(row.clicks, row.views),
      spend: fixedMetric(metricNumber(row.spend), 8),
      earnings: fixedMetric(metricNumber(row.earnings), 8),
      publisher_revenue: fixedMetric(metricNumber(row.earnings), 8),
    })),
    data_available: currentRows.length > 0,
  };
}
