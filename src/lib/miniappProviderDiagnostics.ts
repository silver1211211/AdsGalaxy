import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  MINIAPP_NETWORKS,
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";
import { getDisabledMiniappNetworks } from "@/lib/productionSafety";

type Db = Pool | PoolConnection;

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  enabled: number | boolean;
  richads_publisher_id: string | null;
  richads_app_id: string | null;
};

type RequestAggregateRow = RowDataPacket & {
  network_name: string;
  requests: number;
  successes: number;
  impressions: number;
  completions: number;
  no_fills: number;
  last_successful_ad: Date | string | null;
  last_impression: Date | string | null;
  last_completion: Date | string | null;
};

type FailureAggregateRow = RowDataPacket & {
  network_name: string;
  failure_count: number;
  timeout_count: number;
  no_fill_count: number;
  last_failed_request: Date | string | null;
};

type HealthRow = RowDataPacket & {
  network_name: string;
  recent_failures: number | null;
  no_fill_count: number | null;
  timeout_count: number | null;
  sdk_load_failure_count: number | null;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  temporarily_disabled_until: Date | string | null;
};

type FallbackRow = RowDataPacket & {
  selected_network: string;
  fallback_attempts: unknown;
};

type CompletionRow = RowDataPacket & {
  selected_network: string;
  last_completion: Date | string | null;
  completions: number;
};

