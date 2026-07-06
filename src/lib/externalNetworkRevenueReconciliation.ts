/* eslint-disable @typescript-eslint/no-explicit-any -- provider payloads are intentionally adapter-normalized */
import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getMiniAppFeePercent } from "@/lib/miniappStats";
import { isMiniAppNetworkName, type MiniAppNetworkName } from "@/lib/miniappNetworkAdapters";
import { cpm, metricNumber } from "@/lib/statFormulas";

type Db = typeof pool | PoolConnection;

type ProviderName = "AdsGram" | "Monetag" | "AdExium" | "RichAds";

type ProviderReportRecord = {
  providerRecordId: string;
  miniappId?: number;
  placementId?: string;
  date: string;
  publisherEarnings: number;
  grossEarnings?: number;
  impressions?: number;
  clicks?: number;
  completedViews?: number;
  fillRate?: number;
  effectiveCpm?: number;
  metadata?: Record<string, unknown>;
};

type ProviderFetchResult = {
  status: "success" | "skipped";
  reason?: string;
  records: ProviderReportRecord[];
  metadata?: Record<string, unknown>;
};

type ProviderAdapter = {
  provider: ProviderName;
  networkName: MiniAppNetworkName;
  fetchReports: (input: { sinceDate: string; untilDate: string }) => Promise<ProviderFetchResult>;
};

type NetworkConfigRow = RowDataPacket & {
  miniapp_id: number;
  network_name: string;
  network_placement_id: string | null;
  richads_app_id: string | null;
};

type DailyStatRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  network_name: string;
  date: string;
  impressions: string | number;
  gross_revenue: string | number;
  ads_galaxy_fee: string | number;
  publisher_revenue: string | number;
};

type RunSummary = {
  provider: string;
  duration_ms: number;
  success: boolean;
  status: "success" | "failed" | "skipped";
  records_fetched: number;
  records_updated: number;
  records_skipped: number;
  error?: string;
};

const REPORTING_PROVIDERS: Array<{ provider: ProviderName; networkName: MiniAppNetworkName; envPrefix: string }> = [
  { provider: "AdsGram", networkName: "AdsGram", envPrefix: "ADSGRAM" },
  { provider: "Monetag", networkName: "Monetag", envPrefix: "MONETAG" },
  { provider: "AdExium", networkName: "AdExium", envPrefix: "ADEXIUM" },
  { provider: "RichAds", networkName: "RichAds", envPrefix: "RICHADS" },
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

function normalizeDate(value: unknown) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date;
}

function optionalMetric(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function wholeMetric(value: unknown) {
  const number = optionalMetric(value);
  return number === undefined ? undefined : Math.floor(number);
}

function cleanId(value: unknown) {
  return String(value || "").trim();
}

function envValue(prefix: string, suffix: string) {
  return process.env[`${prefix}_${suffix}`] || process.env[`EXTERNAL_REVENUE_${prefix}_${suffix}`] || "";
}

function extractRecords(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  for (const key of ["records", "data", "items", "results", "reports"]) {
    if (Array.isArray(body[key])) return body[key] as unknown[];
  }
  return [];
}

function normalizeProviderRecord(provider: ProviderName, raw: unknown): ProviderReportRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const date = normalizeDate(row.date ?? row.day ?? row.report_date ?? row.stat_date);
  const publisherEarnings = optionalMetric(row.publisher_earnings ?? row.publisher_revenue ?? row.earnings ?? row.revenue ?? row.net_revenue);
  if (!date || publisherEarnings === undefined) return null;

  const miniappId = wholeMetric(row.miniapp_id ?? row.app_id);
  const placementId = cleanId(row.placement_id ?? row.zone_id ?? row.widget_id ?? row.network_placement_id ?? row.project_id);
  const providerRecordId = cleanId(row.id ?? row.report_id ?? row.record_id)
    || `${provider}:${miniappId || placementId}:${date}`;
  if (!miniappId && !placementId) return null;

  return {
    providerRecordId,
    miniappId,
    placementId,
    date,
    publisherEarnings,
    grossEarnings: optionalMetric(row.gross_earnings ?? row.gross_revenue ?? row.total_revenue),
    impressions: wholeMetric(row.impressions),
    clicks: wholeMetric(row.clicks),
    completedViews: wholeMetric(row.completed_views ?? row.completed ?? row.completedViews),
    fillRate: optionalMetric(row.fill_rate ?? row.fillRate),
    effectiveCpm: optionalMetric(row.effective_cpm ?? row.ecpm ?? row.eCPM),
    metadata: { source: "provider_reporting_api", raw },
  };
}

