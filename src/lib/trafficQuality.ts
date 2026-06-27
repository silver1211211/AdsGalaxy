import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getInternalAdCompletionAnalytics } from "@/lib/internalAdCompletionQuality";

export type TrafficEntityType = "platform" | "miniapp" | "channel" | "bot";
export type RiskLevel = "low" | "medium" | "high" | "critical";

type SettingRow = RowDataPacket & {
  key: string;
  value: string;
};

export type TrafficQualityMetrics = {
  entity_type: TrafficEntityType;
  entity_id: number;
  quality_score: number;
  quality_tier: string;
  risk_level: RiskLevel;
  impressions: number;
  unique_users: number;
  repeat_user_ratio: number;
  repeat_impression_ratio: number;
  top_user_impression_ratio: number;
  velocity_score: number;
  country_breakdown: Record<string, number>;
  device_breakdown: Record<string, number>;
  language_breakdown: Record<string, number>;
  session_breakdown: Record<string, number>;
  signal_metadata: Record<string, unknown>;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function qualityTier(score: number) {
  if (score >= 90) return "excellent";
  if (score >= 75) return "very_good";
  if (score >= 60) return "good";
  if (score >= 40) return "average";
  if (score >= 20) return "poor";
  return "critical";
}

export function riskLevel(score: number): RiskLevel {
  if (score <= 19) return "critical";
  if (score <= 39) return "high";
  if (score <= 59) return "medium";
  return "low";
}

export function publicQualityRating(score: unknown) {
  const normalized = Number(score) || 60;
  if (normalized >= 90) return "Excellent";
  if (normalized >= 75) return "Very Good";
  if (normalized >= 60) return "Good";
  return "Average";
}

async function getTrafficSettings(conn?: PoolConnection) {
  const db = conn || pool;
  const [rows] = await db.query<SettingRow[]>(
    "SELECT `key`, value FROM settings WHERE `key` IN ('traffic_quality_sensitivity', 'traffic_quality_review_threshold')"
  );
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const sensitivity = String(map.get("traffic_quality_sensitivity") || "medium").toLowerCase();
  return {
    sensitivity: sensitivity === "low" || sensitivity === "high" ? sensitivity : "medium",
    review_threshold: toNumber(map.get("traffic_quality_review_threshold") || 39),
  };
}

function sensitivityWeight(value: string) {
  if (value === "low") return 0.75;
  if (value === "high") return 1.25;
  return 1;
}

function scoreFromSignals(input: {
  impressions: number;
  uniqueUsers: number;
  topUserRatio: number;
  invalidRatio?: number;
  velocityScore: number;
  sensitivity: string;
  signalCoverage: number;
  completionRate?: number;
  averageWatchDuration?: number;
  fraudSignalCount?: number;
}) {
  if (input.impressions <= 0) return 60;

  const diversity = input.impressions > 0 ? clamp(input.uniqueUsers / input.impressions, 0, 1) : 0;
  const repeatPenalty = clamp(input.topUserRatio * 55 * sensitivityWeight(input.sensitivity), 0, 45);
  const invalidPenalty = clamp((input.invalidRatio || 0) * 60 * sensitivityWeight(input.sensitivity), 0, 45);
  const diversityScore = diversity * 55;
  const velocityScore = clamp(input.velocityScore, 0, 100) * 0.25;
  const coverageBonus = clamp(input.signalCoverage, 0, 1) * 20;
  const completionPenalty = input.completionRate === undefined
    ? 0
    : input.completionRate < 0.3
      ? 22
      : input.completionRate < 0.6
        ? 12
        : input.completionRate < 0.85
          ? 5
          : 0;
  const watchPenalty = input.averageWatchDuration === undefined || input.averageWatchDuration >= 8 ? 0 : input.averageWatchDuration < 3 ? 14 : 7;
  const fraudSignalPenalty = clamp((input.fraudSignalCount || 0) * 4 * sensitivityWeight(input.sensitivity), 0, 35);
  return Math.round(clamp(20 + diversityScore + velocityScore + coverageBonus - repeatPenalty - invalidPenalty - completionPenalty - watchPenalty - fraudSignalPenalty, 0, 100));
}

function normalizeBreakdown(rows: Array<Record<string, unknown>>, keyField: string, valueField: string) {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[keyField] || "unknown").toUpperCase();
    result[key] = toNumber(row[valueField]);
  }
  return result;
}

