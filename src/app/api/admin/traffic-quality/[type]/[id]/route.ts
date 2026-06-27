import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { calculateTrafficQuality, maybeQueueTrafficReview, persistTrafficQuality } from "@/lib/trafficQuality";
import { isTrafficEntityType } from "@/lib/trafficQualityRefresh";
import { calculateInventoryMetrics, maybeQueueInventoryAttention, persistInventoryMetrics } from "@/lib/inventoryOptimization";
import { getInternalAdCompletionAnalytics } from "@/lib/internalAdCompletionQuality";

function parseJsonObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

async function getEntityName(entityType: string, entityId: number) {
  if (entityType === "miniapp") {
    const [[row]]: any = await pool.query("SELECT miniapp_name as name FROM miniapps WHERE id = ?", [entityId]);
    return row?.name || `Mini App #${entityId}`;
  }
  if (entityType === "channel") {
    const [[row]]: any = await pool.query("SELECT title as name FROM channels WHERE id = ?", [entityId]);
    return row?.name || `Channel #${entityId}`;
  }
  const [[row]]: any = await pool.query("SELECT bot_name as name FROM bots WHERE id = ?", [entityId]);
  return row?.name || `Bot #${entityId}`;
}

async function getTrafficTrend(entityType: string, entityId: number) {
  const [rows]: any = await pool.query(`
    SELECT date, quality_score, impressions, unique_users, repeat_user_ratio, top_user_impression_ratio, velocity_score
    FROM traffic_quality_daily_scores
    WHERE entity_type = ? AND entity_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    ORDER BY date ASC
  `, [entityType, entityId]);
  return rows;
}

async function getMiniAppDetails(entityId: number) {
  const [countries]: any = await pool.query(`
    SELECT COALESCE(country, 'unknown') as label, COUNT(*) as impressions
    FROM miniapp_mediation_requests
    WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY COALESCE(country, 'unknown')
    ORDER BY impressions DESC
    LIMIT 10
  `, [entityId]);

  const [sessions]: any = await pool.query(`
    SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as label, COUNT(*) as impressions
    FROM miniapp_mediation_requests
    WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
    ORDER BY label ASC
  `, [entityId]);

  const [topUsers]: any = await pool.query(`
    SELECT telegram_user_id as user_id, COUNT(*) as impressions
    FROM miniapp_mediation_requests
    WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY telegram_user_id
    ORDER BY impressions DESC
    LIMIT 10
  `, [entityId]);
  const completionAnalytics = await getInternalAdCompletionAnalytics({
    conn: pool,
    miniappId: entityId,
  });

  return {
    country_breakdown: countries,
    device_breakdown: [],
    language_breakdown: [],
    session_breakdown: sessions,
    top_repeat_users: topUsers,
    completion_analytics: completionAnalytics,
    unavailable_signals: ["device_distribution", "language_distribution", "vpn_proxy_ratio"],
  };
}

async function getChannelDetails(entityId: number) {
  const [sessions]: any = await pool.query(`
    SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as label, COALESCE(SUM(views), 0) as impressions
    FROM campaign_posts
    WHERE channel_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
    ORDER BY label ASC
  `, [entityId]);

  const [auditRows]: any = await pool.query(`
    SELECT cva.status as label, COUNT(*) as count
    FROM campaign_views_audit cva
    JOIN campaign_posts cp ON cp.id = cva.post_id
    WHERE cp.channel_id = ? AND cva.check_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY cva.status
  `, [entityId]);

  return {
    country_breakdown: [],
    device_breakdown: [],
    language_breakdown: [],
    session_breakdown: sessions,
    audit_breakdown: auditRows,
    top_repeat_users: [],
    completion_analytics: null,
    unavailable_signals: ["per_user_channel_impressions", "country_distribution", "device_distribution", "language_distribution", "vpn_proxy_ratio"],
  };
}

async function getBotDetails(entityId: number) {
  const [sessions]: any = await pool.query(`
    SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as label, COUNT(*) as impressions
    FROM broadcast_deliveries
    WHERE bot_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
    ORDER BY label ASC
  `, [entityId]);

  const [topUsers]: any = await pool.query(`
    SELECT user_id, COUNT(*) as impressions
    FROM broadcast_deliveries
    WHERE bot_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY user_id
    ORDER BY impressions DESC
    LIMIT 10
  `, [entityId]);

  return {
    country_breakdown: [],
    device_breakdown: [],
    language_breakdown: [],
    session_breakdown: sessions,
    top_repeat_users: topUsers,
    completion_analytics: null,
    unavailable_signals: ["country_distribution", "device_distribution", "language_distribution", "vpn_proxy_ratio"],
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type, id } = await params;
  const entityId = Number(id);
  if (!isTrafficEntityType(type) || !Number.isInteger(entityId) || entityId <= 0) {
    return NextResponse.json({ error: "Invalid traffic entity" }, { status: 400 });
  }

  try {
    const metrics = await calculateTrafficQuality(type, entityId);
    await persistTrafficQuality(metrics);
    await maybeQueueTrafficReview(metrics);
    const inventory = await calculateInventoryMetrics(type, entityId);
    await persistInventoryMetrics(inventory);
    await maybeQueueInventoryAttention(inventory);

    const entityName = await getEntityName(type, entityId);
    const trend = await getTrafficTrend(type, entityId);
    const details = type === "miniapp"
      ? await getMiniAppDetails(entityId)
      : type === "channel"
        ? await getChannelDetails(entityId)
        : await getBotDetails(entityId);

    return NextResponse.json({
      entity: {
        type,
        id: entityId,
        name: entityName,
      },
      metrics: {
        ...metrics,
        country_breakdown: parseJsonObject(metrics.country_breakdown),
        device_breakdown: parseJsonObject(metrics.device_breakdown),
        language_breakdown: parseJsonObject(metrics.language_breakdown),
        session_breakdown: parseJsonObject(metrics.session_breakdown),
        signal_metadata: parseJsonObject(metrics.signal_metadata),
      },
      inventory,
      trend,
      details,
    });
  } catch (error: any) {
    console.error("Traffic quality detail error:", error);
    return NextResponse.json({ error: error.message || "Failed to load traffic quality detail" }, { status: 500 });
  }
}
