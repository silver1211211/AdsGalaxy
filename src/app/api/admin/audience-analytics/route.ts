import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { buildAnalyticsSummary, buildAudienceAnalytics, buildAudienceInventoryScope } from "@/lib/audienceAnalytics";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 20_000;
let analyticsCache: { expiresAt: number; inventorySignature: string; payload: Record<string, unknown> } | null = null;

async function tableExists(table: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1",
    [table],
  );
  return rows.length > 0;
}

async function inventorySnapshot(hasGeo: boolean) {
  const [[channels]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(`
    SELECT COUNT(*) total_non_deleted_channels,
      SUM(status='active') active_channels,
      MAX(updated_at) latest_channel_update,
      COALESCE(SUM(CASE WHEN status='active' THEN CRC32(CONCAT_WS('|',id,status,is_deleted,
        COALESCE(audience_continents,''),COALESCE(subscriber_count,0),updated_at)) ELSE 0 END),0) active_checksum
    FROM channels WHERE is_deleted=FALSE`);
  let geo = { geo_rows: 0, latest_geo_update: null, geo_checksum: 0 } as Record<string, unknown>;
  if (hasGeo) {
    const [[row]] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(`
      SELECT COUNT(*) geo_rows,MAX(updated_at) latest_geo_update,
        COALESCE(SUM(CRC32(CONCAT_WS('|',channel_id,COALESCE(authoritative_region,''),confidence,conflict_detected,status,updated_at))),0) geo_checksum
      FROM channel_geo_classifications`);
    geo = row || geo;
  }
  return {
    total_non_deleted_channels: Number(channels?.total_non_deleted_channels || 0),
    active_channels: Number(channels?.active_channels || 0),
    signature: JSON.stringify([channels?.active_channels, channels?.latest_channel_update, channels?.active_checksum, geo.geo_rows, geo.latest_geo_update, geo.geo_checksum]),
  };
}

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const hasGeo = await tableExists("channel_geo_classifications");
    const inventory = await inventorySnapshot(hasGeo);
    if (analyticsCache && analyticsCache.expiresAt > Date.now() && analyticsCache.inventorySignature === inventory.signature) {
      return NextResponse.json(analyticsCache.payload);
    }
    const geoFields = hasGeo
      ? `,g.authoritative_region geo_authoritative_region,g.confidence geo_confidence,
          g.conflict_detected geo_conflict_detected,g.status geo_status`
      : `,NULL geo_authoritative_region,'unknown' geo_confidence,0 geo_conflict_detected,NULL geo_status`;
    const geoJoin = hasGeo ? "LEFT JOIN channel_geo_classifications g ON g.channel_id=c.id" : "";
    const [channels] = await pool.query<Array<RowDataPacket & {
      id: number;
      subscriber_count: number | string | null;
      audience_continents: unknown;
      geo_authoritative_region: unknown;
      geo_confidence: unknown;
      geo_conflict_detected: unknown;
      geo_status: unknown;
    }>>(`
      SELECT c.id,c.subscriber_count,c.audience_continents ${geoFields}
      FROM channels c ${geoJoin}
      WHERE c.status='active' AND c.is_deleted=FALSE
    `);

    const partialErrors: string[] = [];
    let metricRows: Array<RowDataPacket & {
      channel_id: number;
      today_views: number | string | null;
      today_clicks: number | string | null;
      weekly_views: number | string | null;
      weekly_clicks: number | string | null;
      monthly_views: number | string | null;
      monthly_clicks: number | string | null;
    }> = [];
    try {
      const [rows] = await pool.query<typeof metricRows>(`
        SELECT
          channel_id,
          SUM(CASE WHEN stat_date = CURDATE() THEN views ELSE 0 END) AS today_views,
          SUM(CASE WHEN stat_date = CURDATE() THEN clicks ELSE 0 END) AS today_clicks,
          SUM(CASE WHEN stat_date >= CURDATE() - INTERVAL 6 DAY THEN views ELSE 0 END) AS weekly_views,
          SUM(CASE WHEN stat_date >= CURDATE() - INTERVAL 6 DAY THEN clicks ELSE 0 END) AS weekly_clicks,
          SUM(views) AS monthly_views,
          SUM(clicks) AS monthly_clicks
        FROM channel_daily_stats
        WHERE stat_date >= CURDATE() - INTERVAL 29 DAY
        GROUP BY channel_id
      `);
      metricRows = rows;
    } catch (error) {
      partialErrors.push("Recent channel view and click analytics are temporarily unavailable.");
      console.error("Audience analytics metric aggregation failed", {
        errorType: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }

    const audiences = buildAudienceAnalytics(channels, metricRows);
    const audienceScope = buildAudienceInventoryScope(channels);
    let miniApp = {
      today_views: 0, today_clicks: 0,
      weekly_views: 0, weekly_clicks: 0,
      monthly_views: 0, monthly_clicks: 0,
    };
    try {
      const [rows] = await pool.query<Array<RowDataPacket & typeof miniApp>>(`
        SELECT
          (SELECT COALESCE(SUM(CASE WHEN date = CURDATE() THEN impressions ELSE 0 END), 0)
             FROM miniapp_daily_stats WHERE date >= CURDATE() - INTERVAL 29 DAY) AS today_views,
          (SELECT COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN 1 ELSE 0 END), 0)
             FROM ad_click_attribution WHERE campaign_type = 'miniapp'
               AND created_at >= CURDATE() - INTERVAL 29 DAY) AS today_clicks,
          (SELECT COALESCE(SUM(CASE WHEN date >= CURDATE() - INTERVAL 6 DAY THEN impressions ELSE 0 END), 0)
             FROM miniapp_daily_stats WHERE date >= CURDATE() - INTERVAL 29 DAY) AS weekly_views,
          (SELECT COALESCE(SUM(CASE WHEN created_at >= CURDATE() - INTERVAL 6 DAY THEN 1 ELSE 0 END), 0)
             FROM ad_click_attribution WHERE campaign_type = 'miniapp'
               AND created_at >= CURDATE() - INTERVAL 29 DAY) AS weekly_clicks,
          (SELECT COALESCE(SUM(impressions), 0)
             FROM miniapp_daily_stats WHERE date >= CURDATE() - INTERVAL 29 DAY) AS monthly_views,
          (SELECT COUNT(*) FROM ad_click_attribution WHERE campaign_type = 'miniapp'
             AND created_at >= CURDATE() - INTERVAL 29 DAY) AS monthly_clicks
      `);
      if (rows[0]) miniApp = rows[0];
    } catch (error) {
      partialErrors.push("Recent Mini App view and click analytics are temporarily unavailable.");
      console.error("Audience analytics Mini App aggregation failed", {
        errorType: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }

    const payload = {
      audiences,
      summary: buildAnalyticsSummary(audiences, miniApp),
      scope: {
        total_non_deleted_channels: inventory.total_non_deleted_channels,
        ...audienceScope,
        channel_status: "active",
        deleted_channels_included: false,
        review_filter: "No additional review filter; matches Admin Channels active definition.",
        geo_precedence: "Current non-conflicting authoritative GEO, then stored channel audience, then unclassified.",
        today: "current database server day",
        weekly: "last 7 days including today",
        monthly: "last 30 days including today",
        cache_seconds: CACHE_TTL_MS / 1000,
      },
      partial_error: partialErrors.join(" ") || null,
      generated_at: new Date().toISOString(),
    };
    analyticsCache = { expiresAt: Date.now() + CACHE_TTL_MS, inventorySignature: inventory.signature, payload };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Audience analytics capacity query failed", {
      errorType: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Audience analytics are temporarily unavailable" }, { status: 500 });
  }
}
