import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { MINIAPP_NETWORKS, type MiniAppNetworkName } from "@/lib/miniappNetworkAdapters";
import { getDisabledMiniappNetworks } from "@/lib/productionSafety";

export type MiniAppOptimizationSettings = {
  internal_ads_max_share_percent: number;
  internal_campaign_user_cooldown_minutes: number;
  internal_campaign_miniapp_max_share_percent: number;
  network_failure_disable_threshold: number;
  network_failure_window_minutes: number;
  network_disable_duration_minutes: number;
};

type SettingRow = RowDataPacket & {
  key: string;
  value: string;
};

type ScoreRow = RowDataPacket & {
  network_name: MiniAppNetworkName;
  requests: number;
  impressions: number;
  failures: number;
  no_fills: number;
  timeouts: number;
  sdk_load_failures: number;
  revenue: number;
  clicks: number;
  completed: number;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  temporarily_disabled_until: Date | string | null;
};

type NetworkHealthScoreOptions = {
  enriched?: boolean;
};

type NetworkHealthAggregate = {
  network_name: MiniAppNetworkName;
  requests: number;
  impressions: number;
  failures: number;
  no_fills: number;
  timeouts: number;
  sdk_load_failures: number;
  revenue: number;
  clicks: number;
  completed: number;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  temporarily_disabled_until: Date | string | null;
};

