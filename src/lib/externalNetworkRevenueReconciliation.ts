/* eslint-disable @typescript-eslint/no-explicit-any -- provider payloads are intentionally adapter-normalized */
import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getMiniAppFeePercent } from "@/lib/miniappStats";
import { isMiniAppNetworkName, type MiniAppNetworkName } from "@/lib/miniappNetworkAdapters";
import { cpm, metricNumber } from "@/lib/statFormulas";

type Db = typeof pool | PoolConnection;

type ProviderName = "AdsGram" | "Monetag" | "AdExium" | "RichAds" | "GigaPub";

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
  support: ProviderCapability;
  fetchReports: (input: { sinceDate: string; untilDate: string; configs: NetworkConfigRow[] }) => Promise<ProviderFetchResult>;
};

type ProviderCapability = {
  supported: boolean;
  sdk_only: boolean;
  api_reporting: boolean;
  callback_postback_only: boolean;
  hourly_reporting: boolean;
  daily_reporting: boolean;
  needs_credentials: boolean;
  needs_account_id: boolean;
  needs_widget_id: boolean;
  credentials_scope: "publisher" | "platform" | "none";
  reporting_frequency: "unknown" | "hourly_or_better" | "daily";
  status: "supported" | "not_supported" | "sdk_only" | "callback_postback_only";
  notes: string;
  sources: string[];
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
  user_id?: number;
  network_name: string;
  date: string;
  impressions: string | number;
  gross_revenue: string | number;
  ads_galaxy_fee: string | number;
  publisher_revenue: string | number;
};