function createHttpProviderAdapter(config: { provider: ProviderName; networkName: MiniAppNetworkName; envPrefix: string }): ProviderAdapter {
  return {
    provider: config.provider,
    networkName: config.networkName,
    async fetchReports({ sinceDate, untilDate }) {
      const url = envValue(config.envPrefix, "REPORTING_URL") || envValue(config.envPrefix, "REPORTS_URL");
      const token = envValue(config.envPrefix, "REPORTING_TOKEN") || envValue(config.envPrefix, "API_TOKEN") || envValue(config.envPrefix, "API_KEY");
      if (!url || !token) {
        return { status: "skipped", reason: "provider_api_not_configured", records: [] };
      }

      const endpoint = new URL(url);
      endpoint.searchParams.set("since", sinceDate);
      endpoint.searchParams.set("until", untilDate);
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`${config.provider} reporting API returned ${response.status}`);
      }

      const payload = await response.json();
      const records = extractRecords(payload)
        .map((item) => normalizeProviderRecord(config.provider, item))
        .filter((item): item is ProviderReportRecord => Boolean(item));
      return { status: "success", records, metadata: { endpoint: endpoint.origin } };
    },
  };
}

function createAdapters(): ProviderAdapter[] {
  return REPORTING_PROVIDERS.map(createHttpProviderAdapter);
}

function aggregateProviderRecords(provider: string, records: ProviderReportRecord[]) {
  const grouped = new Map<string, ProviderReportRecord & { sourceIds: string[]; fillWeight: number; fillWeightedTotal: number }>();
  for (const record of records) {
    const key = `${record.miniappId || ""}:${record.placementId || ""}:${record.date}`;
    const stableId = `${provider}:${record.miniappId || cleanId(record.placementId).slice(0, 96)}:${record.date}`;
    const existing = grouped.get(key);
    const impressions = record.impressions ?? 0;
    if (!existing) {
      grouped.set(key, {
        ...record,
        providerRecordId: stableId,
        sourceIds: [record.providerRecordId],
        fillWeight: record.fillRate === undefined ? 0 : impressions || 1,
        fillWeightedTotal: record.fillRate === undefined ? 0 : record.fillRate * (impressions || 1),
      });
      continue;
    }
    existing.sourceIds.push(record.providerRecordId);
    existing.publisherEarnings += record.publisherEarnings;
    existing.grossEarnings = existing.grossEarnings === undefined && record.grossEarnings === undefined
      ? undefined
      : (existing.grossEarnings ?? 0) + (record.grossEarnings ?? 0);
    existing.impressions = (existing.impressions ?? 0) + (record.impressions ?? 0);
    existing.clicks = (existing.clicks ?? 0) + (record.clicks ?? 0);
    existing.completedViews = (existing.completedViews ?? 0) + (record.completedViews ?? 0);
    if (record.fillRate !== undefined) {
      const weight = impressions || 1;
      existing.fillWeight += weight;
      existing.fillWeightedTotal += record.fillRate * weight;
    }
    existing.metadata = {
      source: "provider_reporting_api",
      aggregated: true,
      records: existing.sourceIds,
    };
  }
  return Array.from(grouped.values()).map(({ sourceIds, fillWeight, fillWeightedTotal, ...record }) => ({
    ...record,
    fillRate: fillWeight > 0 ? fillWeightedTotal / fillWeight : record.fillRate,
    effectiveCpm: (record.impressions ?? 0) > 0 ? cpm(record.publisherEarnings, record.impressions ?? 0) : record.effectiveCpm,
    metadata: {
      ...(record.metadata || {}),
      source_record_ids: sourceIds,
    },
  }));
}

