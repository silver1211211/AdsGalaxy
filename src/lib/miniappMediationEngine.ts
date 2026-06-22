import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  MINIAPP_NETWORKS,
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppAdFormat,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";
import { canShowMonetag, recordMonetagShown } from "@/lib/miniappMonetagProtection";
import { INTERNAL_NETWORK_NAME, selectInternalRewardedCampaign } from "@/lib/miniappInternalAds";
import {
  detectMiniAppRequestFlags,
  getMiniAppNetworkHealthScores,
  getMiniAppOptimizationSettings,
} from "@/lib/miniappOptimization";

const FALLBACK_ERROR_CODES = new Set([
  "SDK_LOAD_FAILED",
  "AD_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_CONFIG",
  "NETWORK_ERROR",
]);

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  enabled: number | boolean;
  priority_order: number | null;
  recent_failures: number | null;
  temporarily_disabled_until: Date | string | null;
  health_score?: number | null;
  internal_campaign_id?: number | null;
  internal_ad?: Record<string, unknown> | null;
};

type RequestRow = RowDataPacket & {
  miniapp_id: number;
  telegram_user_id: string | number;
  country: string | null;
  ad_format: string;
  root_request_id: string | null;
  attempted_networks: string | null;
  fallback_attempts: string | null;
};

export type SkippedNetwork = {
  network_name: string;
  reason: string;
};

