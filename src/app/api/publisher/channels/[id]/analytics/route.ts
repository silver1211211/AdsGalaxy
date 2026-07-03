import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_CUSTOM_RANGE_DAYS = 366;

type OwnedChannelRow = RowDataPacket & {
  id: number;
  chat_id: string;
  subscriber_count: number | null;
};

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
  active_posts: number | string;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateKey: string, days: number) {
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

function resolveRange(url: URL, today: string) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const customDate = url.searchParams.get("date");
  if (validDateKey(from) && validDateKey(to) && from <= to) {
    const end = to > today ? today : to;
    const span = Math.min(MAX_CUSTOM_RANGE_DAYS - 1, Math.max(0, daysBetween(from, end)));
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
  const days = ["30", "30d", "last_30_days"].includes(preset) ? 30 : 7;
  return { preset: days === 30 ? "last_30_days" : "last_7_days", start: addDays(today, -(days - 1)), end: today, days };
}

async function fetchDaily(channelId: number, start: string, endExclusive: string) {
  const [rows] = await pool.query<DailyRow[]>(
    `SELECT DATE_FORMAT(stat_date, '%Y-%m-%d') AS date, views, clicks, earnings,
       view_earnings, click_earnings, view_spend, click_spend, spend, active_posts
     FROM channel_daily_stats
     WHERE channel_id = ? AND stat_date >= ? AND stat_date < ?
     ORDER BY stat_date ASC`,
    [channelId, start, endExclusive]
  );
  return rows;
}

function summarize(rows: DailyRow[]) {
  const views = rows.reduce((sum, row) => sum + number(row.views), 0);
  const clicks = rows.reduce((sum, row) => sum + number(row.clicks), 0);
  const earnings = rows.reduce((sum, row) => sum + number(row.earnings), 0);
  const viewEarnings = rows.reduce((sum, row) => sum + number(row.view_earnings), 0);
  const clickEarnings = rows.reduce((sum, row) => sum + number(row.click_earnings), 0);
  const spend = rows.reduce((sum, row) => sum + number(row.spend), 0);
  return {
    earnings: fixed(earnings, 8),
    spend: fixed(spend, 8),
    views,
    impressions: views,
    clicks,
    ctr: views > 0 ? fixed((clicks / views) * 100) : 0,
    average_cpm: views > 0 ? fixed((viewEarnings / views) * 1000, 8) : 0,
    average_cpc: clicks > 0 ? fixed(clickEarnings / clicks, 8) : 0,
    active_posts: rows.length ? number(rows[rows.length - 1].active_posts) : 0,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { id } = await params;
    const [channels] = await pool.query<OwnedChannelRow[]>(
      "SELECT id, chat_id, subscriber_count FROM channels WHERE id = ? AND user_id = ? AND is_deleted = FALSE LIMIT 1",
      [id, user.id]
    );
    const channel = channels[0];
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const [[calendar]] = await pool.query<Array<RowDataPacket & { today: string }>>(
      "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today"
    );
    const range = resolveRange(new URL(request.url), calendar.today);
    const endExclusive = addDays(range.end, 1);
    const previousStart = addDays(range.start, -range.days);

    const [currentRows, previousRows, topPosts, topCampaigns] = await Promise.all([
      fetchDaily(channel.id, range.start, endExclusive),
      fetchDaily(channel.id, previousStart, range.start),
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
        [channel.id, range.start, endExclusive]
      ).then(([rows]) => rows),
      pool.query<RowDataPacket[]>(
        `SELECT ps.campaign_id, COALESCE(c.name, 'Campaign') AS campaign_name,
           SUM(ps.views) AS views, SUM(ps.clicks) AS clicks, SUM(ps.earnings) AS earnings,
           COUNT(DISTINCT ps.post_id) AS posts
         FROM channel_post_daily_stats ps
         LEFT JOIN campaigns c ON c.id = ps.campaign_id
         WHERE ps.channel_id = ? AND ps.stat_date >= ? AND ps.stat_date < ?
         GROUP BY ps.campaign_id, c.name
         ORDER BY earnings DESC, views DESC LIMIT 10`,
        [channel.id, range.start, endExclusive]
      ).then(([rows]) => rows),
    ]);

    const current = summarize(currentRows);
    const previous = summarize(previousRows);
    const rowsByDate = new Map(currentRows.map((row) => [row.date, row]));
    const dailyRows = dayKeys(range.start, range.days).map((date) => {
      const row = rowsByDate.get(date);
      const views = number(row?.views);
      const clicks = number(row?.clicks);
      const viewEarnings = number(row?.view_earnings);
      const clickEarnings = number(row?.click_earnings);
      return {
        date,
        views,
        impressions: views,
        clicks,
        ctr: views > 0 ? fixed((clicks / views) * 100) : 0,
        earnings: fixed(number(row?.earnings), 8),
        spend: fixed(number(row?.spend), 8),
        average_cpm: views > 0 ? fixed((viewEarnings / views) * 1000, 8) : 0,
        average_cpc: clicks > 0 ? fixed(clickEarnings / clicks, 8) : 0,
        active_posts: number(row?.active_posts),
      };
    });

    return NextResponse.json({
      channel_id: channel.id,
      subscriber_count: number(channel.subscriber_count),
      range: { preset: range.preset, from: range.start, to: range.end, days: range.days },
      range_days: range.days,
      summary: {
        ...current,
        cpm: current.average_cpm,
        cpc: current.average_cpc,
        prev_earnings: previous.earnings,
        prev_views: previous.views,
        prev_clicks: previous.clicks,
        prev_ctr: previous.ctr,
        prev_cpm: previous.average_cpm,
        prev_cpc: previous.average_cpc,
      },
      trends: {
        labels: dailyRows.map((row) => row.date),
        views: dailyRows.map((row) => row.views),
        clicks: dailyRows.map((row) => row.clicks),
        earnings: dailyRows.map((row) => row.earnings),
        ctr: dailyRows.map((row) => row.ctr),
      },
      trend: {
        labels: dailyRows.map((row) => row.date),
        views: dailyRows.map((row) => row.views),
        clicks: dailyRows.map((row) => row.clicks),
        earnings: dailyRows.map((row) => row.earnings),
      },
      daily_rows: dailyRows,
      top_posts: topPosts.map((row) => ({
        post_id: number(row.post_id), message_id: String(row.message_id || ""), campaign_id: number(row.campaign_id),
        campaign_name: String(row.campaign_name), views: number(row.views), clicks: number(row.clicks),
        ctr: fixed(number(row.ctr)), earnings: fixed(number(row.earnings), 8),
      })),
      top_campaigns: topCampaigns.map((row) => ({
        campaign_id: number(row.campaign_id), campaign_name: String(row.campaign_name), posts: number(row.posts),
        views: number(row.views), clicks: number(row.clicks), earnings: fixed(number(row.earnings), 8),
      })),
      data_available: currentRows.length > 0,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load channel analytics";
    console.error("GET Channel Analytics Error:", message);
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