type SettlementRow = RowDataPacket & {
  id: number;
  user_id: number;
  status: string;
  impressions: string | number;
  publisher_revenue: string | number;
  balance_locked: string | number;
  balance_available: string | number;
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

const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapability> = {
  AdsGram: {
    supported: false,
    sdk_only: true,
    api_reporting: false,
    callback_postback_only: false,
    hourly_reporting: false,
    daily_reporting: false,
    needs_credentials: false,
    needs_account_id: false,
    needs_widget_id: false,
    credentials_scope: "publisher",
    reporting_frequency: "unknown",
    status: "sdk_only",
    notes: "Public publisher docs verify SDK/blockId integration and platform statistics, but no public reporting API endpoint.",
    sources: [
      "https://docs.adsgram.ai/publisher/api-reference",
      "https://docs.adsgram.ai/publisher/get-block-id",
    ],
  },
  Monetag: {
    supported: false,
    sdk_only: true,
    api_reporting: false,
    callback_postback_only: true,
    hourly_reporting: false,
    daily_reporting: false,
    needs_credentials: false,
    needs_account_id: false,
    needs_widget_id: false,
    credentials_scope: "publisher",
    reporting_frequency: "unknown",
    status: "callback_postback_only",
    notes: "Public TMA docs verify SDK zone IDs and reward postbacks, but not a pull reporting API.",
    sources: [
      "https://docs.monetag.com/docs/sdk-reference/",
      "https://docs.monetag.com/docs/postbacks/configuration/",
    ],
  },
  AdExium: {
    supported: true,
    sdk_only: false,
    api_reporting: true,
    callback_postback_only: false,
    hourly_reporting: false,
    daily_reporting: true,
    needs_credentials: true,
    needs_account_id: false,
    needs_widget_id: true,
    credentials_scope: "platform",
    reporting_frequency: "daily",
    status: "supported",
    notes: "Public publisher docs verify Bearer-token stats by widget ID.",
    sources: ["https://docs.adexium.io/publisher/api-stats.html"],
  },
  RichAds: {
    supported: false,
    sdk_only: true,
    api_reporting: false,
    callback_postback_only: false,
    hourly_reporting: false,
    daily_reporting: false,
    needs_credentials: false,
    needs_account_id: true,
    needs_widget_id: true,
    credentials_scope: "publisher",
    reporting_frequency: "unknown",
    status: "sdk_only",
    notes: "Public publisher article verifies personalized JS tags with publisher ID and widget/app ID, but no public reporting API.",
    sources: ["https://richads.com/blog/faq-for-richads-publishers-how-to-make-telegram-ads-in-your-mini-apps/"],
  },
  GigaPub: {
    supported: false,
    sdk_only: true,
    api_reporting: false,
    callback_postback_only: false,
    hourly_reporting: false,
    daily_reporting: false,
    needs_credentials: false,
    needs_account_id: false,
    needs_widget_id: true,
    credentials_scope: "publisher",
    reporting_frequency: "unknown",
    status: "sdk_only",
    notes: "No verifiable public reporting API documentation was found; SDK serving remains configured by project ID.",
    sources: [],
  },
};

const PROVIDER_ORDER: Array<{ provider: ProviderName; networkName: MiniAppNetworkName }> = [
  { provider: "AdsGram", networkName: "AdsGram" },
  { provider: "Monetag", networkName: "Monetag" },
  { provider: "AdExium", networkName: "AdExium" },
  { provider: "RichAds", networkName: "RichAds" },
  { provider: "GigaPub", networkName: "GigaPub" },
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

function parseJsonObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function envValue(prefix: string, suffixes: string[]) {
  for (const suffix of suffixes) {
    const value = process.env[`${prefix}_${suffix}`] || process.env[`EXTERNAL_REVENUE_${prefix}_${suffix}`];
    if (value) return value;
  }
  return "";
}

function datesBetween(sinceDate: string, untilDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${sinceDate}T00:00:00.000Z`);
  const end = new Date(`${untilDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function fetchJsonWithRetry(url: URL, token: string, provider: ProviderName) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${provider} reporting API returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${provider} reporting API failed`);
}

function createUnsupportedProviderAdapter(config: { provider: ProviderName; networkName: MiniAppNetworkName }): ProviderAdapter {
  return {
    provider: config.provider,
    networkName: config.networkName,
    support: PROVIDER_CAPABILITIES[config.provider],
    async fetchReports() {
      return {
        status: "skipped",
        reason: "no_verified_reporting_api",
        records: [],
        metadata: { support: PROVIDER_CAPABILITIES[config.provider] },
      };
    },
  };
}

function createAdExiumProviderAdapter(): ProviderAdapter {
  return {
    provider: "AdExium",
    networkName: "AdExium",
    support: PROVIDER_CAPABILITIES.AdExium,
    async fetchReports({ sinceDate, untilDate, configs }) {
      const token = envValue("ADEXIUM", ["REPORTING_TOKEN", "API_TOKEN", "API_KEY"]);
      if (!token) {
        return { status: "skipped", reason: "missing_adexium_api_token", records: [], metadata: { required_env: ["ADEXIUM_REPORTING_TOKEN", "ADEXIUM_API_TOKEN", "ADEXIUM_API_KEY"] } };
      }

      const baseUrl = process.env.ADEXIUM_STATS_BASE_URL || "https://api.tg-ads.co/api/v1/widget/stats";
      const records: ProviderReportRecord[] = [];
      const enabledConfigs = configs.filter((config) => cleanId(config.network_placement_id));
      for (const config of enabledConfigs) {
        const widgetId = cleanId(config.network_placement_id);
        for (const date of datesBetween(sinceDate, untilDate)) {
          const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(widgetId)}/`);
          endpoint.searchParams.set("startDate", date);
          endpoint.searchParams.set("endDate", date);
          endpoint.searchParams.set("viewBy", "country");
          const payload = await fetchJsonWithRetry(endpoint, token, "AdExium");
          if (!Array.isArray(payload)) continue;
          let revenue = 0;
          let impressions = 0;
          let clicks = 0;
          const countries: unknown[] = [];
          for (const row of payload) {
            if (!row || typeof row !== "object") continue;
            const item = row as Record<string, unknown>;
            revenue += optionalMetric(item.revenue) ?? 0;
            impressions += wholeMetric(item.impressions) ?? 0;
            clicks += wholeMetric(item.clicks) ?? 0;
            countries.push(item);
          }
          records.push({
            providerRecordId: `AdExium:${widgetId}:${date}`,
            miniappId: Number(config.miniapp_id),
            placementId: widgetId,
            date,
            publisherEarnings: revenue,
            impressions,
            clicks,
            effectiveCpm: impressions > 0 ? cpm(revenue, impressions) : 0,
            metadata: { source: "adexium_widget_stats_api", view_by: "country", countries },
          });
        }
      }
      return {
        status: "success",
        records,
        metadata: {
          endpoint: new URL(baseUrl).origin,
          configured_widgets: enabledConfigs.length,
          support: PROVIDER_CAPABILITIES.AdExium,
        },
      };
    },
  };
}

