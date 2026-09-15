import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { logPublisherChannelError, publisherChannelError } from "@/lib/publisherChannelErrors";
import { buildChannelAnalyticsReport, databaseToday, resolveChannelAnalyticsRange } from "@/lib/channelReports";
import { cpc, cpm, ctr, fixedMetric, metricNumber } from "@/lib/statFormulas";

export const dynamic = "force-dynamic";

type OwnedChannelRow = RowDataPacket & {
  id: number;
  chat_id: string;
  subscriber_count: number | null;
};

type SourceRow = RowDataPacket & {
  date: string;
  impressions?: number | string;
  clicks?: number | string;
  earnings?: number | string;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { id } = await params;
    const [channels] = await pool.query<OwnedChannelRow[]>(
      "SELECT id, chat_id, subscriber_count FROM channels WHERE id = ? AND user_id = ? AND is_deleted = FALSE LIMIT 1",
      [id, user.id]
    );
    const channel = channels[0];
    if (!channel) return publisherChannelError("CHANNEL_NOT_ACCESSIBLE", 404);

    const today = await databaseToday();
    const range = resolveChannelAnalyticsRange(new URL(request.url), today);
    const report = await buildChannelAnalyticsReport(channel.id, range);
    const requestedSource = new URL(request.url).searchParams.get("source");
    const source = requestedSource === "channel" || requestedSource === "teaser" ? requestedSource : "all";
    const endExclusive = new Date(`${range.end}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const endExclusiveKey = endExclusive.toISOString().slice(0, 10);

    const [teaserRows, growthRows] = await Promise.all([
      pool.query<SourceRow[]>(
        `SELECT days.date,
                SUM(days.impressions) AS impressions,
                SUM(days.clicks) AS clicks,
                SUM(days.earnings) AS earnings
           FROM (
             SELECT DATE_FORMAT(ts.created_at, '%Y-%m-%d') AS date,
                    SUM(ts.impression_delta) AS impressions, 0 AS clicks,
                    SUM(ts.publisher_amount) AS earnings
               FROM teaser_settlements ts
               JOIN teaser_placements tp ON tp.id = ts.placement_id
              WHERE tp.channel_id = ? AND ts.created_at >= ? AND ts.created_at < ?
              GROUP BY DATE(ts.created_at)
             UNION ALL
             SELECT DATE_FORMAT(tc.created_at, '%Y-%m-%d') AS date,
                    0 AS impressions, COUNT(*) AS clicks, 0 AS earnings
               FROM teaser_clicks tc
               JOIN teaser_placements tp ON tp.id = tc.placement_id
              WHERE tp.channel_id = ? AND tc.created_at >= ? AND tc.created_at < ?
              GROUP BY DATE(tc.created_at)
           ) days
          GROUP BY days.date`,
        [channel.id, range.start, endExclusiveKey, channel.id, range.start, endExclusiveKey]
      ).then(([rows]) => rows),
      pool.query<SourceRow[]>(
        `SELECT growth.date, SUM(growth.earnings) AS earnings
           FROM (
             SELECT DATE_FORMAT(billed_at, '%Y-%m-%d') AS date,
                    SUM(publisher_allocation) AS earnings
               FROM channel_growth_conversions
              WHERE source_channel_id = ? AND status = 'billed'
                AND billed_at >= ? AND billed_at < ?
              GROUP BY DATE(billed_at)
             UNION ALL
             SELECT DATE_FORMAT(settled_at, '%Y-%m-%d') AS date,
                    SUM(publisher_credit) AS earnings
               FROM channel_growth_seed_ledger
              WHERE source_channel_id = ? AND status = 'settled'
                AND settled_at >= ? AND settled_at < ?
              GROUP BY DATE(settled_at)
           ) growth
          GROUP BY growth.date`,
        [channel.id, range.start, endExclusiveKey, channel.id, range.start, endExclusiveKey]
      ).then(([rows]) => rows),
    ]);

    const teaserByDate = new Map(teaserRows.map((row) => [String(row.date), row]));
    const growthByDate = new Map(growthRows.map((row) => [String(row.date), metricNumber(row.earnings)]));
    const dailyRows = report.daily_rows.map((base) => {
      const teaser = teaserByDate.get(base.date);
      const channelViews = metricNumber(base.views);
      const channelClicks = metricNumber(base.clicks);
      const channelEarnings = metricNumber(base.earnings) + (growthByDate.get(base.date) || 0);
      const teaserViews = metricNumber(teaser?.impressions);
      const teaserClicks = metricNumber(teaser?.clicks);
      const teaserEarnings = metricNumber(teaser?.earnings);
      const views = source === "teaser" ? teaserViews : source === "channel" ? channelViews : channelViews + teaserViews;
      const clicks = source === "teaser" ? teaserClicks : source === "channel" ? channelClicks : channelClicks + teaserClicks;
      const earnings = source === "teaser" ? teaserEarnings : source === "channel" ? channelEarnings : channelEarnings + teaserEarnings;
      return {
        ...base,
        views,
        impressions: views,
        clicks,
        earnings: fixedMetric(earnings, 8),
        publisher_revenue: fixedMetric(earnings, 8),
        ctr: ctr(clicks, views),
        cpm_eligible: views > 0 && earnings > 0,
        average_cpm: cpm(earnings, views),
        cpm: cpm(earnings, views),
        average_cpc: cpc(earnings, clicks),
        cpc: cpc(earnings, clicks),
        effective_publisher_cpm: cpm(earnings, views),
        effective_publisher_cpc: cpc(earnings, clicks),
      };
    });
    const totals = dailyRows.reduce((sum, row) => ({
      views: sum.views + row.views,
      clicks: sum.clicks + row.clicks,
      earnings: sum.earnings + row.earnings,
    }), { views: 0, clicks: 0, earnings: 0 });
    const summary = {
      ...report.summary,
      views: totals.views,
      impressions: totals.views,
      clicks: totals.clicks,
      earnings: fixedMetric(totals.earnings, 8),
      publisher_revenue: fixedMetric(totals.earnings, 8),
      ctr: ctr(totals.clicks, totals.views),
      cpm_eligible: totals.views > 0 && totals.earnings > 0,
      average_cpm: cpm(totals.earnings, totals.views),
      cpm: cpm(totals.earnings, totals.views),
      average_cpc: cpc(totals.earnings, totals.clicks),
      cpc: cpc(totals.earnings, totals.clicks),
      effective_publisher_cpm: cpm(totals.earnings, totals.views),
      effective_publisher_cpc: cpc(totals.earnings, totals.clicks),
    };
    const trend = {
      labels: dailyRows.map((row) => row.date),
      views: dailyRows.map((row) => row.views),
      clicks: dailyRows.map((row) => row.clicks),
      earnings: dailyRows.map((row) => row.earnings),
    };

    return NextResponse.json({
      channel_id: channel.id,
      subscriber_count: metricNumber(channel.subscriber_count),
      ...report,
      source,
      summary,
      trend,
      trends: { ...report.trends, ...trend, impressions: trend.views },
      daily_rows: dailyRows,
      data_available: dailyRows.some((row) => row.views > 0 || row.clicks > 0 || row.earnings > 0),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    logPublisherChannelError("analytics", error);
    return publisherChannelError("CHANNEL_ANALYTICS_FAILED", getAuthErrorStatus(error));
  }
}
