/* eslint-disable @typescript-eslint/no-explicit-any -- legacy Mini App aggregate payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { getMiniAppGlobalRevenueSummary } from "@/lib/miniappRevenueEngine";
import { calculateHealthScore } from "@/lib/miniappOptimization";
import { getMiniAppAggregateStatsByIds } from "@/lib/miniappReports";
import { getMiniAppRevenueOptimizerReport } from "@/lib/miniappRevenueOptimizer";
import { MINIAPP_NETWORKS } from "@/lib/miniappNetworkAdapters";
import { getDisabledMiniappNetworks } from "@/lib/productionSafety";

type MiniAppNetworkHealth = {
  network_name: string;
  health_score: number;
  requests: number;
  filled: number;
  impressions: number;
  failures: number;
  no_fills: number;
  fill_rate: number;
  timeouts: number;
  sdk_load_failures: number;
  clicks: number;
  revenue: number;
  average_cpm: number;
  completion_rate: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  temporarily_disabled_until: string | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFuture(value: unknown) {
  if (!value) return false;
  return new Date(String(value)).getTime() > Date.now();
}

async function getBatchedMiniAppAdminDiagnostics(miniappIds: number[]) {
  if (miniappIds.length === 0) {
    return {
      healthByMiniApp: new Map<number, MiniAppNetworkHealth[]>(),
      flagsByMiniApp: new Map<number, number>(),
      locksByMiniApp: new Map<number, number>(),
    };
  }

  const disabledNetworks = await getDisabledMiniappNetworks();
  const [
    requestResult,
    failureResult,
    healthResult,
    revenueResult,
    clickResult,
    flagResult,
    lockResult,
  ] = await Promise.all([
    pool.query(
      `SELECT miniapp_id, selected_network as network_name,
         COUNT(*) as requests,
         SUM(CASE WHEN impression_confirmed = 1 THEN 1 ELSE 0 END) as impressions,
         SUM(CASE WHEN final_result = 'failed' THEN 1 ELSE 0 END) as failures,
         SUM(CASE WHEN final_result = 'no_fill' THEN 1 ELSE 0 END) as no_fills,
         SUM(CASE WHEN final_result IN ('completed', 'impression_confirmed', 'displayed') THEN 1 ELSE 0 END) as completed,
         MAX(CASE WHEN impression_confirmed = 1 THEN impression_confirmed_at ELSE NULL END) as last_success_at
       FROM miniapp_mediation_requests
       WHERE miniapp_id IN (?) AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND selected_network <> ''
       GROUP BY miniapp_id, selected_network`,
      [miniappIds]
    ).catch(() => [[]]),
    pool.query(
      `SELECT miniapp_id, network_name,
         COUNT(*) as failures,
         SUM(CASE WHEN error_code = 'TIMEOUT' THEN 1 ELSE 0 END) as timeouts,
         SUM(CASE WHEN error_code = 'SDK_LOAD_FAILED' THEN 1 ELSE 0 END) as sdk_load_failures,
         MAX(created_at) as last_failure_at
       FROM miniapp_network_failures
       WHERE miniapp_id IN (?) AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY miniapp_id, network_name`,
      [miniappIds]
    ).catch(() => [[]]),
    pool.query(
      "SELECT miniapp_id, network_name, temporarily_disabled_until FROM miniapp_network_health WHERE miniapp_id IN (?)",
      [miniappIds]
    ).catch(() => [[]]),
    pool.query(
      `SELECT miniapp_id, network_name, COALESCE(SUM(gross_revenue), 0) as revenue
       FROM miniapp_daily_stats
       WHERE miniapp_id IN (?) AND date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
       GROUP BY miniapp_id, network_name`,
      [miniappIds]
    ).catch(() => [[]]),
    pool.query(
      `SELECT mr.miniapp_id, mr.selected_network as network_name, COUNT(ac.id) as clicks
       FROM ad_click_attribution ac
       JOIN miniapp_mediation_requests mr ON mr.request_id = ac.request_id
       WHERE mr.miniapp_id IN (?) AND ac.campaign_type = 'miniapp' AND ac.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY mr.miniapp_id, mr.selected_network`,
      [miniappIds]
    ).catch(() => [[]]),
    pool.query(
      `SELECT miniapp_id, COUNT(*) as suspicious_flags
       FROM miniapp_optimization_flags
       WHERE miniapp_id IN (?) AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY miniapp_id`,
      [miniappIds]
    ).catch(() => [[]]),
    pool.query(
      `SELECT miniapp_id, COUNT(*) as monetag_lock_count
       FROM miniapp_network_frequency_state
       WHERE miniapp_id IN (?) AND network_name = 'Monetag' AND locked_until IS NOT NULL
       GROUP BY miniapp_id`,
      [miniappIds]
    ).catch(() => [[]]),
  ]);

  const healthByKey = new Map<string, Record<string, unknown>>();
  const merge = (row: Record<string, unknown>, patch: Record<string, unknown>) => {
    const key = `${row.miniapp_id}:${row.network_name}`;
    healthByKey.set(key, { ...(healthByKey.get(key) || row), ...patch, miniapp_id: row.miniapp_id, network_name: row.network_name });
  };

  for (const miniappId of miniappIds) {
    for (const networkName of MINIAPP_NETWORKS) {
      if (disabledNetworks.has(networkName)) continue;
      merge({ miniapp_id: miniappId, network_name: networkName }, {});
    }
  }
  for (const row of requestResult[0] as any[]) merge(row, row);
  for (const row of failureResult[0] as any[]) merge(row, row);
  for (const row of healthResult[0] as any[]) merge(row, row);
  for (const row of revenueResult[0] as any[]) merge(row, row);
  for (const row of clickResult[0] as any[]) merge(row, row);

  const healthByMiniApp = new Map<number, MiniAppNetworkHealth[]>();
  for (const row of healthByKey.values()) {
    const miniappId = numberValue(row.miniapp_id);
    const requests = numberValue(row.requests);
    const impressions = numberValue(row.impressions);
    const failures = numberValue(row.failures);
    const noFills = numberValue(row.no_fills);
    const timeouts = numberValue(row.timeouts);
    const sdkLoadFailures = numberValue(row.sdk_load_failures);
    const revenue = numberValue(row.revenue);
    const completed = numberValue(row.completed);
    const score = calculateHealthScore({
      requests,
      impressions,
      failures,
      noFills,
      timeouts,
      sdkLoadFailures,
      temporarilyDisabled: isFuture(row.temporarily_disabled_until),
    });
    const current = healthByMiniApp.get(miniappId) || [];
    current.push({
      network_name: String(row.network_name || ""),
      health_score: score,
      requests,
      filled: impressions,
      impressions,
      failures,
      no_fills: noFills,
      fill_rate: requests > 0 ? (impressions / requests) * 100 : 0,
      timeouts,
      sdk_load_failures: sdkLoadFailures,
      clicks: numberValue(row.clicks),
      revenue,
      average_cpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
      completion_rate: impressions > 0 ? (completed / impressions) * 100 : 0,
      last_success_at: row.last_success_at ? String(row.last_success_at) : null,
      last_failure_at: row.last_failure_at ? String(row.last_failure_at) : null,
      temporarily_disabled_until: row.temporarily_disabled_until ? String(row.temporarily_disabled_until) : null,
    });
    healthByMiniApp.set(miniappId, current);
  }

  return {
    healthByMiniApp,
    flagsByMiniApp: new Map((flagResult[0] as any[]).map((row) => [Number(row.miniapp_id), Number(row.suspicious_flags || 0)])),
    locksByMiniApp: new Map((lockResult[0] as any[]).map((row) => [Number(row.miniapp_id), Number(row.monetag_lock_count || 0)])),
  };
}

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
        m.telegram_bot_id,
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
        COALESCE((SELECT GROUP_CONCAT(mn.network_name ORDER BY FIELD(mn.network_name, 'AdsGalaxyInternal', 'AdsGram', 'GigaPub', 'AdExium', 'Monetag', 'RichAds') SEPARATOR ', ') FROM miniapp_ad_networks mn WHERE mn.miniapp_id = m.id AND mn.enabled = TRUE), '') as enabled_network_names,
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
    const statsById = await getMiniAppAggregateStatsByIds(rows.map((row: any) => row.id));

    const diagnostics = await getBatchedMiniAppAdminDiagnostics(rows.map((row: any) => Number(row.id)));

    const miniapps = rows.map((row: any) => {
      const stats = statsById.get(Number(row.id));
      const requestCount = Number(stats?.total_requests ?? row.mediation_request_count ?? 0);
      const impressions = Number(stats?.total_impressions ?? row.total_impressions ?? 0);
      return {
        ...row,
        ...stats,
        network_health: diagnostics.healthByMiniApp.get(Number(row.id)) || [],
        fill_rate: stats?.fill_rate ?? (requestCount > 0 ? impressions / requestCount * 100 : 0),
        request_to_impression_ratio: impressions > 0 ? requestCount / impressions : requestCount,
        suspicious_flag_count: diagnostics.flagsByMiniApp.get(Number(row.id)) || 0,
        monetag_lock_count: diagnostics.locksByMiniApp.get(Number(row.id)) || 0,
      };
    });

    const [revenueSummary, optimizerReport] = await Promise.all([
      getMiniAppGlobalRevenueSummary().catch(() => null),
      getMiniAppRevenueOptimizerReport(10).catch(() => null),
    ]);

    return NextResponse.json({
      miniapps,
      revenue_summary: revenueSummary,
      optimizer_report: optimizerReport,
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
