/* eslint-disable @typescript-eslint/no-explicit-any -- legacy Mini App aggregate payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { getMiniAppGlobalRevenueSummary } from "@/lib/miniappRevenueEngine";
import { getMiniAppNetworkHealthScores } from "@/lib/miniappOptimization";

export async function GET(request: Request) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10") || 10));
  const statusFilter = searchParams.get("status") || "all";
  const networkCountFilter = searchParams.get("network_count") || "all";
  const qualityFilter = searchParams.get("quality") || "all";
  const riskFilter = searchParams.get("risk") || "all";
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT
        m.id,
        m.user_id,
        m.miniapp_name,
        m.miniapp_username,
        m.bot_id,
        m.webapp_url,
        m.miniapp_url,
        m.admin_approved_at,
        CASE WHEN m.status = 'monetized' THEN 'approved' ELSE m.status END as status,
        COALESCE(m.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(m.traffic_quality_tier, 'good') as traffic_quality_tier,
        COALESCE(m.traffic_risk_level, 'low') as traffic_risk_level,
        m.traffic_quality_updated_at,
        m.created_at,
        m.updated_at,
        COALESCE((SELECT COUNT(*) FROM miniapp_ad_networks mn WHERE mn.miniapp_id = m.id AND mn.enabled = TRUE AND mn.network_name IN ('AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub')), 0) as configured_network_count,
        COALESCE((SELECT COUNT(*) FROM miniapp_ad_networks mn WHERE mn.miniapp_id = m.id AND mn.enabled = TRUE), 0) as enabled_network_count,
        COALESCE((SELECT GROUP_CONCAT(mn.network_name ORDER BY FIELD(mn.network_name, 'AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub', 'AdsGalaxyInternal') SEPARATOR ', ') FROM miniapp_ad_networks mn WHERE mn.miniapp_id = m.id AND mn.enabled = TRUE), '') as enabled_network_names,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id), 0) as total_impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = m.id), 0) as mediation_request_count,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = m.id AND mr.final_result = 'no_fill'), 0) as no_fill_count,
        (SELECT MAX(mr.created_at) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = m.id) as last_mediation_request_at,
        (SELECT mr.selected_network FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = m.id ORDER BY mr.created_at DESC LIMIT 1) as recent_selected_network,
        COALESCE((SELECT SUM(mh.recent_failures) FROM miniapp_network_health mh WHERE mh.miniapp_id = m.id), 0) as recent_network_failures,
        COALESCE((SELECT GROUP_CONCAT(CONCAT(mh.network_name, ' until ', DATE_FORMAT(mh.temporarily_disabled_until, '%Y-%m-%d %H:%i')) ORDER BY mh.network_name SEPARATOR ', ') FROM miniapp_network_health mh WHERE mh.miniapp_id = m.id AND mh.temporarily_disabled_until IS NOT NULL AND mh.temporarily_disabled_until > NOW()), '') as temporarily_disabled_networks,
        COALESCE((SELECT
          CASE
            WHEN fs.locked_until IS NOT NULL AND fs.locked_until > NOW() THEN 'Locked'
            WHEN fs.next_allowed_opportunity > fs.opportunity_count THEN 'Delayed'
            ELSE 'Active'
          END
         FROM miniapp_network_frequency_state fs
         WHERE fs.miniapp_id = m.id AND fs.network_name = 'Monetag'), 'Active') as monetag_status,
        COALESCE((SELECT fs.opportunity_count FROM miniapp_network_frequency_state fs WHERE fs.miniapp_id = m.id AND fs.network_name = 'Monetag'), 0) as monetag_opportunity_count,
        COALESCE((SELECT fs.next_allowed_opportunity FROM miniapp_network_frequency_state fs WHERE fs.miniapp_id = m.id AND fs.network_name = 'Monetag'), 15) as monetag_next_allowed_opportunity,
        (SELECT fs.locked_until FROM miniapp_network_frequency_state fs WHERE fs.miniapp_id = m.id AND fs.network_name = 'Monetag') as monetag_locked_until,
        (SELECT
          CASE
            WHEN fs.last_telegram_user_id IS NULL THEN NULL
            ELSE CONCAT(LEFT(CAST(fs.last_telegram_user_id AS CHAR), 2), '***', RIGHT(CAST(fs.last_telegram_user_id AS CHAR), 2))
          END
         FROM miniapp_network_frequency_state fs
         WHERE fs.miniapp_id = m.id AND fs.network_name = 'Monetag') as monetag_last_user_masked,
        u.first_name,
        u.last_name,
        u.username AS owner_username,
        u.telegram_id AS owner_telegram_id
      FROM miniapps m
      LEFT JOIN users u ON m.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM miniapps m LEFT JOIN users u ON m.user_id = u.id";
    const queryParams: Array<string | number> = [];
    let whereClause = " WHERE m.is_deleted = FALSE";

    if (statusFilter === "approved") {
      whereClause += " AND m.status IN ('approved', 'monetized')";
    } else if (statusFilter !== "all") {
      whereClause += " AND m.status = ?";
      queryParams.push(statusFilter);
    }

    if (networkCountFilter !== "all") {
      const configuredNetworkCount = Number(networkCountFilter);
      if (Number.isInteger(configuredNetworkCount) && configuredNetworkCount >= 0 && configuredNetworkCount <= 4) {
        whereClause += " AND COALESCE((SELECT COUNT(*) FROM miniapp_ad_networks mn WHERE mn.miniapp_id = m.id AND mn.enabled = TRUE AND mn.network_name IN ('AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub')), 0) = ?";
        queryParams.push(configuredNetworkCount);
      }
    }

    if (qualityFilter !== "all") {
      whereClause += " AND COALESCE(m.traffic_quality_tier, 'good') = ?";
      queryParams.push(qualityFilter);
    }

    if (riskFilter !== "all") {
      whereClause += " AND COALESCE(m.traffic_risk_level, 'low') = ?";
      queryParams.push(riskFilter);
    }

    if (search) {
      whereClause += ` AND (
        m.miniapp_name LIKE ? OR
        m.miniapp_username LIKE ? OR
        m.bot_id LIKE ? OR
        u.first_name LIKE ? OR
        u.last_name LIKE ? OR
        u.username LIKE ? OR
        u.telegram_id LIKE ?
      )`;
      const searchVal = `%${search}%`;
      queryParams.push(searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += whereClause + " ORDER BY m.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;

    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);

    const miniapps = await Promise.all(rows.map(async (row: any) => {
      const [health, flagResult, lockResult] = await Promise.all([
        getMiniAppNetworkHealthScores(row.id).catch(() => []),
        (pool.query(
          "SELECT COUNT(*) as suspicious_flags FROM miniapp_optimization_flags WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)",
          [row.id]
        ) as any).catch(() => [[{ suspicious_flags: 0 }]]),
        (pool.query(
          "SELECT COUNT(*) as monetag_lock_count FROM miniapp_network_frequency_state WHERE miniapp_id = ? AND network_name = 'Monetag' AND locked_until IS NOT NULL",
          [row.id]
        ) as any).catch(() => [[{ monetag_lock_count: 0 }]]),
      ]);
      const [flagRows] = flagResult;
      const [lockRows] = lockResult;
      const requestCount = Number(row.mediation_request_count || 0);
      const impressions = (health as any[]).reduce((sum, item) => sum + Number(item.impressions || 0), 0);
      return {
        ...row,
        network_health: health,
        fill_rate: requestCount > 0 ? impressions / requestCount * 100 : 0,
        request_to_impression_ratio: impressions > 0 ? requestCount / impressions : requestCount,
        suspicious_flag_count: Number((flagRows as any)[0]?.suspicious_flags || 0),
        monetag_lock_count: Number((lockRows as any)[0]?.monetag_lock_count || 0),
      };
    }));

    const revenueSummary = await getMiniAppGlobalRevenueSummary().catch(() => null);

    return NextResponse.json({
      miniapps,
      revenue_summary: revenueSummary,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
      networkCountFilter,
    });
  } catch (error: unknown) {
    console.error("Admin Mini Apps GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
