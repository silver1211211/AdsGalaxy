/* eslint-disable @typescript-eslint/no-explicit-any -- optimizer aggregates legacy SQL payloads */
import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { MINIAPP_NETWORKS, type MiniAppNetworkName } from "@/lib/miniappNetworkAdapters";
import { getMiniAppNetworkHealthScores } from "@/lib/miniappOptimization";
import { getMiniAppPublisherCpmSettings } from "@/lib/miniappPublisherCpmEngine";
import { getDisabledMiniappNetworks } from "@/lib/productionSafety";
import { cpm, ctr, metricNumber } from "@/lib/statFormulas";
import { getExternalNetworkReconciliationReport } from "@/lib/externalNetworkRevenueReconciliation";

const TIER_1_COUNTRIES = new Set(["US", "GB", "UK", "CA", "AU", "DE", "FR", "JP", "SG", "TW", "KR", "CH", "NL", "SE", "NO", "DK", "FI", "IE", "NZ", "AT", "BE"]);
const TIER_2_COUNTRIES = new Set(["ES", "IT", "PT", "PL", "CZ", "GR", "AE", "SA", "QA", "KW", "IL", "TR", "MY", "TH", "HK", "BR", "MX", "CL", "AR", "ZA"]);

type Db = typeof pool | PoolConnection;

type OptimizerSettings = {
  minCpm: number;
  recommendedCpm: number;
  maxCpm: number;
  manualOverride: boolean;
  enabled: boolean;
};

type MiniAppRow = RowDataPacket & {
  id: number;
  traffic_quality_score: string | number | null;
  inventory_score: string | number | null;
};