async function calculateVelocity(conn: PoolConnection | typeof pool, entityType: TrafficEntityType, entityId: number) {
  if (entityType === "miniapp") {
    const [rows]: any = await conn.query(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 1 ELSE 0 END), 0) as recent,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 ELSE 0 END), 0) as hourly
      FROM miniapp_mediation_requests
      WHERE miniapp_id = ?
    `, [entityId]);
    const recent = toNumber(rows[0]?.recent);
    const hourly = Math.max(toNumber(rows[0]?.hourly), recent, 1);
    const spikeRatio = recent / hourly;
    return Math.round(clamp(100 - Math.max(0, spikeRatio - 0.35) * 160, 0, 100));
  }

  if (entityType === "bot") {
    const [rows]: any = await conn.query(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 1 ELSE 0 END), 0) as recent,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 ELSE 0 END), 0) as hourly
      FROM broadcast_deliveries
      WHERE bot_id = ?
    `, [entityId]);
    const recent = toNumber(rows[0]?.recent);
    const hourly = Math.max(toNumber(rows[0]?.hourly), recent, 1);
    return Math.round(clamp(100 - Math.max(0, recent / hourly - 0.35) * 160, 0, 100));
  }

  return 85;
}

export async function calculateTrafficQuality(entityType: TrafficEntityType, entityId = 0, conn?: PoolConnection): Promise<TrafficQualityMetrics> {
  const db = conn || pool;
  const settings = await getTrafficSettings(conn);

  if (entityType === "miniapp") {
    const [[summary]]: any = await db.query(`
      SELECT COUNT(*) as impressions, COUNT(DISTINCT telegram_user_id) as unique_users
      FROM miniapp_mediation_requests
      WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `, [entityId]);
    const [[topUser]]: any = await db.query(`
      SELECT COUNT(*) as impressions
      FROM miniapp_mediation_requests
      WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY telegram_user_id
      ORDER BY impressions DESC
      LIMIT 1
    `, [entityId]);
    const [countries]: any = await db.query(`
      SELECT COALESCE(country, 'unknown') as country, COUNT(*) as impressions
      FROM miniapp_mediation_requests
      WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY COALESCE(country, 'unknown')
      ORDER BY impressions DESC
      LIMIT 10
    `, [entityId]);
    const impressions = toNumber(summary?.impressions);
    const uniqueUsers = toNumber(summary?.unique_users);
    const topUserRatio = impressions > 0 ? toNumber(topUser?.impressions) / impressions : 0;
    const velocityScore = await calculateVelocity(db, "miniapp", entityId);
    const completionAnalytics = await getInternalAdCompletionAnalytics({ conn: db, miniappId: entityId });
    const qualityScore = scoreFromSignals({
      impressions,
      uniqueUsers,
      topUserRatio,
      velocityScore,
      sensitivity: settings.sensitivity,
      signalCoverage: 0.85,
      completionRate: completionAnalytics.triggered_ads > 0 ? completionAnalytics.completion_rate : undefined,
      averageWatchDuration: completionAnalytics.triggered_ads > 0 ? completionAnalytics.average_watch_duration : undefined,
      fraudSignalCount: completionAnalytics.fraud_signal_count,
    });
    return {
      entity_type: entityType,
      entity_id: entityId,
      quality_score: qualityScore,
      quality_tier: qualityTier(qualityScore),
      risk_level: riskLevel(qualityScore),
      impressions,
      unique_users: uniqueUsers,
      repeat_user_ratio: impressions > 0 ? 1 - (uniqueUsers / impressions) : 0,
      repeat_impression_ratio: topUserRatio,
      top_user_impression_ratio: topUserRatio,
      velocity_score: velocityScore,
      country_breakdown: normalizeBreakdown(countries, "country", "impressions"),
      device_breakdown: {},
      language_breakdown: {},
      session_breakdown: {},
      signal_metadata: {
        device_detection: "unavailable",
        language_detection: "unavailable",
        vpn_detection: "unavailable",
        completion_rate: completionAnalytics.completion_rate,
        average_watch_duration: completionAnalytics.average_watch_duration,
        incomplete_rate: completionAnalytics.incomplete_rate,
        abandonment_rate: completionAnalytics.abandonment_rate,
        fraud_signal_count: completionAnalytics.fraud_signal_count,
      },
    };
  }

  if (entityType === "bot") {
    const [[summary]]: any = await db.query(`
      SELECT COUNT(*) as impressions, COUNT(DISTINCT user_id) as unique_users
      FROM broadcast_deliveries
      WHERE bot_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `, [entityId]);
    const [[topUser]]: any = await db.query(`
      SELECT COUNT(*) as impressions
      FROM broadcast_deliveries
      WHERE bot_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY user_id
      ORDER BY impressions DESC
      LIMIT 1
    `, [entityId]);
    const impressions = toNumber(summary?.impressions);
    const uniqueUsers = toNumber(summary?.unique_users);
    const topUserRatio = impressions > 0 ? toNumber(topUser?.impressions) / impressions : 0;
    const velocityScore = await calculateVelocity(db, "bot", entityId);
    const qualityScore = scoreFromSignals({ impressions, uniqueUsers, topUserRatio, velocityScore, sensitivity: settings.sensitivity, signalCoverage: 0.55 });
    return {
      entity_type: entityType,
      entity_id: entityId,
      quality_score: qualityScore,
      quality_tier: qualityTier(qualityScore),
      risk_level: riskLevel(qualityScore),
      impressions,
      unique_users: uniqueUsers,
      repeat_user_ratio: impressions > 0 ? 1 - (uniqueUsers / impressions) : 0,
      repeat_impression_ratio: topUserRatio,
      top_user_impression_ratio: topUserRatio,
      velocity_score: velocityScore,
      country_breakdown: {},
      device_breakdown: {},
      language_breakdown: {},
      session_breakdown: {},
      signal_metadata: { country_detection: "unavailable", device_detection: "unavailable", language_detection: "unavailable", vpn_detection: "unavailable" },
    };
  }

  if (entityType === "channel") {
    const [[summary]]: any = await db.query(`
      SELECT
        COALESCE(SUM(cp.views), 0) as impressions,
        COUNT(DISTINCT cp.id) as posts,
        COALESCE(SUM(CASE WHEN cva.status = 'invalid' THEN 1 ELSE 0 END), 0) as invalid_audits,
        COUNT(cva.id) as audits
      FROM campaign_posts cp
      LEFT JOIN campaign_views_audit cva ON cva.post_id = cp.id
      WHERE cp.channel_id = ? AND cp.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `, [entityId]);
    const impressions = toNumber(summary?.impressions);
    const invalidRatio = toNumber(summary?.audits) > 0 ? toNumber(summary?.invalid_audits) / toNumber(summary?.audits) : 0;
    const pseudoUnique = Math.min(impressions, toNumber(summary?.posts) * 100);
    const qualityScore = scoreFromSignals({ impressions, uniqueUsers: pseudoUnique, topUserRatio: 0, invalidRatio, velocityScore: 85, sensitivity: settings.sensitivity, signalCoverage: 0.35 });
    return {
      entity_type: entityType,
      entity_id: entityId,
      quality_score: qualityScore,
      quality_tier: qualityTier(qualityScore),
      risk_level: riskLevel(qualityScore),
      impressions,
      unique_users: pseudoUnique,
      repeat_user_ratio: 0,
      repeat_impression_ratio: invalidRatio,
      top_user_impression_ratio: 0,
      velocity_score: 85,
      country_breakdown: {},
      device_breakdown: {},
      language_breakdown: {},
      session_breakdown: {},
      signal_metadata: { per_user_channel_views: "unavailable", invalid_view_audit_ratio: invalidRatio },
    };
  }

  const [rows]: any = await db.query(`
    SELECT
      COALESCE(SUM(impressions), 0) as impressions,
      COALESCE(SUM(unique_users), 0) as unique_users,
      AVG(quality_score) as avg_score,
      MAX(top_user_impression_ratio) as top_user_impression_ratio
    FROM traffic_quality_daily_scores
    WHERE entity_type IN ('miniapp', 'channel', 'bot') AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  `);
  const impressions = toNumber(rows[0]?.impressions);
  const uniqueUsers = toNumber(rows[0]?.unique_users);
  const score = rows[0]?.avg_score === null ? 60 : Math.round(clamp(toNumber(rows[0]?.avg_score), 0, 100));
  return {
    entity_type: "platform",
    entity_id: 0,
    quality_score: score,
    quality_tier: qualityTier(score),
    risk_level: riskLevel(score),
    impressions,
    unique_users: uniqueUsers,
    repeat_user_ratio: impressions > 0 ? 1 - (uniqueUsers / impressions) : 0,
    repeat_impression_ratio: toNumber(rows[0]?.top_user_impression_ratio),
    top_user_impression_ratio: toNumber(rows[0]?.top_user_impression_ratio),
    velocity_score: 85,
    country_breakdown: {},
    device_breakdown: {},
    language_breakdown: {},
    session_breakdown: {},
    signal_metadata: { source: "daily_entity_snapshots" },
  };
}