const DEFAULTS: MiniAppOptimizationSettings = {
  internal_ads_max_share_percent: 20,
  internal_campaign_user_cooldown_minutes: 30,
  internal_campaign_miniapp_max_share_percent: 30,
  network_failure_disable_threshold: 5,
  network_failure_window_minutes: 10,
  network_disable_duration_minutes: 15,
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isFuture(value: Date | string | null | undefined) {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function executor(conn?: PoolConnection) {
  return conn || pool;
}

export async function getMiniAppOptimizationSettings(conn?: PoolConnection): Promise<MiniAppOptimizationSettings> {
  const db = executor(conn);
  const [rows] = await db.query<SettingRow[]>(
    "SELECT `key`, value FROM settings WHERE `key` IN (?)",
    [Object.keys(DEFAULTS)]
  );
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    internal_ads_max_share_percent: clamp(toNumber(values.get("internal_ads_max_share_percent"), DEFAULTS.internal_ads_max_share_percent), 0, 100),
    internal_campaign_user_cooldown_minutes: Math.max(1, toNumber(values.get("internal_campaign_user_cooldown_minutes"), DEFAULTS.internal_campaign_user_cooldown_minutes)),
    internal_campaign_miniapp_max_share_percent: clamp(toNumber(values.get("internal_campaign_miniapp_max_share_percent"), DEFAULTS.internal_campaign_miniapp_max_share_percent), 0, 100),
    network_failure_disable_threshold: Math.max(1, Math.floor(toNumber(values.get("network_failure_disable_threshold"), DEFAULTS.network_failure_disable_threshold))),
    network_failure_window_minutes: Math.max(1, Math.floor(toNumber(values.get("network_failure_window_minutes"), DEFAULTS.network_failure_window_minutes))),
    network_disable_duration_minutes: Math.max(1, Math.floor(toNumber(values.get("network_disable_duration_minutes"), DEFAULTS.network_disable_duration_minutes))),
  };
}

export function calculateHealthScore(input: {
  requests: number;
  impressions: number;
  failures: number;
  noFills: number;
  timeouts: number;
  sdkLoadFailures: number;
  temporarilyDisabled: boolean;
}) {
  const requests = Math.max(1, input.requests);
  const successRate = input.impressions / requests;
  const failureRate = input.failures / requests;
  const noFillRate = input.noFills / requests;
  const timeoutPenalty = input.timeouts * 4;
  const sdkPenalty = input.sdkLoadFailures * 6;
  const disablePenalty = input.temporarilyDisabled ? 35 : 0;

  return Math.round(clamp(
    65 + successRate * 35 - failureRate * 35 - noFillRate * 20 - timeoutPenalty - sdkPenalty - disablePenalty,
    0,
    100
  ));
}

export async function getMiniAppNetworkHealthScores(miniappId: number | string, conn?: PoolConnection, options: NetworkHealthScoreOptions = {}) {
  const db = executor(conn);
  const globallyDisabledNetworks = await getDisabledMiniappNetworks(db);
  const [rows] = await db.query<ScoreRow[]>(`
    SELECT
      network_name,
      COUNT(*) as requests,
      SUM(CASE WHEN impression_confirmed = 1 THEN 1 ELSE 0 END) as impressions,
      SUM(CASE WHEN final_result = 'failed' THEN 1 ELSE 0 END) as failures,
      SUM(CASE WHEN final_result = 'no_fill' THEN 1 ELSE 0 END) as no_fills,
      0 as timeouts,
      0 as sdk_load_failures,
      0 as revenue,
      0 as clicks,
      SUM(CASE WHEN final_result IN ('completed', 'impression_confirmed', 'displayed') THEN 1 ELSE 0 END) as completed,
      MAX(CASE WHEN impression_confirmed = 1 THEN impression_confirmed_at ELSE NULL END) as last_success_at,
      NULL as last_failure_at,
      NULL as temporarily_disabled_until
    FROM miniapp_mediation_requests
    WHERE miniapp_id = ?
      AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND selected_network <> ''
    GROUP BY network_name
  `, [miniappId]);

  const [failureRows] = await db.query<RowDataPacket[]>(`
    SELECT
      network_name,
      COUNT(*) as failures,
      SUM(CASE WHEN error_code = 'TIMEOUT' THEN 1 ELSE 0 END) as timeouts,
      SUM(CASE WHEN error_code = 'SDK_LOAD_FAILED' THEN 1 ELSE 0 END) as sdk_load_failures,
      MAX(created_at) as last_failure_at
    FROM miniapp_network_failures
    WHERE miniapp_id = ?
      AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY network_name
  `, [miniappId]);

  const [healthRows] = await db.query<RowDataPacket[]>(
    "SELECT network_name, temporarily_disabled_until FROM miniapp_network_health WHERE miniapp_id = ?",
    [miniappId]
  );
  const [revenueRows, clickRows] = options.enriched
    ? await Promise.all([
      db.query<RowDataPacket[]>(`
        SELECT network_name, COALESCE(SUM(gross_revenue), 0) as revenue
        FROM miniapp_daily_stats
        WHERE miniapp_id = ?
          AND date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        GROUP BY network_name
      `, [miniappId]).then(([queryRows]) => queryRows),
      db.query<RowDataPacket[]>(`
        SELECT mr.selected_network as network_name, COUNT(ac.id) as clicks
        FROM ad_click_attribution ac
        JOIN miniapp_mediation_requests mr ON mr.request_id = ac.request_id
        WHERE mr.miniapp_id = ?
          AND ac.campaign_type = 'miniapp'
          AND ac.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY mr.selected_network
      `, [miniappId]).then(([queryRows]) => queryRows),
    ])
    : [[], []] as RowDataPacket[][];

  const byNetwork = new Map<string, NetworkHealthAggregate>();
  for (const network of MINIAPP_NETWORKS) {
    if (globallyDisabledNetworks.has(network)) continue;
    byNetwork.set(network, {
      network_name: network,
      requests: 0,
      impressions: 0,
      failures: 0,
      no_fills: 0,
      timeouts: 0,
      sdk_load_failures: 0,
      revenue: 0,
      clicks: 0,
      completed: 0,
      last_success_at: null,
      last_failure_at: null,
      temporarily_disabled_until: null,
    });
  }

  const mergeNetwork = (networkName: unknown, patch: Partial<NetworkHealthAggregate>) => {
    const key = String(networkName || "") as MiniAppNetworkName;
    const existing = byNetwork.get(key);
    if (!existing) return;
    byNetwork.set(key, { ...existing, ...patch, network_name: key });
  };

  for (const row of rows) {
    mergeNetwork(row.network_name, row);
  }
  for (const row of failureRows) {
    mergeNetwork(row.network_name, {
      failures: row.failures,
      timeouts: row.timeouts,
      sdk_load_failures: row.sdk_load_failures,
      last_failure_at: row.last_failure_at,
    });
  }
  for (const row of healthRows) {
    mergeNetwork(row.network_name, { temporarily_disabled_until: row.temporarily_disabled_until });
  }
  for (const row of revenueRows) {
    mergeNetwork(row.network_name, { revenue: row.revenue });
  }
  for (const row of clickRows) {
    mergeNetwork(row.network_name, { clicks: row.clicks });
  }

  return Array.from(byNetwork.values()).map((row) => {
    const score = calculateHealthScore({
      requests: toNumber(row.requests),
      impressions: toNumber(row.impressions),
      failures: toNumber(row.failures),
      noFills: toNumber(row.no_fills),
      timeouts: toNumber(row.timeouts),
      sdkLoadFailures: toNumber(row.sdk_load_failures),
      temporarilyDisabled: isFuture(row.temporarily_disabled_until),
    });

    const requests = toNumber(row.requests);
    const impressions = toNumber(row.impressions);
    const revenue = toNumber(row.revenue);
    const completed = toNumber(row.completed);
    return {
      network_name: row.network_name as MiniAppNetworkName,
      health_score: score,
      requests,
      filled: impressions,
      impressions,
      failures: toNumber(row.failures),
      no_fills: toNumber(row.no_fills),
      fill_rate: requests > 0 ? (impressions / requests) * 100 : 0,
      timeouts: toNumber(row.timeouts),
      sdk_load_failures: toNumber(row.sdk_load_failures),
      clicks: toNumber(row.clicks),
      revenue,
      average_cpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
      completion_rate: impressions > 0 ? (completed / impressions) * 100 : 0,
      last_success_at: row.last_success_at || null,
      last_failure_at: row.last_failure_at || null,
      temporarily_disabled_until: row.temporarily_disabled_until || null,
    };
  });
}

export async function recordNetworkSuccess(conn: PoolConnection, miniappId: number, networkName: string) {
  await conn.query(
    `INSERT INTO miniapp_network_health
      (miniapp_id, network_name, health_score, recent_failures, last_success_at)
     VALUES (?, ?, 100, 0, NOW())
     ON DUPLICATE KEY UPDATE
      last_success_at = NOW(),
      health_score = LEAST(100, health_score + 5),
      recent_failures = GREATEST(recent_failures - 1, 0)`,
    [miniappId, networkName]
  );
}

export async function recordOptimizationFlag(input: {
  conn: PoolConnection;
  miniappId: number;
  telegramUserId?: string | number | null;
  flagType: string;
  severity?: string;
  details?: Record<string, unknown>;
}) {
  await input.conn.query(
    `INSERT INTO miniapp_optimization_flags
      (miniapp_id, telegram_user_id, flag_type, severity, details)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.miniappId,
      input.telegramUserId || null,
      input.flagType,
      input.severity || "review",
      JSON.stringify(input.details || {}),
    ]
  );
}

export async function detectMiniAppRequestFlags(input: {
  conn: PoolConnection;
  miniappId: number;
  telegramUserId: string;
}) {
  const [[userRequests]] = await input.conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM miniapp_mediation_requests
     WHERE telegram_user_id = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
    [input.telegramUserId]
  );
  const [[pairRequests]] = await input.conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) as requests,
       SUM(CASE WHEN impression_confirmed = 1 THEN 1 ELSE 0 END) as impressions,
       SUM(CASE WHEN final_result = 'no_fill' THEN 1 ELSE 0 END) as no_fills
     FROM miniapp_mediation_requests
     WHERE miniapp_id = ?
       AND telegram_user_id = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
    [input.miniappId, input.telegramUserId]
  );

  const requestCount = toNumber(userRequests?.count);
  const pairRequestCount = toNumber(pairRequests?.requests);
  const pairImpressions = toNumber(pairRequests?.impressions);
  const noFills = toNumber(pairRequests?.no_fills);

  if (requestCount >= 60) {
    await recordOptimizationFlag({
      conn: input.conn,
      miniappId: input.miniappId,
      telegramUserId: input.telegramUserId,
      flagType: "high_user_request_rate",
      details: { request_count_10m: requestCount },
    });
  }

  if (pairRequestCount >= 20 && pairImpressions / Math.max(1, pairRequestCount) < 0.1) {
    await recordOptimizationFlag({
      conn: input.conn,
      miniappId: input.miniappId,
      telegramUserId: input.telegramUserId,
      flagType: "high_request_to_impression_ratio",
      details: { requests_30m: pairRequestCount, impressions_30m: pairImpressions },
    });
  }

  if (noFills >= 10) {
    await recordOptimizationFlag({
      conn: input.conn,
      miniappId: input.miniappId,
      telegramUserId: input.telegramUserId,
      flagType: "repeated_no_fill",
      details: { no_fills_30m: noFills },
    });
  }
}