async function enabledNetworkConfigs(db: Db, networkName: MiniAppNetworkName) {
  const [rows] = await db.query<NetworkConfigRow[]>(
    `SELECT miniapp_id, network_name, network_placement_id, richads_app_id
     FROM miniapp_ad_networks
     WHERE enabled = TRUE AND network_name = ?`,
    [networkName]
  );
  return rows;
}

function findNetworkConfig(record: ProviderReportRecord, configs: NetworkConfigRow[]) {
  return configs.find((config) => {
    if (record.miniappId && Number(config.miniapp_id) !== Number(record.miniappId)) return false;
    if (!record.placementId) return Boolean(record.miniappId);
    const placements = [config.network_placement_id, config.richads_app_id].map((value) => cleanId(value)).filter(Boolean);
    return placements.includes(record.placementId);
  }) || null;
}

async function findOrCreateDailyStat(conn: PoolConnection, miniappId: number, networkName: MiniAppNetworkName, date: string) {
  const [existing] = await conn.query<DailyStatRow[]>(
    "SELECT * FROM miniapp_daily_stats WHERE miniapp_id = ? AND network_name = ? AND date = ? FOR UPDATE",
    [miniappId, networkName, date]
  );
  if (existing[0]) return existing[0];

  await conn.query(
    `INSERT INTO miniapp_daily_stats
      (miniapp_id, network_name, date, impressions, gross_revenue, ads_galaxy_fee, publisher_revenue, gross_cpm, net_cpm,
       revenue_validation_status, revenue_validation_metadata, revenue_validated_at, revenue_review_status, reconciliation_status)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 'passed', ?, NOW(), 'not_required', 'estimated')`,
    [miniappId, networkName, date, JSON.stringify({ source: "external_reconciliation_placeholder" })]
  );
  const [created] = await conn.query<DailyStatRow[]>(
    "SELECT * FROM miniapp_daily_stats WHERE miniapp_id = ? AND network_name = ? AND date = ? FOR UPDATE",
    [miniappId, networkName, date]
  );
  if (!created[0]) throw new Error("Unable to create daily stat for reconciliation");
  return created[0];
}

async function hasSettlement(conn: PoolConnection, dailyStatId: number) {
  const [[row]]: any = await conn.query(
    "SELECT COUNT(*) as count FROM miniapp_earnings_settlements WHERE daily_stat_id = ?",
    [dailyStatId]
  );
  return metricNumber(row?.count) > 0;
}