export async function persistTrafficQuality(metrics: TrafficQualityMetrics, conn?: PoolConnection) {
  const db = conn || pool;
  await db.query(`
    INSERT INTO traffic_quality_daily_scores
      (
        entity_type, entity_id, date, quality_score, quality_tier, risk_level,
        impressions, unique_users, repeat_user_ratio, repeat_impression_ratio,
        top_user_impression_ratio, velocity_score, country_breakdown,
        device_breakdown, language_breakdown, session_breakdown, signal_metadata
      )
    VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      quality_score = VALUES(quality_score),
      quality_tier = VALUES(quality_tier),
      risk_level = VALUES(risk_level),
      impressions = VALUES(impressions),
      unique_users = VALUES(unique_users),
      repeat_user_ratio = VALUES(repeat_user_ratio),
      repeat_impression_ratio = VALUES(repeat_impression_ratio),
      top_user_impression_ratio = VALUES(top_user_impression_ratio),
      velocity_score = VALUES(velocity_score),
      country_breakdown = VALUES(country_breakdown),
      device_breakdown = VALUES(device_breakdown),
      language_breakdown = VALUES(language_breakdown),
      session_breakdown = VALUES(session_breakdown),
      signal_metadata = VALUES(signal_metadata)
  `, [
    metrics.entity_type,
    metrics.entity_id,
    metrics.quality_score,
    metrics.quality_tier,
    metrics.risk_level,
    metrics.impressions,
    metrics.unique_users,
    metrics.repeat_user_ratio,
    metrics.repeat_impression_ratio,
    metrics.top_user_impression_ratio,
    metrics.velocity_score,
    JSON.stringify(metrics.country_breakdown),
    JSON.stringify(metrics.device_breakdown),
    JSON.stringify(metrics.language_breakdown),
    JSON.stringify(metrics.session_breakdown),
    JSON.stringify(metrics.signal_metadata),
  ]);

  if (metrics.entity_type === "miniapp") {
    await db.query(
      "UPDATE miniapps SET traffic_quality_score = ?, traffic_quality_tier = ?, traffic_risk_level = ?, traffic_quality_updated_at = NOW() WHERE id = ?",
      [metrics.quality_score, metrics.quality_tier, metrics.risk_level, metrics.entity_id]
    );
  } else if (metrics.entity_type === "channel") {
    await db.query(
      "UPDATE channels SET traffic_quality_score = ?, traffic_quality_tier = ?, traffic_risk_level = ?, traffic_quality_updated_at = NOW() WHERE id = ?",
      [metrics.quality_score, metrics.quality_tier, metrics.risk_level, metrics.entity_id]
    );
  } else if (metrics.entity_type === "bot") {
    await db.query(
      "UPDATE bots SET traffic_quality_score = ?, traffic_quality_tier = ?, traffic_risk_level = ?, traffic_quality_updated_at = NOW() WHERE id = ?",
      [metrics.quality_score, metrics.quality_tier, metrics.risk_level, metrics.entity_id]
    );
  }
}

export async function maybeQueueTrafficReview(metrics: TrafficQualityMetrics, reason?: string, conn?: PoolConnection) {
  const settings = await getTrafficSettings(conn);
  if (metrics.quality_score > settings.review_threshold && metrics.risk_level !== "high" && metrics.risk_level !== "critical") return;
  const db = conn || pool;
  await db.query(`
    INSERT INTO traffic_review_queue
      (entity_type, entity_id, risk_level, quality_score, reason, status, metadata)
    SELECT ?, ?, ?, ?, ?, 'open', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM traffic_review_queue
      WHERE entity_type = ? AND entity_id = ? AND status IN ('open', 'monitor')
    )
  `, [
    metrics.entity_type,
    metrics.entity_id,
    metrics.risk_level,
    metrics.quality_score,
    reason || "Traffic quality requires review",
    JSON.stringify(metrics),
    metrics.entity_type,
    metrics.entity_id,
  ]);
}