export type MiniAppProviderDiagnostic = {
  provider: MiniAppNetworkName;
  enabled: boolean;
  disabled: boolean;
  globally_disabled: boolean;
  configuration_loaded: boolean;
  publisher_configuration_present: boolean;
  production_ready: boolean;
  sdk_loaded: "not_tested" | "server_configured" | "not_required" | "missing_sdk_url";
  sdk_script_url_present: boolean;
  required_configuration: string[];
  last_successful_ad: string | null;
  last_failed_request: string | null;
  last_impression: string | null;
  last_completion: string | null;
  last_response_time_ms: number | null;
  timeout_count: number;
  no_fill_count: number;
  failure_count: number;
  request_count: number;
  success_count: number;
  success_rate: number;
  average_response_time_ms: number | null;
  average_fallback_duration_ms: number | null;
  slow_provider: boolean;
  temporarily_disabled_until: string | null;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJsonArray(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function requiredConfiguration(network: MiniAppNetworkName, row?: NetworkRow) {
  const missing: string[] = [];
  if (network === "AdsGalaxyInternal") return missing;
  if (network === "RichAds") {
    if (!String(row?.richads_publisher_id || "").trim()) missing.push("RichAds Publisher ID");
    if (!String(row?.richads_app_id || row?.network_placement_id || "").trim()) missing.push("RichAds App ID");
    return missing;
  }
  if (!String(row?.network_placement_id || "").trim()) {
    missing.push(network === "Monetag" ? "Monetag Zone ID" : network === "AdExium" ? "AdExium Widget ID" : network === "GigaPub" ? "GigaPub Project ID" : "AdsGram Placement ID");
  }
  return missing;
}

function sdkStatus(network: MiniAppNetworkName, sdkScriptPresent: boolean) {
  if (network === "AdsGalaxyInternal") return "not_required" as const;
  if (network === "Monetag") return sdkScriptPresent ? "server_configured" as const : "missing_sdk_url" as const;
  return sdkScriptPresent ? "server_configured" as const : "missing_sdk_url" as const;
}

export async function getMiniAppProviderDiagnostics(miniappId: number | string, db: Db) {
  const [
    networkRowsResult,
    requestRowsResult,
    failureRowsResult,
    healthRowsResult,
    fallbackRowsResult,
    completionRowsResult,
  ] = await Promise.all([
    db.query<NetworkRow[]>(
      "SELECT network_name, network_placement_id, enabled, richads_publisher_id, richads_app_id FROM miniapp_ad_networks WHERE miniapp_id = ?",
      [miniappId]
    ),
    db.query<RequestAggregateRow[]>(`
      SELECT
        selected_network as network_name,
        COUNT(*) as requests,
        SUM(CASE WHEN impression_confirmed = 1 THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN impression_confirmed = 1 THEN 1 ELSE 0 END) as impressions,
        SUM(CASE WHEN final_result IN ('completed', 'impression_confirmed', 'displayed') THEN 1 ELSE 0 END) as completions,
        SUM(CASE WHEN final_result = 'no_fill' THEN 1 ELSE 0 END) as no_fills,
        MAX(CASE WHEN impression_confirmed = 1 THEN impression_confirmed_at ELSE NULL END) as last_successful_ad,
        MAX(CASE WHEN impression_confirmed = 1 THEN impression_confirmed_at ELSE NULL END) as last_impression,
        MAX(CASE WHEN final_result IN ('completed', 'impression_confirmed', 'displayed') THEN impression_confirmed_at ELSE NULL END) as last_completion
      FROM miniapp_mediation_requests
      WHERE miniapp_id = ? AND selected_network <> ''
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY selected_network
    `, [miniappId]),
    db.query<FailureAggregateRow[]>(`
      SELECT
        network_name,
        COUNT(*) as failure_count,
        SUM(CASE WHEN error_code = 'TIMEOUT' THEN 1 ELSE 0 END) as timeout_count,
        SUM(CASE WHEN error_code = 'NO_FILL' THEN 1 ELSE 0 END) as no_fill_count,
        MAX(created_at) as last_failed_request
      FROM miniapp_network_failures
      WHERE miniapp_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY network_name
    `, [miniappId]),
    db.query<HealthRow[]>(
      "SELECT network_name, recent_failures, no_fill_count, timeout_count, sdk_load_failure_count, last_success_at, last_failure_at, temporarily_disabled_until FROM miniapp_network_health WHERE miniapp_id = ?",
      [miniappId]
    ),
    db.query<FallbackRow[]>(
      "SELECT selected_network, fallback_attempts FROM miniapp_mediation_requests WHERE miniapp_id = ? AND fallback_attempts IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ORDER BY created_at DESC LIMIT 200",
      [miniappId]
    ),
    db.query<CompletionRow[]>(`
      SELECT mr.selected_network, MAX(ev.created_at) as last_completion, COUNT(*) as completions
      FROM miniapp_internal_ad_completion_events ev
      JOIN miniapp_mediation_requests mr ON mr.request_id = ev.request_id
      WHERE mr.miniapp_id = ? AND ev.event_type = 'completed'
        AND ev.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY mr.selected_network
    `, [miniappId]).catch(() => [[] as CompletionRow[]]),
  ]);

  const networkRows = networkRowsResult[0];
  const requestRows = requestRowsResult[0];
  const failureRows = failureRowsResult[0];
  const healthRows = healthRowsResult[0];
  const fallbackRows = fallbackRowsResult[0];
  const completionRows = completionRowsResult[0];
  const globallyDisabled = await getDisabledMiniappNetworks(db);

  const networkByName = new Map(networkRows.map((row) => [row.network_name, row]));
  const requestsByName = new Map(requestRows.map((row) => [row.network_name, row]));
  const failuresByName = new Map(failureRows.map((row) => [row.network_name, row]));
  const healthByName = new Map(healthRows.map((row) => [row.network_name, row]));
  const completionsByName = new Map(completionRows.map((row) => [row.selected_network, row]));
  const durationsByName = new Map<string, number[]>();

  for (const row of fallbackRows) {
    for (const attempt of parseJsonArray(row.fallback_attempts)) {
      const networkName = String((attempt as Record<string, unknown>).network_name || "");
      const duration = toNumber((attempt as Record<string, unknown>).duration_ms);
      if (!isMiniAppNetworkName(networkName) || duration <= 0) continue;
      durationsByName.set(networkName, [...(durationsByName.get(networkName) || []), duration]);
    }
  }

  return MINIAPP_NETWORKS.map((provider) => {
    const network = networkByName.get(provider);
    const request = requestsByName.get(provider);
    const failure = failuresByName.get(provider);
    const health = healthByName.get(provider);
    const completion = completionsByName.get(provider);
    const missingConfig = requiredConfiguration(provider, network);
    let sdkScriptPresent = provider === "AdsGalaxyInternal";
    try {
      const config = network
        ? buildMiniAppNetworkClientConfig(provider, network.network_placement_id || "", {
            publisherId: network.richads_publisher_id,
            appId: network.richads_app_id,
          })
        : null;
      sdkScriptPresent = provider === "AdsGalaxyInternal" || Boolean(config?.sdk_script_url);
    } catch {
      sdkScriptPresent = false;
    }

    const enabled = Boolean(network?.enabled);
    const disabled = !enabled || globallyDisabled.has(provider);
    const requestCount = toNumber(request?.requests);
    const successCount = toNumber(request?.successes);
    const durations = durationsByName.get(provider) || [];
    const avgResponse = average(durations);
    const lastResponse = median(durations);
    const productionReady = enabled && !globallyDisabled.has(provider) && missingConfig.length === 0 && (provider === "AdsGalaxyInternal" || sdkScriptPresent);

    return {
      provider,
      enabled,
      disabled,
      globally_disabled: globallyDisabled.has(provider),
      configuration_loaded: Boolean(network),
      publisher_configuration_present: missingConfig.length === 0,
      production_ready: productionReady,
      sdk_loaded: sdkStatus(provider, sdkScriptPresent),
      sdk_script_url_present: sdkScriptPresent,
      required_configuration: missingConfig,
      last_successful_ad: iso(request?.last_successful_ad || health?.last_success_at),
      last_failed_request: iso(failure?.last_failed_request || health?.last_failure_at),
      last_impression: iso(request?.last_impression),
      last_completion: iso(completion?.last_completion || request?.last_completion),
      last_response_time_ms: lastResponse,
      timeout_count: toNumber(failure?.timeout_count) + toNumber(health?.timeout_count),
      no_fill_count: toNumber(failure?.no_fill_count) + toNumber(health?.no_fill_count) + toNumber(request?.no_fills),
      failure_count: toNumber(failure?.failure_count) + toNumber(health?.recent_failures),
      request_count: requestCount,
      success_count: successCount,
      success_rate: requestCount > 0 ? Number(((successCount / requestCount) * 100).toFixed(2)) : 0,
      average_response_time_ms: avgResponse,
      average_fallback_duration_ms: avgResponse,
      slow_provider: Boolean(avgResponse && avgResponse > 30000),
      temporarily_disabled_until: iso(health?.temporarily_disabled_until),
    } satisfies MiniAppProviderDiagnostic;
  });
}