function createAdapters(): ProviderAdapter[] {
  return PROVIDER_ORDER.map((config) => config.provider === "AdExium"
    ? createAdExiumProviderAdapter()
    : createUnsupportedProviderAdapter(config));
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
    `SELECT ds.*, m.user_id
     FROM miniapp_daily_stats ds
     JOIN miniapps m ON m.id = ds.miniapp_id
     WHERE ds.miniapp_id = ? AND ds.network_name = ? AND ds.date = ?
     FOR UPDATE`,
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
    `SELECT ds.*, m.user_id
     FROM miniapp_daily_stats ds
     JOIN miniapps m ON m.id = ds.miniapp_id
     WHERE ds.miniapp_id = ? AND ds.network_name = ? AND ds.date = ?
     FOR UPDATE`,
    [miniappId, networkName, date]
  );
  if (!created[0]) throw new Error("Unable to create daily stat for reconciliation");
  return created[0];
}

async function hasSettlement(conn: PoolConnection, dailyStatId: number) {
  const [rows] = await conn.query<SettlementRow[]>(
    `SELECT s.id, s.user_id, s.status, s.impressions, s.publisher_revenue, u.balance_locked, u.balance_available
     FROM miniapp_earnings_settlements s
     JOIN users u ON u.id = s.user_id
     WHERE s.daily_stat_id = ?
     FOR UPDATE`,
    [dailyStatId]
  );
  return rows[0] || null;
}

async function applySettlementAdjustment(
  conn: PoolConnection,
  settlement: SettlementRow,
  impressions: number,
  reconciledPublisherRevenue: number
) {
  const previousSettlementRevenue = metricNumber(settlement.publisher_revenue);
  const delta = reconciledPublisherRevenue - previousSettlementRevenue;
  const nextImpressions = Math.max(0, Math.floor(impressions));
  if (Math.abs(delta) <= 0.00000001 && nextImpressions === Math.floor(metricNumber(settlement.impressions))) {
    return { adjusted: false, delta: 0 };
  }

  const balanceColumn = settlement.status === "locked" ? "balance_locked" : "balance_available";
  if (delta < 0) {
    const currentBalance = metricNumber(settlement.status === "locked" ? settlement.balance_locked : settlement.balance_available);
    if (currentBalance + delta < -0.00000001) {
      return { adjusted: false, delta: 0, blocked: true, reason: `${balanceColumn}_insufficient_for_reconciliation_adjustment` };
    }
  }
  await conn.query(
    `UPDATE users SET ${balanceColumn} = GREATEST(0, ${balanceColumn} + ?) WHERE id = ?`,
    [delta, settlement.user_id]
  );
  await conn.query(
    `UPDATE miniapp_earnings_settlements
     SET publisher_revenue = ?, impressions = ?, updated_at = NOW()
     WHERE id = ?`,
    [reconciledPublisherRevenue, nextImpressions, settlement.id]
  );
  return { adjusted: true, delta, blocked: false, reason: "adjusted" };
}