type NetworkMetric = {
  miniappId: number;
  networkName: MiniAppNetworkName;
  requests: number;
  impressions: number;
  grossRevenue: number;
  publisherRevenue: number;
  failures: number;
  noFills: number;
  timeouts: number;
  sdkLoadFailures: number;
  clicks: number;
  completed: number;
  healthScore: number;
  trafficQuality: number;
  inventoryQuality: number;
  previousPriority: number;
  effectiveNetworkCpm: number;
  effectivePublisherCpm: number;
  fillRate: number;
  ctr: number;
  completionRate: number;
  failureRate: number;
  timeoutRate: number;
  revenueQuality: number;
  score: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function settingBool(value: unknown, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "enabled";
}

function countryTier(country: unknown) {
  const key = String(country || "").trim().toUpperCase();
  if (TIER_1_COUNTRIES.has(key)) return 1;
  if (TIER_2_COUNTRIES.has(key)) return 2;
  return 3;
}

function tierPublisherRange(tier: number) {
  if (tier === 1) return { min: 1, max: 3 };
  if (tier === 2) return { min: 0.5, max: 2 };
  return { min: 0.5, max: 1 };
}

async function getSettings(db: Db): Promise<OptimizerSettings> {
  const [rows]: any = await db.query(
    `SELECT \`key\`, value
     FROM settings
     WHERE \`key\` IN (
       'global_min_cpm',
       'global_recommended_cpm',
       'global_max_cpm',
       'global_recommended_cpm_manual_override',
       'miniapp_revenue_optimizer_enabled'
     )`
  );
  const map = new Map(rows.map((row: any) => [String(row.key), String(row.value)]));
  const minCpm = Math.max(0, metricNumber(map.get("global_min_cpm") ?? 0.5));
  const maxCpm = Math.max(minCpm, metricNumber(map.get("global_max_cpm") ?? 5));
  return {
    minCpm,
    recommendedCpm: clamp(metricNumber(map.get("global_recommended_cpm") ?? 1), minCpm, maxCpm),
    maxCpm,
    manualOverride: settingBool(map.get("global_recommended_cpm_manual_override"), false),
    enabled: settingBool(map.get("miniapp_revenue_optimizer_enabled"), true),
  };
}

async function insertDefaultSettings(db: Db) {
  await db.query(
    `INSERT INTO settings (\`key\`, value, description) VALUES
      ('global_min_cpm', '0.50', 'Global minimum CPM used across Mini App, Channel, Bot, and all categories.'),
      ('global_recommended_cpm', '1.00', 'Global recommended CPM shown as the default bid unless manually overridden.'),
      ('global_max_cpm', '5.00', 'Global maximum CPM used across Mini App, Channel, Bot, and all categories.'),
      ('global_recommended_cpm_optimizer_value', '1.00', 'Latest CPM recommendation calculated by the hourly optimizer.'),
      ('global_recommended_cpm_manual_override', '0', 'When 1, hourly optimizer records recommendations but does not replace the active recommended CPM.'),
      ('miniapp_revenue_optimizer_enabled', '1', 'Enable hourly Mini App revenue optimizer.'),
      ('last_miniapp_revenue_optimizer_run', '0', 'Timestamp of last Mini App revenue optimizer cron run.')
     ON DUPLICATE KEY UPDATE value = value`
  );
}

async function countryWeightedPublisherTarget(db: Db, fallbackPublisherCpm: number) {
  const [rows]: any = await db.query(
    `SELECT country, COALESCE(SUM(impressions), 0) as impressions
     FROM miniapp_country_stats
     WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY country`
  );
  const total = rows.reduce((sum: number, row: any) => sum + metricNumber(row.impressions), 0);
  if (total <= 0) return fallbackPublisherCpm;
  const weighted = rows.reduce((sum: number, row: any) => {
    const range = tierPublisherRange(countryTier(row.country));
    const midpoint = (range.min + range.max) / 2;
    return sum + midpoint * (metricNumber(row.impressions) / total);
  }, 0);
  return weighted || fallbackPublisherCpm;
}

async function platformRevenueMetrics(db: Db) {
  const [[row]]: any = await db.query(
    `SELECT
       COALESCE(SUM(impressions), 0) as impressions,
       COALESCE(SUM(gross_revenue), 0) as gross_revenue,
       COALESCE(SUM(publisher_revenue), 0) as publisher_revenue,
       COALESCE(SUM(ads_galaxy_fee), 0) as ads_galaxy_fee,
       COALESCE(SUM(reserve_revenue), 0) as reserve_revenue
     FROM miniapp_daily_stats
     WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       AND (reconciliation_status = 'reconciled' OR network_name = 'AdsGalaxyInternal' OR reconciled_at IS NULL)`
  );
  const impressions = metricNumber(row?.impressions);
  return {
    impressions,
    grossRevenue: metricNumber(row?.gross_revenue),
    publisherRevenue: metricNumber(row?.publisher_revenue),
    adsGalaxyRevenue: metricNumber(row?.ads_galaxy_fee),
    reserveRevenue: metricNumber(row?.reserve_revenue),
    effectiveNetworkCpm: cpm(row?.gross_revenue, impressions),
    effectivePublisherCpm: cpm(row?.publisher_revenue, impressions),
  };
}

function gradualCpm(previous: number, target: number, minCpm: number, maxCpm: number) {
  const maxStep = Math.max(0.05, previous * 0.1);
  const delta = clamp(target - previous, -maxStep, maxStep);
  return roundMoney(clamp(previous + delta, minCpm, maxCpm));
}

async function calculateRecommendedCpm(db: Db, settings: OptimizerSettings) {
  const cpmSettings = await getMiniAppPublisherCpmSettings(db as PoolConnection).catch(() => null);
  const publisherShare = clamp(metricNumber(cpmSettings?.publisher_share_percent ?? 60), 1, 100) / 100;
  const revenue = await platformRevenueMetrics(db);
  const weightedPublisherTarget = await countryWeightedPublisherTarget(db, settings.recommendedCpm * publisherShare);
  const safeHistoricalAdvertiserCpm = revenue.effectiveNetworkCpm > 0
    ? revenue.effectiveNetworkCpm * 0.95
    : settings.recommendedCpm;
  const targetAdvertiserCpm = Math.max(settings.minCpm, weightedPublisherTarget / publisherShare);
  const safeTarget = revenue.impressions >= 100
    ? Math.min(targetAdvertiserCpm, safeHistoricalAdvertiserCpm)
    : Math.min(targetAdvertiserCpm, settings.recommendedCpm * 1.05);
  const recommended = gradualCpm(settings.recommendedCpm, safeTarget, settings.minCpm, settings.maxCpm);

  return {
    recommended,
    reason: revenue.impressions >= 100
      ? "historical_revenue_country_mix"
      : "limited_history_gradual_country_baseline",
    metrics: {
      publisher_share_percent: publisherShare * 100,
      weighted_publisher_target_cpm: weightedPublisherTarget,
      safe_historical_advertiser_cpm: safeHistoricalAdvertiserCpm,
      ...revenue,
    },
  };
}

async function miniAppsForOptimization(db: Db) {
  const [rows] = await db.query<MiniAppRow[]>(
    `SELECT id, COALESCE(traffic_quality_score, 60) as traffic_quality_score, COALESCE(inventory_score, 50) as inventory_score
     FROM miniapps
     WHERE is_deleted = FALSE AND status IN ('approved', 'monetized')`
  );
  return rows;
}

async function buildNetworkMetrics(db: Db, miniapp: MiniAppRow): Promise<NetworkMetric[]> {
  const globallyDisabledNetworks = await getDisabledMiniappNetworks(db);
  const [statRows]: any = await db.query(
    `SELECT network_name,
       COALESCE(SUM(impressions), 0) as impressions,
       COALESCE(SUM(gross_revenue), 0) as gross_revenue,
       COALESCE(SUM(publisher_revenue), 0) as publisher_revenue
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       AND (reconciliation_status = 'reconciled' OR network_name = 'AdsGalaxyInternal' OR reconciled_at IS NULL)
     GROUP BY network_name`,
    [miniapp.id]
  );
  const [requestRows]: any = await db.query(
    `SELECT selected_network as network_name,
       COUNT(*) as requests,
       COALESCE(SUM(CASE WHEN impression_confirmed = 1 THEN 1 ELSE 0 END), 0) as confirmed,
       COALESCE(SUM(CASE WHEN final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills,
       COALESCE(SUM(CASE WHEN final_result IN ('completed', 'impression_confirmed', 'displayed') THEN 1 ELSE 0 END), 0) as completed
     FROM miniapp_mediation_requests
     WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND selected_network <> ''
     GROUP BY selected_network`,
    [miniapp.id]
  );
  const [failureRows]: any = await db.query(
    `SELECT network_name,
       COUNT(*) as failures,
       COALESCE(SUM(CASE WHEN error_code = 'TIMEOUT' THEN 1 ELSE 0 END), 0) as timeouts,
       COALESCE(SUM(CASE WHEN error_code = 'SDK_LOAD_FAILED' THEN 1 ELSE 0 END), 0) as sdk_load_failures
     FROM miniapp_network_failures
     WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     GROUP BY network_name`,
    [miniapp.id]
  );
  const [clickRows]: any = await db.query(
    `SELECT mr.selected_network as network_name, COUNT(ac.id) as clicks
     FROM ad_click_attribution ac
     JOIN miniapp_mediation_requests mr ON mr.request_id = ac.request_id
     WHERE mr.miniapp_id = ? AND ac.campaign_type = 'miniapp' AND ac.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     GROUP BY mr.selected_network`,
    [miniapp.id]
  );
  const [priorityRows]: any = await db.query(
    "SELECT network_name, COALESCE(NULLIF(priority_order, 0), 99) as priority_order FROM miniapp_ad_networks WHERE miniapp_id = ? AND enabled = TRUE",
    [miniapp.id]
  );
  const healthRows = await getMiniAppNetworkHealthScores(miniapp.id, db as PoolConnection, { enriched: true }).catch(() => []);

  const byNetwork = new Map<string, any>();
  const merge = (networkName: unknown, patch: Record<string, unknown>) => {
    const key = String(networkName || "");
    if (!MINIAPP_NETWORKS.includes(key as MiniAppNetworkName)) return;
    byNetwork.set(key, { ...(byNetwork.get(key) || {}), ...patch, network_name: key });
  };
  for (const networkName of MINIAPP_NETWORKS) merge(networkName, {});
  for (const row of statRows) merge(row.network_name, row);
  for (const row of requestRows) merge(row.network_name, row);
  for (const row of failureRows) merge(row.network_name, row);
  for (const row of clickRows) merge(row.network_name, row);
  for (const row of priorityRows) {
    if (globallyDisabledNetworks.has(String(row.network_name || ""))) continue;
    merge(row.network_name, { priority_order: row.priority_order });
  }
  for (const row of healthRows) merge(row.network_name, { health_score: row.health_score });

  return Array.from(byNetwork.values())
    .filter((row) => metricNumber(row.priority_order) > 0)
    .filter((row) => !globallyDisabledNetworks.has(String(row.network_name || "")))
    .map((row) => {
      const requests = metricNumber(row.requests);
      const impressions = Math.max(metricNumber(row.impressions), metricNumber(row.confirmed));
      const grossRevenue = metricNumber(row.gross_revenue);
      const publisherRevenue = metricNumber(row.publisher_revenue);
      const failures = metricNumber(row.failures);
      const timeouts = metricNumber(row.timeouts);
      const clicks = metricNumber(row.clicks);
      const completed = metricNumber(row.completed);
      const healthScore = metricNumber(row.health_score || 100);
      const fillRate = requests > 0 ? impressions / requests : 0;
      const completionRate = impressions > 0 ? completed / impressions : 0;
      const failureRate = requests > 0 ? failures / requests : 0;
      const timeoutRate = requests > 0 ? timeouts / requests : 0;
      const effectiveNetworkCpm = cpm(grossRevenue, impressions);
      const effectivePublisherCpm = cpm(publisherRevenue, impressions);
      const revenueQuality = clamp(effectiveNetworkCpm / 5, 0, 1);
      const trafficQuality = clamp(metricNumber(miniapp.traffic_quality_score || 60) / 100, 0, 1);
      const inventoryQuality = clamp(metricNumber(miniapp.inventory_score || 50) / 100, 0, 1);
      const score = clamp(
        healthScore * 0.22 +
        fillRate * 100 * 0.18 +
        revenueQuality * 100 * 0.20 +
        ctr(clicks, impressions) * 3 * 0.10 +
        completionRate * 100 * 0.10 +
        trafficQuality * 100 * 0.10 +
        inventoryQuality * 100 * 0.10 -
        failureRate * 100 * 0.12 -
        timeoutRate * 100 * 0.08,
        0,
        100
      );
      return {
        miniappId: Number(miniapp.id),
        networkName: row.network_name as MiniAppNetworkName,
        requests,
        impressions,
        grossRevenue,
        publisherRevenue,
        failures,
        noFills: metricNumber(row.no_fills),
        timeouts,
        sdkLoadFailures: metricNumber(row.sdk_load_failures),
        clicks,
        completed,
        healthScore,
        trafficQuality: trafficQuality * 100,
        inventoryQuality: inventoryQuality * 100,
        previousPriority: metricNumber(row.priority_order),
        effectiveNetworkCpm,
        effectivePublisherCpm,
        fillRate,
        ctr: impressions > 0 ? clicks / impressions : 0,
        completionRate,
        failureRate,
        timeoutRate,
        revenueQuality,
        score,
      };
    });
}

function gradualPriority(previous: number, target: number) {
  if (previous <= 0 || previous === 99) return target;
  if (target < previous) return previous - 1;
  if (target > previous) return previous + 1;
  return previous;
}

async function optimizeNetworkPriorities(db: Db, runId: number) {
  const miniapps = await miniAppsForOptimization(db);
  let snapshots = 0;
  let priorityUpdates = 0;

  for (const miniapp of miniapps) {
    const metrics = await buildNetworkMetrics(db, miniapp);
    const ranked = [...metrics].sort((a, b) => b.score - a.score || a.previousPriority - b.previousPriority);
    for (let index = 0; index < ranked.length; index++) {
      const item = ranked[index];
      const recommendedPriority = index + 1;
      const appliedPriority = gradualPriority(item.previousPriority, recommendedPriority);
      if (appliedPriority !== item.previousPriority) {
        await db.query(
          "UPDATE miniapp_ad_networks SET priority_order = ? WHERE miniapp_id = ? AND network_name = ?",
          [appliedPriority, item.miniappId, item.networkName]
        );
        priorityUpdates++;
      }
      await db.query(
        `INSERT INTO miniapp_network_optimizer_snapshots
          (run_id, miniapp_id, network_name, score, rank_position, previous_priority, recommended_priority, applied_priority,
           health_score, effective_network_cpm, effective_publisher_cpm, fill_rate, ctr, completion_rate, failure_rate, timeout_rate,
           revenue_quality, metrics)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          item.miniappId,
          item.networkName,
          item.score,
          recommendedPriority,
          item.previousPriority,
          recommendedPriority,
          appliedPriority,
          item.healthScore,
          item.effectiveNetworkCpm,
          item.effectivePublisherCpm,
          item.fillRate,
          item.ctr,
          item.completionRate,
          item.failureRate,
          item.timeoutRate,
          item.revenueQuality,
          JSON.stringify(item),
        ]
      );
      snapshots++;
    }
  }

  return { miniapps: miniapps.length, snapshots, priorityUpdates };
}

async function syncRecommendedSettings(db: Db, value: number) {
  const formatted = value.toFixed(2);
  await db.query(
    `INSERT INTO settings (\`key\`, value) VALUES
      ('global_recommended_cpm_optimizer_value', ?),
      ('global_recommended_cpm', ?),
      ('miniapp_internal_recommended_cpm', ?),
      ('recommended_cpm_views', ?),
      ('recommended_cpm_clicks', ?),
      ('recommended_cpm_broadcast', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [formatted, formatted, formatted, formatted, formatted, formatted]
  );
}

async function syncOptimizerOnlySetting(db: Db, value: number) {
  await db.query(
    "INSERT INTO settings (`key`, value) VALUES ('global_recommended_cpm_optimizer_value', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [value.toFixed(2)]
  );
}

export async function runMiniAppRevenueOptimizer(input: { triggeredBy?: string } = {}) {
  await insertDefaultSettings(pool);
  const settings = await getSettings(pool);
  if (!settings.enabled) {
    return { success: false, skipped: true, reason: "optimizer_disabled" };
  }

  const recommendation = await calculateRecommendedCpm(pool, settings);
  if (settings.manualOverride) {
    await syncOptimizerOnlySetting(pool, recommendation.recommended);
  } else {
    await syncRecommendedSettings(pool, recommendation.recommended);
  }

  const [runResult]: any = await pool.query(
    `INSERT INTO miniapp_revenue_optimizer_runs
      (status, recommended_cpm, previous_recommended_cpm, applied_recommended_cpm, min_cpm, max_cpm, manual_override, reason, metrics)
     VALUES ('success', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recommendation.recommended,
      settings.recommendedCpm,
      settings.manualOverride ? settings.recommendedCpm : recommendation.recommended,
      settings.minCpm,
      settings.maxCpm,
      settings.manualOverride ? 1 : 0,
      recommendation.reason,
      JSON.stringify({ ...recommendation.metrics, triggered_by: input.triggeredBy || "cron" }),
    ]
  );

  const networkOptimization = await optimizeNetworkPriorities(pool, Number(runResult.insertId));
  return {
    success: true,
    run_id: Number(runResult.insertId),
    recommended_cpm: recommendation.recommended,
    previous_recommended_cpm: settings.recommendedCpm,
    applied_recommended_cpm: settings.manualOverride ? settings.recommendedCpm : recommendation.recommended,
    manual_override: settings.manualOverride,
    reason: recommendation.reason,
    network_optimization: networkOptimization,
  };
}

export async function getMiniAppRevenueOptimizerReport(limit = 100) {
  const [[latest]]: any = await pool.query(
    "SELECT * FROM miniapp_revenue_optimizer_runs ORDER BY created_at DESC LIMIT 1"
  );
  const [settingsRows]: any = await pool.query(
    `SELECT \`key\`, value FROM settings
     WHERE \`key\` IN ('global_min_cpm', 'global_recommended_cpm', 'global_max_cpm', 'global_recommended_cpm_optimizer_value', 'global_recommended_cpm_manual_override', 'miniapp_revenue_optimizer_enabled')`
  );
  const [networkRows]: any = await pool.query(
    `SELECT s.*, m.miniapp_name, m.miniapp_username
     FROM miniapp_network_optimizer_snapshots s
     JOIN miniapps m ON m.id = s.miniapp_id
     WHERE (? IS NULL OR s.run_id = ?)
     ORDER BY s.score DESC, s.created_at DESC
     LIMIT ?`,
    [latest?.id || null, latest?.id || null, Math.max(1, Math.min(Number(limit) || 100, 500))]
  );
  const reconciliation = await getExternalNetworkReconciliationReport(10).catch(() => null);
  return {
    latest_run: latest || null,
    settings: Object.fromEntries(settingsRows.map((row: any) => [String(row.key), row.value])),
    reconciliation,
    network_rankings: networkRows.map((row: any) => ({
      ...row,
      score: metricNumber(row.score),
      health_score: metricNumber(row.health_score),
      effective_network_cpm: metricNumber(row.effective_network_cpm),
      effective_publisher_cpm: metricNumber(row.effective_publisher_cpm),
      fill_rate: metricNumber(row.fill_rate),
      ctr: metricNumber(row.ctr),
      completion_rate: metricNumber(row.completion_rate),
      failure_rate: metricNumber(row.failure_rate),
      timeout_rate: metricNumber(row.timeout_rate),
      revenue_quality: metricNumber(row.revenue_quality),
    })),
  };
}