async function reconcileRecord(conn: PoolConnection, adapter: ProviderAdapter, record: ProviderReportRecord, configs: NetworkConfigRow[], feePercent: number) {
  if (!isMiniAppNetworkName(adapter.networkName)) return { updated: false, reason: "invalid_network" };

  const config = findNetworkConfig(record, configs);
  if (!config) return { updated: false, reason: "network_config_not_found" };

  const stat = await findOrCreateDailyStat(conn, Number(config.miniapp_id), adapter.networkName, record.date);
  const settled = await hasSettlement(conn, Number(stat.id));
  const previousPublisherRevenue = metricNumber(stat.publisher_revenue);
  const previousGrossRevenue = metricNumber(stat.gross_revenue);
  const reconciledPublisherRevenue = record.publisherEarnings;
  const reconciledGrossRevenue = record.grossEarnings ?? (feePercent >= 100 ? reconciledPublisherRevenue : reconciledPublisherRevenue / (1 - feePercent / 100));
  const publisherRevenueDelta = reconciledPublisherRevenue - previousPublisherRevenue;
  const grossRevenueDelta = reconciledGrossRevenue - previousGrossRevenue;
  const impressions = record.impressions ?? Math.floor(metricNumber(stat.impressions));
  const effectivePublisherCpm = record.effectiveCpm ?? cpm(reconciledPublisherRevenue, impressions);
  const adsGalaxyFee = Math.max(0, reconciledGrossRevenue - reconciledPublisherRevenue);
  const metadata = {
    provider: adapter.provider,
    provider_record_id: record.providerRecordId,
    placement_id: record.placementId || null,
    authoritative_fields: {
      publisher_earnings: true,
      gross_earnings: record.grossEarnings !== undefined,
      impressions: record.impressions !== undefined,
      clicks: record.clicks !== undefined,
      completed_views: record.completedViews !== undefined,
      fill_rate: record.fillRate !== undefined,
      effective_cpm: record.effectiveCpm !== undefined,
    },
    raw: record.metadata || null,
  };

  if (settled) {
    await conn.query(
      `INSERT INTO miniapp_external_revenue_reconciliations
        (provider, provider_record_id, miniapp_id, daily_stat_id, network_name, date,
         previous_gross_revenue, previous_publisher_revenue, reconciled_gross_revenue, reconciled_publisher_revenue,
         gross_revenue_delta, publisher_revenue_delta, impressions, clicks, completed_views, fill_rate, effective_cpm,
         settlement_status, action, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'settled', 'blocked_settled', ?)
       ON DUPLICATE KEY UPDATE
         previous_gross_revenue = VALUES(previous_gross_revenue),
         previous_publisher_revenue = VALUES(previous_publisher_revenue),
         reconciled_gross_revenue = VALUES(reconciled_gross_revenue),
         reconciled_publisher_revenue = VALUES(reconciled_publisher_revenue),
         gross_revenue_delta = VALUES(gross_revenue_delta),
         publisher_revenue_delta = VALUES(publisher_revenue_delta),
         impressions = VALUES(impressions),
         clicks = VALUES(clicks),
         completed_views = VALUES(completed_views),
         fill_rate = VALUES(fill_rate),
         effective_cpm = VALUES(effective_cpm),
         settlement_status = VALUES(settlement_status),
         action = VALUES(action),
         metadata = VALUES(metadata)`,
      [
        adapter.provider,
        record.providerRecordId,
        stat.miniapp_id,
        stat.id,
        adapter.networkName,
        record.date,
        previousGrossRevenue,
        previousPublisherRevenue,
        reconciledGrossRevenue,
        reconciledPublisherRevenue,
        grossRevenueDelta,
        publisherRevenueDelta,
        record.impressions ?? null,
        record.clicks ?? null,
        record.completedViews ?? null,
        record.fillRate ?? null,
        effectivePublisherCpm,
        JSON.stringify(metadata),
      ]
    );
    return { updated: false, reason: "settled_row_not_adjusted" };
  }

  await conn.query(
    `UPDATE miniapp_daily_stats
     SET impressions = ?,
         provider_reported_impressions = ?,
         provider_reported_clicks = ?,
         provider_reported_completed_views = ?,
         provider_reported_fill_rate = ?,
         provider_reported_effective_cpm = ?,
         gross_revenue = ?,
         ads_galaxy_fee = ?,
         publisher_revenue = ?,
         gross_cpm = CASE WHEN ? > 0 THEN (? / ?) * 1000 ELSE 0 END,
         net_cpm = ?,
         revenue_validation_status = 'passed',
         revenue_validation_reason = NULL,
         revenue_validation_metadata = ?,
         revenue_validated_at = NOW(),
         revenue_review_status = 'not_required',
         reconciliation_status = 'reconciled',
         reconciliation_metadata = ?,
         reconciled_at = NOW()
     WHERE id = ?`,
    [
      impressions,
      record.impressions ?? null,
      record.clicks ?? null,
      record.completedViews ?? null,
      record.fillRate ?? null,
      effectivePublisherCpm,
      reconciledGrossRevenue,
      adsGalaxyFee,
      reconciledPublisherRevenue,
      impressions,
      reconciledGrossRevenue,
      impressions,
      effectivePublisherCpm,
      JSON.stringify({ source: "external_provider_reporting", provider: adapter.provider }),
      JSON.stringify(metadata),
      stat.id,
    ]
  );

  await conn.query(
    `INSERT INTO miniapp_external_revenue_reconciliations
      (provider, provider_record_id, miniapp_id, daily_stat_id, network_name, date,
       previous_gross_revenue, previous_publisher_revenue, reconciled_gross_revenue, reconciled_publisher_revenue,
       gross_revenue_delta, publisher_revenue_delta, impressions, clicks, completed_views, fill_rate, effective_cpm,
       settlement_status, action, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unsettled', 'applied', ?)
       ON DUPLICATE KEY UPDATE
         previous_gross_revenue = VALUES(previous_gross_revenue),
         previous_publisher_revenue = VALUES(previous_publisher_revenue),
         reconciled_gross_revenue = VALUES(reconciled_gross_revenue),
         reconciled_publisher_revenue = VALUES(reconciled_publisher_revenue),
         gross_revenue_delta = VALUES(gross_revenue_delta),
         publisher_revenue_delta = VALUES(publisher_revenue_delta),
         impressions = VALUES(impressions),
         clicks = VALUES(clicks),
         completed_views = VALUES(completed_views),
         fill_rate = VALUES(fill_rate),
         effective_cpm = VALUES(effective_cpm),
         settlement_status = VALUES(settlement_status),
         action = VALUES(action),
         metadata = VALUES(metadata)`,
    [
      adapter.provider,
      record.providerRecordId,
      stat.miniapp_id,
      stat.id,
      adapter.networkName,
      record.date,
      previousGrossRevenue,
      previousPublisherRevenue,
      reconciledGrossRevenue,
      reconciledPublisherRevenue,
      grossRevenueDelta,
      publisherRevenueDelta,
      record.impressions ?? null,
      record.clicks ?? null,
      record.completedViews ?? null,
      record.fillRate ?? null,
      effectivePublisherCpm,
      JSON.stringify(metadata),
    ]
  );

  return { updated: Math.abs(publisherRevenueDelta) > 0.00000001 || Math.abs(grossRevenueDelta) > 0.00000001, reason: "applied" };
}