async function reconcileRecord(conn: PoolConnection, adapter: ProviderAdapter, record: ProviderReportRecord, configs: NetworkConfigRow[], feePercent: number) {
  if (!isMiniAppNetworkName(adapter.networkName)) return { updated: false, reason: "invalid_network" };

  const config = findNetworkConfig(record, configs);
  if (!config) return { updated: false, reason: "network_config_not_found" };

  const stat = await findOrCreateDailyStat(conn, Number(config.miniapp_id), adapter.networkName, record.date);
  const settlement = await hasSettlement(conn, Number(stat.id));
  const previousPublisherRevenue = metricNumber(stat.publisher_revenue);
  const previousGrossRevenue = metricNumber(stat.gross_revenue);
  const providerGrossRevenue = record.grossEarnings ?? (feePercent >= 100 ? record.publisherEarnings : record.publisherEarnings / (1 - feePercent / 100));
  const reconciledGrossRevenue = Math.max(0, providerGrossRevenue);
  const reconciledPublisherRevenue = Math.min(Math.max(0, record.publisherEarnings), reconciledGrossRevenue);
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

  if (settlement) {
    const adjustment = await applySettlementAdjustment(conn, settlement, impressions, reconciledPublisherRevenue);
    if (adjustment.blocked) {
      await conn.query(
        `INSERT INTO miniapp_external_revenue_reconciliations
          (provider, provider_record_id, miniapp_id, daily_stat_id, network_name, date,
           previous_gross_revenue, previous_publisher_revenue, reconciled_gross_revenue, reconciled_publisher_revenue,
           gross_revenue_delta, publisher_revenue_delta, impressions, clicks, completed_views, fill_rate, effective_cpm,
           settlement_status, action, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'blocked_negative_balance', ?)
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
          settlement.status,
          JSON.stringify({ ...metadata, settlement_id: settlement.id, blocked_reason: adjustment.reason }),
        ]
      );
      return { updated: false, reason: adjustment.reason || "blocked_negative_balance" };
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
        JSON.stringify({ ...metadata, settlement_adjusted: adjustment.adjusted, settlement_delta: adjustment.delta }),
        stat.id,
      ]
    );
    await conn.query(
      `INSERT INTO miniapp_external_revenue_reconciliations
        (provider, provider_record_id, miniapp_id, daily_stat_id, network_name, date,
         previous_gross_revenue, previous_publisher_revenue, reconciled_gross_revenue, reconciled_publisher_revenue,
         gross_revenue_delta, publisher_revenue_delta, impressions, clicks, completed_views, fill_rate, effective_cpm,
         settlement_status, action, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        settlement.status,
        adjustment.adjusted ? "adjusted_settlement" : "settled_no_change",
        JSON.stringify({ ...metadata, settlement_id: settlement.id, settlement_delta: adjustment.delta }),
      ]
    );
    return { updated: adjustment.adjusted, reason: adjustment.adjusted ? "adjusted_settlement" : "settled_no_change" };
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
    const configs = await enabledNetworkConfigs(pool, adapter.networkName);
    const result = await adapter.fetchReports({ sinceDate, untilDate, configs });
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
      await recordProviderRun(summary, {
        reason: result.reason,
        skipped_reason: result.reason,
        report_window: { since_date: sinceDate, until_date: untilDate },
        report_dates: datesBetween(sinceDate, untilDate),
        revenue_returned: 0,
        reporting_frequency: adapter.support.reporting_frequency,
        ...result.metadata,
      });
      console.info("External network reconciliation skipped", summary);
      return summary;
    }

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
    await recordProviderRun(summary, {
      ...result.metadata,
      report_window: { since_date: sinceDate, until_date: untilDate },
      report_dates: datesBetween(sinceDate, untilDate),
      revenue_returned: result.records.reduce((sum, record) => sum + Math.max(0, record.publisherEarnings), 0),
      reporting_frequency: adapter.support.reporting_frequency,
      skipped_reason: null,
    });
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
    await recordProviderRun(summary, {
      report_window: { since_date: sinceDate, until_date: untilDate },
      report_dates: datesBetween(sinceDate, untilDate),
      revenue_returned: 0,
      reporting_frequency: adapter.support.reporting_frequency,
      failure_reason: summary.error,
    });
    console.error("External network reconciliation failed", summary);
    return summary;
  }
}

export async function runExternalNetworkRevenueReconciliation(input: { sinceDate?: string; untilDate?: string } = {}) {
  const sinceDate = normalizeDate(input.sinceDate) || daysAgo(Math.max(1, Number(process.env.EXTERNAL_REVENUE_RECONCILIATION_LOOKBACK_DAYS || 1)));
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
    provider_capabilities: PROVIDER_CAPABILITIES,
  };
}

