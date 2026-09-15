import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { buildAudienceAnalytics, buildAudienceInventoryScope, calculateCtr } from "@/lib/audienceAnalytics";
import { CAMPAIGN_CATEGORY_OPTIONS, normalizeCampaignCategoryList } from "@/lib/campaignCategories";

export const dynamic = "force-dynamic";

type TeaserChannelRow = RowDataPacket & {
  id: number;
  subscriber_count: number | string | null;
  audience_continents: unknown;
  categories: unknown;
};

type TeaserMetricRow = RowDataPacket & {
  channel_id: number;
  today_views: number | string | null;
  today_clicks: number | string | null;
  weekly_views: number | string | null;
  weekly_clicks: number | string | null;
  monthly_views: number | string | null;
  monthly_clicks: number | string | null;
};

function metricNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCategoryAnalytics(channels: TeaserChannelRow[], metrics: TeaserMetricRow[]) {
  const metricByChannel = new Map(metrics.map((metric) => [Number(metric.channel_id), metric]));
  const weightedChannels = channels.map((channel) => {
    const normalized = normalizeCampaignCategoryList(channel.categories).filter((category) => category !== "all");
    const assignedCategories = normalized.length > 0 ? normalized : ["other"];
    return { channel, assignedCategories, weight: 1 / assignedCategories.length };
  });
  return CAMPAIGN_CATEGORY_OPTIONS
    .filter((category) => category.value !== "all")
    .map((category) => {
      const matchingChannels = weightedChannels.filter(({ assignedCategories }) => assignedCategories.includes(category.value));
      const aggregate = (viewsKey: "today_views" | "weekly_views" | "monthly_views", clicksKey: "today_clicks" | "weekly_clicks" | "monthly_clicks") => {
        const views = matchingChannels.reduce((sum, { channel, weight }) => sum + metricNumber(metricByChannel.get(Number(channel.id))?.[viewsKey]) * weight, 0);
        const clicks = matchingChannels.reduce((sum, { channel, weight }) => sum + metricNumber(metricByChannel.get(Number(channel.id))?.[clicksKey]) * weight, 0);
        return { views, clicks, ctr: calculateCtr(clicks, views) };
      };
      return {
        key: category.value,
        label: category.label,
        channels: matchingChannels.reduce((sum, { weight }) => sum + weight, 0),
        subscribers: matchingChannels.reduce((sum, { channel, weight }) => sum + Math.max(0, metricNumber(channel.subscriber_count)) * weight, 0),
        today: aggregate("today_views", "today_clicks"),
        weekly: aggregate("weekly_views", "weekly_clicks"),
        monthly: aggregate("monthly_views", "monthly_clicks"),
      };
    });
}

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [[summary], [channels], [metricRows]] = await Promise.all([
      pool.query<RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM teaser_placements
            WHERE status IN ('active', 'awaiting_baseline')) AS active_placements,
          (SELECT COUNT(*) FROM channels
            WHERE status='active' AND teaser_enabled=1 AND teaser_status='active' AND is_deleted=FALSE) AS enabled_channels,
          (SELECT COUNT(*) FROM channels
            WHERE status='active' AND teaser_enabled=1 AND teaser_status='needs_permission' AND is_deleted=FALSE) AS needs_permission
      `),
      pool.query<TeaserChannelRow[]>(`
        SELECT id, subscriber_count, audience_continents, categories
        FROM channels
        WHERE status='active'
          AND teaser_enabled=1
          AND teaser_status='active'
          AND is_deleted=FALSE
      `),
      pool.query<TeaserMetricRow[]>(`
        SELECT
          channel_id,
          SUM(today_views) AS today_views,
          SUM(today_clicks) AS today_clicks,
          SUM(weekly_views) AS weekly_views,
          SUM(weekly_clicks) AS weekly_clicks,
          SUM(monthly_views) AS monthly_views,
          SUM(monthly_clicks) AS monthly_clicks
        FROM (
          SELECT
            tp.channel_id,
            COALESCE(SUM(CASE WHEN ts.created_at >= UTC_DATE() THEN ts.impression_delta ELSE 0 END), 0) AS today_views,
            0 AS today_clicks,
            COALESCE(SUM(CASE WHEN ts.created_at >= UTC_DATE() - INTERVAL 6 DAY THEN ts.impression_delta ELSE 0 END), 0) AS weekly_views,
            0 AS weekly_clicks,
            COALESCE(SUM(ts.impression_delta), 0) AS monthly_views,
            0 AS monthly_clicks
          FROM teaser_placements tp
          JOIN teaser_settlements ts ON ts.placement_id=tp.id
          WHERE ts.created_at >= UTC_DATE() - INTERVAL 29 DAY
          GROUP BY tp.channel_id

          UNION ALL

          SELECT
            tp.channel_id,
            0 AS today_views,
            COALESCE(SUM(tc.created_at >= UTC_DATE()), 0) AS today_clicks,
            0 AS weekly_views,
            COALESCE(SUM(tc.created_at >= UTC_DATE() - INTERVAL 6 DAY), 0) AS weekly_clicks,
            0 AS monthly_views,
            COUNT(*) AS monthly_clicks
          FROM teaser_placements tp
          JOIN teaser_clicks tc ON tc.placement_id=tp.id
          WHERE tc.created_at >= UTC_DATE() - INTERVAL 29 DAY
          GROUP BY tp.channel_id
        ) recent_teaser
        GROUP BY channel_id
      `),
    ]);

    const audiences = buildAudienceAnalytics(channels, metricRows);
    const categories = buildCategoryAnalytics(channels, metricRows);
    const scope = buildAudienceInventoryScope(channels);

    return NextResponse.json({
      summary: summary[0] || {},
      audiences,
      categories,
      scope: {
        ...scope,
        channel_status: "active",
        teaser_enabled: true,
        teaser_permission: "active",
        category_targeting: "Campaign category is matched against channel categories during placement; reporting is proportionally allocated across each channel's categories.",
        audience_targeting: "Campaign audience is matched against the channel audience during placement.",
        today: "current UTC day",
        weekly: "last 7 UTC days including today",
        monthly: "last 30 UTC days including today",
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Teaser analytics query failed", {
      errorType: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "TEASER_JOB_LOAD_FAILED" }, { status: 500 });
  }
}