async function recordProviderRun(summary: RunSummary, metadata?: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO miniapp_external_reconciliation_runs
      (provider, status, started_at, finished_at, duration_ms, records_fetched, records_updated, records_skipped, error_message, metadata)
     VALUES (?, ?, DATE_SUB(NOW(), INTERVAL ? MICROSECOND), NOW(), ?, ?, ?, ?, ?, ?)`,
    [
      summary.provider,
      summary.status,
      summary.duration_ms * 1000,
      summary.duration_ms,
      summary.records_fetched,
      summary.records_updated,
      summary.records_skipped,
      summary.error || null,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function reconcileProvider(adapter: ProviderAdapter, sinceDate: string, untilDate: string): Promise<RunSummary> {
  const started = Date.now();
  let fetched = 0;
  let updated = 0;
  let skipped = 0;
  try {
    const result = await adapter.fetchReports({ sinceDate, untilDate });
    fetched = result.records.length;
    if (result.status === "skipped") {
      const summary: RunSummary = {
        provider: adapter.provider,
        duration_ms: Date.now() - started,
        success: true,
        status: "skipped",
        records_fetched: 0,
        records_updated: 0,
        records_skipped: 0,
      };
      await recordProviderRun(summary, { reason: result.reason, ...result.metadata });
      console.info("External network reconciliation skipped", summary);
      return summary;
    }

    const configs = await enabledNetworkConfigs(pool, adapter.networkName);
    const feePercent = await getMiniAppFeePercent();
    for (const record of aggregateProviderRecords(adapter.provider, result.records)) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const outcome = await reconcileRecord(conn, adapter, record, configs, feePercent);
        await conn.commit();
        if (outcome.updated) updated++;
        else skipped++;
      } catch (error) {
        await conn.rollback();
        skipped++;
        console.error("External revenue record reconciliation failed", { provider: adapter.provider, record_id: record.providerRecordId, error });
      } finally {
        conn.release();
      }
    }

    const summary: RunSummary = {
      provider: adapter.provider,
      duration_ms: Date.now() - started,
      success: true,
      status: "success",
      records_fetched: fetched,
      records_updated: updated,
      records_skipped: skipped,
    };
    await recordProviderRun(summary, result.metadata);
    console.info("External network reconciliation completed", summary);
    return summary;
  } catch (error: any) {
    const summary: RunSummary = {
      provider: adapter.provider,
      duration_ms: Date.now() - started,
      success: false,
      status: "failed",
      records_fetched: fetched,
      records_updated: updated,
      records_skipped: skipped,
      error: error?.message || "Provider reconciliation failed",
    };
    await recordProviderRun(summary);
    console.error("External network reconciliation failed", summary);
    return summary;
  }
}

export async function runExternalNetworkRevenueReconciliation(input: { sinceDate?: string; untilDate?: string } = {}) {
  const sinceDate = normalizeDate(input.sinceDate) || daysAgo(Math.max(1, Number(process.env.EXTERNAL_REVENUE_RECONCILIATION_LOOKBACK_DAYS || 3)));
  const untilDate = normalizeDate(input.untilDate) || isoDate(new Date());
  const providers = createAdapters();
  const results: RunSummary[] = [];
  for (const provider of providers) {
    results.push(await reconcileProvider(provider, sinceDate, untilDate));
  }
  return {
    success: results.every((result) => result.success),
    since_date: sinceDate,
    until_date: untilDate,
    providers: results,
    records_updated: results.reduce((sum, result) => sum + result.records_updated, 0),
    records_skipped: results.reduce((sum, result) => sum + result.records_skipped, 0),
  };
}

export async function getExternalNetworkReconciliationReport(limit = 20) {
  const [providerRows]: any = await pool.query(
    `SELECT r.*, success.finished_at as last_successful_finished_at
     FROM miniapp_external_reconciliation_runs r
     JOIN (
       SELECT provider, MAX(id) as id
       FROM miniapp_external_reconciliation_runs
       GROUP BY provider
     ) latest ON latest.id = r.id
     LEFT JOIN (
       SELECT provider, MAX(finished_at) as finished_at
       FROM miniapp_external_reconciliation_runs
       WHERE status = 'success'
       GROUP BY provider
     ) success ON success.provider = r.provider
     ORDER BY FIELD(r.provider, 'AdsGram', 'Monetag', 'AdExium', 'RichAds'), r.provider`
  );
  const [[latest]]: any = await pool.query(
    "SELECT * FROM miniapp_external_reconciliation_runs ORDER BY started_at DESC LIMIT 1"
  );
  const [historyRows]: any = await pool.query(
    `SELECT provider, network_name, date, action, settlement_status, publisher_revenue_delta,
       effective_cpm, created_at
     FROM miniapp_external_revenue_reconciliations
     ORDER BY created_at DESC
     LIMIT ?`,
    [Math.max(1, Math.min(Number(limit) || 20, 100))]
  );

  return {
    last_reconciliation: latest || null,
    provider_status: providerRows.map((row: any) => ({
      provider: row.provider,
      status: row.status,
      success: row.status !== "failed",
      last_sync: row.started_at,
      last_successful_sync: row.last_successful_finished_at || null,
      duration_ms: metricNumber(row.duration_ms),
      records_updated: metricNumber(row.records_updated),
      records_skipped: metricNumber(row.records_skipped),
      errors: row.error_message || null,
    })),
    recent_adjustments: historyRows.map((row: any) => ({
      ...row,
      publisher_revenue_delta: metricNumber(row.publisher_revenue_delta),
      effective_cpm: metricNumber(row.effective_cpm),
    })),
  };
}