export type MediationDecision = {
  success: boolean;
  request_id?: string;
  selected_network?: MiniAppNetworkName;
  network_placement_id?: string;
  internal_ad?: Record<string, unknown> | null;
  enabled_networks: string[];
  candidate_networks: string[];
  attempted_networks: string[];
  skipped_networks: SkippedNetwork[];
  fallback_attempts: Array<Record<string, unknown>>;
  fallback_available: boolean;
  ad_format: MiniAppAdFormat;
  decision_reason: string;
  error_code?: "NO_FILL";
};

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFuture(value: Date | string | null) {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function supportsFormat(networkName: MiniAppNetworkName, adFormat: MiniAppAdFormat, networkPlacementId: string) {
  const config = buildMiniAppNetworkClientConfig(networkName, networkPlacementId);
  if (adFormat === "rewarded") return config.supports_rewarded;
  if (adFormat === "interstitial") return config.supports_interstitial;
  if (adFormat === "banner") return config.supports_banner;
  return false;
}

export function isFallbackErrorCode(errorCode: string) {
  return FALLBACK_ERROR_CODES.has(errorCode);
}

export async function getMiniappNetworksForMediation(miniappId: number | string, conn: PoolConnection) {
  const [rows] = await conn.query<NetworkRow[]>(`
    SELECT
      mn.network_name,
      mn.network_placement_id,
      mn.enabled,
      COALESCE(NULLIF(mn.priority_order, 0), FIELD(mn.network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds', 'AdsGalaxyInternal')) as priority_order,
      mh.recent_failures,
      mh.temporarily_disabled_until
    FROM miniapp_ad_networks mn
    LEFT JOIN miniapp_network_health mh
      ON mh.miniapp_id = mn.miniapp_id AND mh.network_name = mn.network_name
    WHERE mn.miniapp_id = ?
      AND mn.network_name IN (?)
    ORDER BY priority_order ASC, FIELD(mn.network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds', 'AdsGalaxyInternal')
  `, [miniappId, [...MINIAPP_NETWORKS]]);

  return rows;
}

export async function selectMediationNetwork(input: {
  conn: PoolConnection;
  miniappId: number;
  telegramUserId: string;
  adFormat: MiniAppAdFormat;
  country?: string | null;
  alreadyAttempted?: string[];
}) {
  const networks = await getMiniappNetworksForMediation(input.miniappId, input.conn);
  const enabledNetworks = networks.filter((network) => Boolean(network.enabled));
  const internalCampaign = input.adFormat === "rewarded"
    ? await selectInternalRewardedCampaign({
        conn: input.conn,
        miniappId: input.miniappId,
        telegramUserId: input.telegramUserId,
        country: input.country || null,
      })
    : { campaign: null, skip_reason: "unsupported_ad_format" };
  const scoreRows = await getMiniAppNetworkHealthScores(input.miniappId, input.conn).catch(() => []);
  const scoreMap = new Map(scoreRows.map((row) => [row.network_name, row.health_score]));

  if (internalCampaign.campaign) {
    enabledNetworks.push({
      network_name: INTERNAL_NETWORK_NAME,
      network_placement_id: String(internalCampaign.campaign.id),
      enabled: true,
      priority_order: 5,
      recent_failures: null,
      temporarily_disabled_until: null,
      health_score: scoreMap.get(INTERNAL_NETWORK_NAME) ?? 100,
      internal_campaign_id: internalCampaign.campaign.id,
      internal_ad: internalCampaign.campaign,
    } as NetworkRow);
  }

  for (const network of enabledNetworks) {
    network.health_score = scoreMap.get(network.network_name as MiniAppNetworkName) ?? 100;
  }

  enabledNetworks.sort((a, b) => {
    const priorityA = Number(a.priority_order || 99);
    const priorityB = Number(b.priority_order || 99);
    const scoreA = Number(a.health_score ?? 100);
    const scoreB = Number(b.health_score ?? 100);
    const effectiveA = scoreA - ((priorityA - 1) * 8);
    const effectiveB = scoreB - ((priorityB - 1) * 8);
    return effectiveB - effectiveA || priorityA - priorityB;
  });

  const attempted = new Set((input.alreadyAttempted || []).filter(Boolean));
  const skipped: SkippedNetwork[] = [];
  const candidates: NetworkRow[] = [];

  if (!internalCampaign.campaign && !attempted.has(INTERNAL_NETWORK_NAME)) {
    skipped.push({ network_name: INTERNAL_NETWORK_NAME, reason: internalCampaign.skip_reason || "no_internal_campaign" });
  }

  for (const network of enabledNetworks) {
    if (!isMiniAppNetworkName(network.network_name)) {
      skipped.push({ network_name: network.network_name, reason: "unsupported_network" });
      continue;
    }

    if (attempted.has(network.network_name)) {
      skipped.push({ network_name: network.network_name, reason: "already_attempted" });
      continue;
    }

    if (network.network_name === INTERNAL_NETWORK_NAME) {
      candidates.push(network);
      continue;
    }

    if (isFuture(network.temporarily_disabled_until)) {
      skipped.push({ network_name: network.network_name, reason: "temporarily_disabled" });
      continue;
    }

    try {
      if (!supportsFormat(network.network_name, input.adFormat, network.network_placement_id || "")) {
        skipped.push({ network_name: network.network_name, reason: "unsupported_ad_format" });
        continue;
      }
    } catch (error: any) {
      skipped.push({ network_name: network.network_name, reason: error?.message || "invalid_config" });
      continue;
    }

    if (network.network_name === "Monetag") {
      const monetagState = await canShowMonetag(input.miniappId, input.telegramUserId, input.conn);
      if (!monetagState.allowed) {
        skipped.push({ network_name: "Monetag", reason: `monetag_${monetagState.reason}` });
        continue;
      }
    }

    candidates.push(network);
  }

  const selected = candidates[0];
  if (selected?.network_name === "Monetag") {
    await recordMonetagShown(input.miniappId, input.telegramUserId, input.conn);
  }

  return {
    selected,
    enabled_networks: enabledNetworks.map((network) => network.network_name),
    candidate_networks: candidates.map((network) => network.network_name),
    skipped_networks: skipped,
  };
}

export async function createMediationAttempt(input: {
  conn: PoolConnection;
  miniappId: number;
  telegramUserId: string;
  country: string | null;
  adFormat: MiniAppAdFormat;
  parentRequestId?: string | null;
  rootRequestId?: string | null;
  alreadyAttempted?: string[];
  fallbackAttempts?: Array<Record<string, unknown>>;
}) {
  const decision = await selectMediationNetwork({
    conn: input.conn,
    miniappId: input.miniappId,
    telegramUserId: input.telegramUserId,
    adFormat: input.adFormat,
    country: input.country,
    alreadyAttempted: input.alreadyAttempted,
  });
  await detectMiniAppRequestFlags({
    conn: input.conn,
    miniappId: input.miniappId,
    telegramUserId: input.telegramUserId,
  }).catch(() => undefined);

  const rootRequestId = input.rootRequestId || randomUUID();
  const requestId = decision.selected ? randomUUID() : rootRequestId;
  const attemptedNetworks = decision.selected
    ? [...(input.alreadyAttempted || []), decision.selected.network_name]
    : [...(input.alreadyAttempted || [])];
  const fallbackAttempts = input.fallbackAttempts || [];

  if (!decision.selected) {
    await input.conn.query(
      `INSERT INTO miniapp_mediation_requests
        (miniapp_id, telegram_user_id, country, ad_format, selected_network, internal_campaign_id, request_id, parent_request_id, root_request_id,
         candidate_networks, attempted_networks, skipped_networks, fallback_attempts, decision_reason, final_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.miniappId,
        input.telegramUserId,
        input.country,
        input.adFormat,
        "",
        null,
        requestId,
        input.parentRequestId || null,
        rootRequestId,
        JSON.stringify(decision.candidate_networks),
        JSON.stringify(attemptedNetworks),
        JSON.stringify(decision.skipped_networks),
        JSON.stringify(fallbackAttempts),
        "no_eligible_network",
        "no_fill",
      ]
    );

    return {
      success: false,
      request_id: requestId,
      enabled_networks: decision.enabled_networks,
      candidate_networks: decision.candidate_networks,
      attempted_networks: attemptedNetworks,
      skipped_networks: decision.skipped_networks,
      fallback_attempts: fallbackAttempts,
      fallback_available: false,
      ad_format: input.adFormat,
      decision_reason: "no_eligible_network",
      error_code: "NO_FILL",
    } satisfies MediationDecision;
  }

  const fallbackAvailable = decision.candidate_networks.length > 1;
  const decisionReason = input.parentRequestId ? "fallback_selected" : "priority_selected";

  await input.conn.query(
    `INSERT INTO miniapp_mediation_requests
      (miniapp_id, telegram_user_id, country, ad_format, selected_network, internal_campaign_id, request_id, parent_request_id, root_request_id,
       candidate_networks, attempted_networks, skipped_networks, fallback_attempts, decision_reason, final_result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.miniappId,
      input.telegramUserId,
      input.country,
      input.adFormat,
      decision.selected.network_name,
      decision.selected.internal_campaign_id || null,
      requestId,
      input.parentRequestId || null,
      rootRequestId,
      JSON.stringify(decision.candidate_networks),
      JSON.stringify(attemptedNetworks),
      JSON.stringify(decision.skipped_networks),
      JSON.stringify(fallbackAttempts),
      decisionReason,
      "selected",
    ]
  );

  return {
    success: true,
    request_id: requestId,
    selected_network: decision.selected.network_name as MiniAppNetworkName,
    network_placement_id: decision.selected.network_placement_id || "",
    internal_ad: decision.selected.internal_ad || null,
    enabled_networks: decision.enabled_networks,
    candidate_networks: decision.candidate_networks,
    attempted_networks: attemptedNetworks,
    skipped_networks: decision.skipped_networks,
    fallback_attempts: fallbackAttempts,
    fallback_available: fallbackAvailable,
    ad_format: input.adFormat,
    decision_reason: decisionReason,
  } satisfies MediationDecision;
}

export async function getMediationRequestForFallback(requestId: string, conn: PoolConnection) {
  const [rows] = await conn.query<RequestRow[]>(`
    SELECT miniapp_id, telegram_user_id, country, ad_format, root_request_id, attempted_networks, fallback_attempts
    FROM miniapp_mediation_requests
    WHERE request_id = ?
    FOR UPDATE
  `, [requestId]);

  return rows[0] || null;
}

export async function recordMiniappNetworkFailure(input: {
  conn: PoolConnection;
  miniappId: number;
  networkName: MiniAppNetworkName;
  requestId: string;
  errorCode: string;
  errorMessage: string;
  adFormat: string;
}) {
  await input.conn.query(
    `INSERT INTO miniapp_network_failures
      (miniapp_id, network_name, request_id, error_code, error_message, ad_format)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.miniappId,
      input.networkName,
      input.requestId,
      input.errorCode,
      input.errorMessage.slice(0, 255),
      input.adFormat,
    ]
  );

  const [[countRow]] = await input.conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) as recent_failures
     FROM miniapp_network_failures
     WHERE miniapp_id = ?
       AND network_name = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [input.miniappId, input.networkName, (await getMiniAppOptimizationSettings(input.conn)).network_failure_window_minutes]
  );

  const settings = await getMiniAppOptimizationSettings(input.conn);
  const recentFailures = Number(countRow?.recent_failures || 0);
  const shouldDisable = recentFailures >= settings.network_failure_disable_threshold;
  const score = Math.max(0, 100 - (recentFailures * 12));

  await input.conn.query(
    `INSERT INTO miniapp_network_health
      (miniapp_id, network_name, health_score, recent_failures, no_fill_count, timeout_count, sdk_load_failure_count, last_failure_at, temporarily_disabled_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), CASE WHEN ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE) ELSE NULL END)
     ON DUPLICATE KEY UPDATE
       health_score = VALUES(health_score),
       recent_failures = VALUES(recent_failures),
       no_fill_count = no_fill_count + VALUES(no_fill_count),
       timeout_count = timeout_count + VALUES(timeout_count),
       sdk_load_failure_count = sdk_load_failure_count + VALUES(sdk_load_failure_count),
       last_failure_at = NOW(),
       temporarily_disabled_until = CASE
         WHEN ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE)
         ELSE temporarily_disabled_until
       END`,
    [
      input.miniappId,
      input.networkName,
      score,
      recentFailures,
      input.errorCode === "NO_FILL" ? 1 : 0,
      input.errorCode === "TIMEOUT" ? 1 : 0,
      input.errorCode === "SDK_LOAD_FAILED" ? 1 : 0,
      shouldDisable ? 1 : 0,
      settings.network_disable_duration_minutes,
      shouldDisable ? 1 : 0,
      settings.network_disable_duration_minutes,
    ]
  );

  return { recent_failures: recentFailures, temporarily_disabled: shouldDisable };
}

export function readAttemptState(row: RequestRow) {
  return {
    rootRequestId: row.root_request_id || null,
    attemptedNetworks: parseJsonArray(row.attempted_networks).map(String),
    fallbackAttempts: parseJsonArray(row.fallback_attempts) as Array<Record<string, unknown>>,
  };
}
