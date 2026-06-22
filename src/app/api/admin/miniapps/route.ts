import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { getMiniAppGlobalRevenueSummary } from "@/lib/miniappRevenueEngine";
import { getMiniAppNetworkHealthScores } from "@/lib/miniappOptimization";

export async function GET(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const statusFilter = searchParams.get("status") || "all";
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
        m.status,
        m.created_at,
        m.updated_at,
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

    if (statusFilter !== "all") {
      whereClause += " AND m.status = ?";
      queryParams.push(statusFilter);
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
      const [health, [flagRows], [lockRows]] = await Promise.all([
        getMiniAppNetworkHealthScores(row.id),
        pool.query(
          "SELECT COUNT(*) as suspicious_flags FROM miniapp_optimization_flags WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)",
          [row.id]
        ) as any,
        pool.query(
          "SELECT COUNT(*) as monetag_lock_count FROM miniapp_network_frequency_state WHERE miniapp_id = ? AND network_name = 'Monetag' AND locked_until IS NOT NULL",
          [row.id]
        ) as any,
      ]);
      const requestCount = Number(row.mediation_request_count || 0);
      const noFillCount = Number(row.no_fill_count || 0);
      const impressions = health.reduce((sum, item) => sum + Number(item.impressions || 0), 0);
      return {
        ...row,
        network_health: health,
        fill_rate: requestCount > 0 ? impressions / requestCount * 100 : 0,
        request_to_impression_ratio: impressions > 0 ? requestCount / impressions : requestCount,
        suspicious_flag_count: Number((flagRows as any)[0]?.suspicious_flags || 0),
        monetag_lock_count: Number((lockRows as any)[0]?.monetag_lock_count || 0),
      };
    }));

    const revenueSummary = await getMiniAppGlobalRevenueSummary();

    return NextResponse.json({
      miniapps,
      revenue_summary: revenueSummary,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: unknown) {
    console.error("Admin Mini Apps GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