export async function getExternalNetworkReconciliationReport(limit = 20) {
  const [providerRows]: any = await pool.query(
    `SELECT r.*, success.finished_at as last_successful_finished_at, failed.finished_at as last_failed_finished_at
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
     LEFT JOIN (
       SELECT provider, MAX(finished_at) as finished_at
       FROM miniapp_external_reconciliation_runs
       WHERE status = 'failed'
       GROUP BY provider
     ) failed ON failed.provider = r.provider
     ORDER BY FIELD(r.provider, 'AdsGram', 'Monetag', 'AdExium', 'RichAds', 'GigaPub'), r.provider`
  );
  const [[latest]]: any = await pool.query(
    "SELECT * FROM miniapp_external_reconciliation_runs ORDER BY started_at DESC LIMIT 1"
  );
  const [historyRows]: any = await pool.query(
    `SELECT provider, network_name, date, action, settlement_status,
       previous_publisher_revenue, reconciled_publisher_revenue, publisher_revenue_delta,
       previous_gross_revenue, reconciled_gross_revenue, gross_revenue_delta,
       impressions, effective_cpm, metadata, created_at
     FROM miniapp_external_revenue_reconciliations
     ORDER BY created_at DESC
     LIMIT ?`,
    [Math.max(1, Math.min(Number(limit) || 20, 100))]
  );

  return {
    last_reconciliation: latest || null,
    provider_status: providerRows.map((row: any) => {
      const metadata = parseJsonObject(row.metadata);
      const reportWindow = parseJsonObject(metadata.report_window);
      return {
        provider: row.provider,
        status: row.status,
        success: row.status !== "failed",
        last_sync: row.started_at,
        last_successful_sync: row.last_successful_finished_at || null,
        last_failed_sync: row.last_failed_finished_at || null,
        last_report_date: Array.isArray(metadata.report_dates) ? metadata.report_dates[metadata.report_dates.length - 1] || null : null,
        report_window: {
          since_date: reportWindow.since_date || null,
          until_date: reportWindow.until_date || null,
        },
        revenue_returned: metricNumber(metadata.revenue_returned),
        duration_ms: metricNumber(row.duration_ms),
        records_updated: metricNumber(row.records_updated),
        records_skipped: metricNumber(row.records_skipped),
        skipped_reason: metadata.skipped_reason || metadata.reason || null,
        errors: row.error_message || null,
        capability: PROVIDER_CAPABILITIES[row.provider as ProviderName] || null,
      };
    }),
    recent_adjustments: historyRows.map((row: any) => {
      const metadata = parseJsonObject(row.metadata);
      const cpmBefore = metricNumber(row.previous_publisher_revenue) > 0 && metricNumber(row.impressions) > 0
        ? cpm(metricNumber(row.previous_publisher_revenue), metricNumber(row.impressions))
        : null;
      return {
        provider: row.provider,
        network_name: row.network_name,
        date: row.date,
        action: row.action,
        settlement_status: row.settlement_status,
        publisher_earnings_before: metricNumber(row.previous_publisher_revenue),
        publisher_earnings_after: metricNumber(row.reconciled_publisher_revenue),
        publisher_revenue_delta: metricNumber(row.publisher_revenue_delta),
        provider_revenue_before: metricNumber(row.previous_gross_revenue),
        provider_revenue_after: metricNumber(row.reconciled_gross_revenue),
        gross_revenue_delta: metricNumber(row.gross_revenue_delta),
        cpm_before: cpmBefore,
        cpm_after: metricNumber(row.effective_cpm),
        adjustments_made: row.action,
        skipped_reason: row.action === "blocked_negative_balance" ? metadata.blocked_reason || "blocked_negative_balance" : null,
        execution_time: row.created_at,
        metadata,
      };
    }),
  };
}

export function getExternalNetworkProviderCapabilities() {
  return PROVIDER_CAPABILITIES;
}
