import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin, requireAdminPermission } from "@/lib/adminAuth";
import { calculateTrafficQuality } from "@/lib/trafficQuality";
import { refreshTrafficQualitySnapshots } from "@/lib/trafficQualityRefresh";

const SURFACES = new Set(["all", "channel", "miniapp", "bot"]);

function normalizeSurface(value: string | null) {
  const surface = String(value || "all").toLowerCase();
  return SURFACES.has(surface) ? surface : "all";
}

async function calculateSurfaceSummary(surface: string) {
  if (surface === "all") return calculateTrafficQuality("platform", 0);
  const [rows]: any = await pool.query(`
    SELECT
      COALESCE(SUM(impressions), 0) as impressions,
      COALESCE(SUM(unique_users), 0) as unique_users,
      AVG(quality_score) as avg_score,
      MAX(top_user_impression_ratio) as top_user_impression_ratio
    FROM traffic_quality_daily_scores
    WHERE entity_type = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  `, [surface]);
  const impressions = Number(rows[0]?.impressions || 0);
  const uniqueUsers = Number(rows[0]?.unique_users || 0);
  const score = rows[0]?.avg_score === null ? 60 : Math.round(Math.max(0, Math.min(100, Number(rows[0]?.avg_score || 60))));
  const qualityTier = score >= 90 ? "excellent" : score >= 75 ? "very_good" : score >= 60 ? "good" : score >= 40 ? "average" : score >= 20 ? "poor" : "critical";
  const riskLevel = score <= 19 ? "critical" : score <= 39 ? "high" : score <= 59 ? "medium" : "low";
  return {
    entity_type: surface,
    entity_id: 0,
    quality_score: score,
    quality_tier: qualityTier,
    risk_level: riskLevel,
    impressions,
    unique_users: uniqueUsers,
    repeat_user_ratio: impressions > 0 ? 1 - (uniqueUsers / impressions) : 0,
    repeat_impression_ratio: Number(rows[0]?.top_user_impression_ratio || 0),
    top_user_impression_ratio: Number(rows[0]?.top_user_impression_ratio || 0),
    velocity_score: 85,
    country_breakdown: {},
    device_breakdown: {},
    language_breakdown: {},
    session_breakdown: {},
    signal_metadata: { source: `${surface}_daily_entity_snapshots` },
  };
}

export async function GET(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const qualityFilter = searchParams.get("quality") || "all";
  const riskFilter = searchParams.get("risk") || "all";
  const surface = normalizeSurface(searchParams.get("surface"));

  try {
    const refreshed = await refreshTrafficQualitySnapshots(100);
    const platform = await calculateSurfaceSummary(surface);

    const entityTypes = surface === "all" ? ["miniapp", "channel", "bot"] : [surface];
    const whereParts = ["t.date = CURDATE()", "t.entity_type IN (?)"];
    const params: any[] = [];
    params.push(entityTypes);
    if (qualityFilter !== "all") {
      whereParts.push("t.quality_tier = ?");
      params.push(qualityFilter);
    }
    if (riskFilter !== "all") {
      whereParts.push("t.risk_level = ?");
      params.push(riskFilter);
    }

    const [entities]: any = await pool.query(`
      SELECT
        t.*,
        CASE
          WHEN t.entity_type = 'miniapp' THEN (SELECT miniapp_name FROM miniapps WHERE id = t.entity_id)
          WHEN t.entity_type = 'channel' THEN (SELECT title FROM channels WHERE id = t.entity_id)
          WHEN t.entity_type = 'bot' THEN (SELECT bot_name FROM bots WHERE id = t.entity_id)
          ELSE 'Platform'
        END as entity_name
      FROM traffic_quality_daily_scores t
      WHERE ${whereParts.join(" AND ")}
      ORDER BY t.quality_score ASC, t.impressions DESC
      LIMIT 200
    `, params);

    const [riskRows]: any = await pool.query(`
      SELECT risk_level, COUNT(*) as count
      FROM traffic_quality_daily_scores
      WHERE date = CURDATE() AND entity_type IN (?)
      GROUP BY risk_level
    `, [entityTypes]);

    const [trendRows]: any = await pool.query(`
      SELECT date, AVG(quality_score) as quality_score, SUM(impressions) as impressions
      FROM traffic_quality_daily_scores
      WHERE entity_type IN (?)
        AND date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      GROUP BY date
      ORDER BY date ASC
    `, [entityTypes]);

    const [countryRows]: any = surface === "all" || surface === "miniapp"
      ? await pool.query(`
        SELECT country, SUM(impressions) as impressions
        FROM miniapp_country_stats
        WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY country
        ORDER BY impressions DESC
        LIMIT 10
      `)
      : [[]];

    const [settingsRows]: any = await pool.query(`
      SELECT \`key\`, value
      FROM settings
      WHERE \`key\` IN ('traffic_quality_sensitivity', 'traffic_quality_review_threshold')
    `);

    const [queueRows]: any = await pool.query(`
      SELECT q.*
      FROM traffic_review_queue q
      WHERE q.status IN ('open', 'monitor')
      ORDER BY FIELD(q.risk_level, 'critical', 'high', 'medium', 'low'), q.created_at DESC
      LIMIT 100
    `);

    return NextResponse.json({
      platform,
      entities,
      risk_breakdown: riskRows,
      trends: trendRows,
      countries: countryRows,
      device_breakdown: [],
      language_breakdown: [],
      vpn_proxy_available: false,
      unavailable_signals: ["device_distribution", "language_distribution", "vpn_proxy_ratio"],
      review_queue: queueRows,
      settings: Object.fromEntries(settingsRows.map((row: any) => [row.key, row.value])),
      refreshed,
      surface,
    });
  } catch (error: any) {
    console.error("Traffic quality dashboard error:", error);
    return NextResponse.json({ error: error.message || "Failed to load traffic quality dashboard" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  try {
    const body = await request.json();
    const id = Number(body.id);
    const action = String(body.action || "");
    const allowed = new Set(["approve", "ignore", "monitor", "pause"]);
    if (!Number.isInteger(id) || id <= 0 || !allowed.has(action)) {
      return NextResponse.json({ error: "Invalid review queue action" }, { status: 400 });
    }

    const [rows]: any = await pool.query("SELECT * FROM traffic_review_queue WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Review item not found" }, { status: 404 });
    }

    const item = rows[0];
    const status = action === "approve" ? "approved" : action;
    await pool.query(
      "UPDATE traffic_review_queue SET status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?",
      [status, admin.id, id]
    );

    if (action === "pause") {
      if (item.entity_type === "miniapp") {
        await pool.query("UPDATE miniapps SET status = 'paused' WHERE id = ?", [item.entity_id]);
      } else if (item.entity_type === "channel") {
        await pool.query("UPDATE channels SET status = 'paused' WHERE id = ?", [item.entity_id]);
      } else if (item.entity_type === "bot") {
        await pool.query("UPDATE bots SET status = 'paused' WHERE id = ?", [item.entity_id]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update review item" }, { status: 500 });
  }
}
