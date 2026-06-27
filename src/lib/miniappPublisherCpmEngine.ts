import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export type MiniAppCpmMode = "live" | "fixed";

export type MiniAppPublisherCpmSettings = {
  min_cpm: number;
  recommended_cpm: number;
  max_cpm: number;
  publisher_share_percent: number;
  ads_galaxy_share_percent: number;
  reserve_percent: number;
  min_quality_factor: number;
  max_quality_factor: number;
  traffic_sensitivity: "low" | "medium" | "high";
  repeat_penalty_enabled: boolean;
  reserve_pool_enabled: boolean;
};

export type MiniAppPublisherCpmInput = {
  conn: PoolConnection;
  campaignId: number;
  miniappId: number;
  telegramUserId?: string | number;
  country?: string | null;
  advertiserCpm: number;
  cpmMode: string | null;
  fixedPublisherCpm?: number | null;
};

type SettingRow = RowDataPacket & {
  key: string;
  value: string;
};

type QualitySnapshotRow = RowDataPacket & {
  total_impressions: number;
  unique_users: number;
  repeat_count: number;
};

const DEFAULT_SETTINGS: MiniAppPublisherCpmSettings = {
  min_cpm: 0.5,
  recommended_cpm: 1,
  max_cpm: 5,
  publisher_share_percent: 60,
  ads_galaxy_share_percent: 30,
  reserve_percent: 10,
  min_quality_factor: 0.1,
  max_quality_factor: 0.9,
  traffic_sensitivity: "medium",
  repeat_penalty_enabled: true,
  reserve_pool_enabled: true,
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function settingNumber(rows: Map<string, string>, key: string, fallback: number) {
  return toNumber(rows.get(key), fallback);
}

function settingBool(rows: Map<string, string>, key: string, fallback: boolean) {
  const value = rows.get(key);
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "enabled";
}

export async function getMiniAppPublisherCpmSettings(conn?: PoolConnection): Promise<MiniAppPublisherCpmSettings> {
  const db = conn || pool;
  const [rows] = await db.query<SettingRow[]>(`
    SELECT \`key\`, value
    FROM settings
    WHERE \`key\` IN (
      'miniapp_internal_min_cpm',
      'miniapp_internal_recommended_cpm',
      'miniapp_internal_max_cpm',
      'miniapp_internal_publisher_share_percent',
      'miniapp_internal_ads_galaxy_share_percent',
      'miniapp_internal_reserve_percent',
      'miniapp_internal_min_quality_factor',
      'miniapp_internal_max_quality_factor',
      'miniapp_internal_traffic_sensitivity',
      'miniapp_internal_repeat_penalty_enabled',
      'miniapp_internal_reserve_pool_enabled'
    )
  `);

  const settingsMap = new Map(rows.map((row) => [row.key, row.value]));
  const sensitivity = String(settingsMap.get("miniapp_internal_traffic_sensitivity") || DEFAULT_SETTINGS.traffic_sensitivity).toLowerCase();
  const minQuality = clamp(settingNumber(settingsMap, "miniapp_internal_min_quality_factor", DEFAULT_SETTINGS.min_quality_factor), 0, 1);
  const maxQuality = clamp(settingNumber(settingsMap, "miniapp_internal_max_quality_factor", DEFAULT_SETTINGS.max_quality_factor), minQuality, 1);

  return {
    min_cpm: Math.max(0, settingNumber(settingsMap, "miniapp_internal_min_cpm", DEFAULT_SETTINGS.min_cpm)),
    recommended_cpm: Math.max(0, settingNumber(settingsMap, "miniapp_internal_recommended_cpm", DEFAULT_SETTINGS.recommended_cpm)),
    max_cpm: Math.max(0, settingNumber(settingsMap, "miniapp_internal_max_cpm", DEFAULT_SETTINGS.max_cpm)),
    publisher_share_percent: clamp(settingNumber(settingsMap, "miniapp_internal_publisher_share_percent", DEFAULT_SETTINGS.publisher_share_percent), 0, 100),
    ads_galaxy_share_percent: clamp(settingNumber(settingsMap, "miniapp_internal_ads_galaxy_share_percent", DEFAULT_SETTINGS.ads_galaxy_share_percent), 0, 100),
    reserve_percent: clamp(settingNumber(settingsMap, "miniapp_internal_reserve_percent", DEFAULT_SETTINGS.reserve_percent), 0, 100),
    min_quality_factor: minQuality,
    max_quality_factor: maxQuality,
    traffic_sensitivity: sensitivity === "low" || sensitivity === "high" ? sensitivity : "medium",
    repeat_penalty_enabled: settingBool(settingsMap, "miniapp_internal_repeat_penalty_enabled", DEFAULT_SETTINGS.repeat_penalty_enabled),
    reserve_pool_enabled: settingBool(settingsMap, "miniapp_internal_reserve_pool_enabled", DEFAULT_SETTINGS.reserve_pool_enabled),
  };
}

export function assertMiniAppRevenueSplit(settings: MiniAppPublisherCpmSettings) {
  const total = settings.publisher_share_percent + settings.ads_galaxy_share_percent + settings.reserve_percent;
  if (Math.abs(total - 100) > 0.000001) {
    throw new Error("Mini App internal revenue split must equal 100%");
  }
}

export function normalizeMiniAppCpmMode(value: unknown): MiniAppCpmMode {
  return String(value || "live").toLowerCase() === "fixed" ? "fixed" : "live";
}

export function validateAdvertiserCpmBid(cpm: number, settings: MiniAppPublisherCpmSettings) {
  if (!Number.isFinite(cpm) || cpm <= 0) {
    throw new Error("CPM Bid is required");
  }
  if (settings.min_cpm > 0 && cpm < settings.min_cpm) {
    throw new Error(`CPM Bid must be at least $${settings.min_cpm.toFixed(2)}`);
  }
  if (settings.max_cpm > 0 && cpm > settings.max_cpm) {
    throw new Error("CPM Bid exceeds the maximum allowed CPM");
  }
}

export function maxPublisherCpm(advertiserCpm: number, settings: MiniAppPublisherCpmSettings) {
  return Math.max(0, advertiserCpm * (settings.publisher_share_percent / 100));
}

function repeatPenaltyFactor(repeatCount: number) {
  if (repeatCount <= 3) return 1;
  if (repeatCount <= 10) return 0.85;
  if (repeatCount <= 20) return 0.65;
  if (repeatCount <= 50) return 0.4;
  return 0.2;
}

function sensitivityWeight(value: MiniAppPublisherCpmSettings["traffic_sensitivity"]) {
  if (value === "low") return 0.75;
  if (value === "high") return 1.25;
  return 1;
}

export async function calculateMiniAppPublisherPayout(input: MiniAppPublisherCpmInput) {
  const settings = await getMiniAppPublisherCpmSettings(input.conn);
  assertMiniAppRevenueSplit(settings);

  const advertiserCpm = Math.max(0, input.advertiserCpm);
  const grossRevenue = advertiserCpm / 1000;
  const publisherCeilingCpm = maxPublisherCpm(advertiserCpm, settings);
  const mode = normalizeMiniAppCpmMode(input.cpmMode);

  const [[snapshot]] = await input.conn.query<QualitySnapshotRow[]>(`
    SELECT
      COUNT(*) as total_impressions,
      COUNT(DISTINCT telegram_user_id) as unique_users,
      SUM(CASE WHEN telegram_user_id = ? THEN 1 ELSE 0 END) as repeat_count
    FROM miniapp_internal_ad_impressions
    WHERE campaign_id = ?
      AND miniapp_id = ?
      AND created_at >= CURDATE()
  `, [input.telegramUserId || "", input.campaignId, input.miniappId]);

  const totalImpressions = Number(snapshot?.total_impressions || 0);
  const uniqueUsers = Number(snapshot?.unique_users || 0);
  const repeatCount = Number(snapshot?.repeat_count || 0) + 1;
  const diversityScore = totalImpressions > 0 ? clamp(uniqueUsers / totalImpressions, 0, 1) : 0.75;
  const countryScore = input.country ? 0.85 : 0.7;
  const repetitionScore = repeatPenaltyFactor(repeatCount);
  const engagementScore = 0.75;
  const rawQualityScore = clamp(((countryScore + diversityScore + repetitionScore + engagementScore) / 4) * sensitivityWeight(settings.traffic_sensitivity), 0, 1);
  const qualityFactor = clamp(
    settings.min_quality_factor + rawQualityScore * (settings.max_quality_factor - settings.min_quality_factor),
    settings.min_quality_factor,
    settings.max_quality_factor
  );
  const repeatPenalty = settings.repeat_penalty_enabled ? repetitionScore : 1;

  const fixedPublisherCpm = Math.max(0, Number(input.fixedPublisherCpm || 0));
  const livePublisherCpm = publisherCeilingCpm * qualityFactor * repeatPenalty;
  const requestedPublisherCpm = mode === "fixed" ? fixedPublisherCpm : livePublisherCpm;
  const publisherCpm = Math.min(requestedPublisherCpm, publisherCeilingCpm);
  const publisherRevenue = publisherCpm / 1000;
  const reserveRevenue = settings.reserve_pool_enabled ? grossRevenue * (settings.reserve_percent / 100) : 0;
  const adsGalaxyRevenue = Math.max(0, grossRevenue - publisherRevenue - reserveRevenue);

  return {
    settings,
    cpm_mode: mode,
    advertiser_cpm: advertiserCpm,
    gross_revenue: grossRevenue,
    publisher_cpm: publisherCpm,
    publisher_revenue: publisherRevenue,
    ads_galaxy_revenue: adsGalaxyRevenue,
    reserve_revenue: reserveRevenue,
    publisher_ceiling_cpm: publisherCeilingCpm,
    quality_factor: mode === "fixed" ? null : qualityFactor,
    repeat_penalty_factor: mode === "fixed" ? null : repeatPenalty,
    quality_metadata: {
      total_impressions_today: totalImpressions,
      unique_users_today: uniqueUsers,
      repeat_count_today: repeatCount,
      country_score: countryScore,
      diversity_score: diversityScore,
      repetition_score: repetitionScore,
      engagement_score: engagementScore,
      traffic_sensitivity: settings.traffic_sensitivity,
      reserve_pool_enabled: settings.reserve_pool_enabled,
      repeat_penalty_enabled: settings.repeat_penalty_enabled,
      publisher_share_percent: settings.publisher_share_percent,
      ads_galaxy_share_percent: settings.ads_galaxy_share_percent,
      reserve_percent: settings.reserve_percent,
    },
  };
}
