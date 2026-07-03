import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export const PUBLISHER_QUALITY_WEIGHTS = {
  trust: 0.4,
  ctr: 0.25,
  viewAuthenticity: 0.15,
  historicalConsistency: 0.1,
  audienceRetention: 0.1,
} as const;

export type PublisherQualityMetrics = {
  channelId: number;
  trustScore: number;
  ctrScore: number;
  viewAuthenticityScore: number;
  historicalConsistencyScore: number;
  audienceRetentionScore: number;
  qualityScore: number;
  qualityWeight: number;
  sampleViews: number;
  sampleClicks: number;
  observedCtr: number;
  reachRatio: number;
};

type QualitySourceRow = RowDataPacket & {
  publisher_risk_score: number | string | null;
  is_banned: number | string | null;
  user_status: string | null;
  traffic_quality_score: number | string | null;
  channel_trust_score: number | string | null;
  subscriber_count: number | string | null;
  views: number | string | null;
  clicks: number | string | null;
  average_daily_views: number | string | null;
  daily_view_stddev: number | string | null;
  active_days: number | string | null;
  post_count: number | string | null;
  audits: number | string | null;
  invalid_audits: number | string | null;
};

function value(input: unknown) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(input: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, input));
}

function rounded(input: number, digits = 4) {
  return Number(input.toFixed(digits));
}

function normalizedCtrScore(clicks: number, views: number) {
  if (views <= 0) return 50;
  const ctrPercent = (clicks / views) * 100;
  let score: number;
  if (ctrPercent <= 5) score = 35 + (ctrPercent / 5) * 65;
  else if (ctrPercent <= 10) score = 100 - ((ctrPercent - 5) / 5) * 20;
  else score = 80 - Math.min(70, ((ctrPercent - 10) / 20) * 70);
  const sampleConfidence = clamp(views / 500, 0, 1);
  return rounded(50 + (clamp(score) - 50) * sampleConfidence);
}

function consistencyScore(averageDailyViews: number, standardDeviation: number, activeDays: number) {
  if (averageDailyViews <= 0) return 50;
  const coefficientOfVariation = standardDeviation / averageDailyViews;
  const stability = clamp(100 - Math.min(2, coefficientOfVariation) * 45);
  const coverage = clamp((activeDays / 30) * 100);
  return rounded(stability * 0.7 + coverage * 0.3);
}

function retentionScore(views: number, posts: number, subscribers: number) {
  if (views <= 0 || posts <= 0 || subscribers <= 0) return 50;
  const reachRatio = (views / posts) / subscribers;
  if (reachRatio <= 0.05) return rounded(clamp((reachRatio / 0.05) * 60));
  if (reachRatio <= 0.6) return rounded(60 + ((reachRatio - 0.05) / 0.55) * 40);
  if (reachRatio <= 1.2) return rounded(100 - ((reachRatio - 0.6) / 0.6) * 20);
  return rounded(clamp(80 - (reachRatio - 1.2) * 50, 20, 80));
}

export function calculatePublisherQuality(input: {
  channelId: number;
  publisherRiskScore: number;
  isBanned: boolean;
  trafficQualityScore: number;
  subscribers: number;
  views: number;
  clicks: number;
  averageDailyViews: number;
  dailyViewStddev: number;
  activeDays: number;
  posts: number;
  audits: number;
  invalidAudits: number;
  channelTrustScore?: number;
}): PublisherQualityMetrics {
  const invalidAuditRatio = input.audits > 0 ? clamp(input.invalidAudits / input.audits, 0, 1) : 0;
  const riskBasedTrust = clamp(100 - input.publisherRiskScore - invalidAuditRatio * 50);
  const channelFraudTrust = clamp(((clamp(input.channelTrustScore ?? 60, -100, 100) + 100) / 2));
  const trustScore = input.isBanned ? 0 : Math.min(riskBasedTrust, channelFraudTrust);
  const ctrScore = normalizedCtrScore(input.clicks, input.views);
  const viewAuthenticityScore = input.audits > 0
    ? clamp(100 - (input.invalidAudits / input.audits) * 100)
    : clamp(input.trafficQualityScore || 60);
  const historicalConsistencyScore = consistencyScore(input.averageDailyViews, input.dailyViewStddev, input.activeDays);
  const audienceRetentionScore = retentionScore(input.views, input.posts, input.subscribers);
  const weightedScore =
    trustScore * PUBLISHER_QUALITY_WEIGHTS.trust
    + ctrScore * PUBLISHER_QUALITY_WEIGHTS.ctr
    + viewAuthenticityScore * PUBLISHER_QUALITY_WEIGHTS.viewAuthenticity
    + historicalConsistencyScore * PUBLISHER_QUALITY_WEIGHTS.historicalConsistency
    + audienceRetentionScore * PUBLISHER_QUALITY_WEIGHTS.audienceRetention;
  const qualityScore = rounded(clamp(weightedScore));
  return {
    channelId: input.channelId,
    trustScore: rounded(trustScore),
    ctrScore,
    viewAuthenticityScore: rounded(viewAuthenticityScore),
    historicalConsistencyScore,
    audienceRetentionScore,
    qualityScore,
    qualityWeight: rounded(clamp(qualityScore / 100, 0, 1), 8),
    sampleViews: input.views,
    sampleClicks: input.clicks,
    observedCtr: input.views > 0 ? rounded((input.clicks / input.views) * 100, 6) : 0,
    reachRatio: input.posts > 0 && input.subscribers > 0 ? rounded((input.views / input.posts) / input.subscribers, 8) : 0,
  };
}

export async function getPublisherQuality(channelId: number, connection?: PoolConnection) {
  const db = connection || pool;
  const [rows] = await db.query<QualitySourceRow[]>(
    `SELECT u.publisher_risk_score, u.is_banned, u.status AS user_status,
       ch.traffic_quality_score, ch.publisher_trust_score AS channel_trust_score, ch.subscriber_count,
       COALESCE(ds.views, 0) AS views, COALESCE(ds.clicks, 0) AS clicks,
       COALESCE(ds.average_daily_views, 0) AS average_daily_views,
       COALESCE(ds.daily_view_stddev, 0) AS daily_view_stddev,
       COALESCE(ds.active_days, 0) AS active_days,
       COALESCE(ps.post_count, 0) AS post_count,
       COALESCE(a.audits, 0) AS audits, COALESCE(a.invalid_audits, 0) AS invalid_audits
     FROM channels ch
     JOIN users u ON u.id = ch.user_id
     LEFT JOIN (
       SELECT channel_id, SUM(views) AS views, SUM(clicks) AS clicks, AVG(views) AS average_daily_views,
         STDDEV_POP(views) AS daily_view_stddev, SUM(views > 0 OR clicks > 0) AS active_days
       FROM channel_daily_stats WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY channel_id
     ) ds ON ds.channel_id = ch.id
     LEFT JOIN (
       SELECT channel_id, COUNT(DISTINCT post_id) AS post_count
       FROM channel_post_daily_stats WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY channel_id
     ) ps ON ps.channel_id = ch.id
     LEFT JOIN (
       SELECT cp.channel_id, COUNT(cva.id) AS audits,
         SUM(CASE WHEN cva.status = 'invalid' THEN 1 ELSE 0 END) AS invalid_audits
       FROM campaign_posts cp JOIN campaign_views_audit cva ON cva.post_id = cp.id
       WHERE cp.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY cp.channel_id
     ) a ON a.channel_id = ch.id
     WHERE ch.id = ? LIMIT 1`,
    [channelId]
  );
  const row = rows[0];
  if (!row) throw new Error("publisher_quality_channel_not_found");
  const metrics = calculatePublisherQuality({
    channelId,
    publisherRiskScore: value(row.publisher_risk_score),
    isBanned: value(row.is_banned) === 1 || String(row.user_status || "").toLowerCase() === "banned",
    trafficQualityScore: value(row.traffic_quality_score),
    subscribers: value(row.subscriber_count),
    views: value(row.views),
    clicks: value(row.clicks),
    averageDailyViews: value(row.average_daily_views),
    dailyViewStddev: value(row.daily_view_stddev),
    activeDays: value(row.active_days),
    posts: value(row.post_count),
    audits: value(row.audits),
    invalidAudits: value(row.invalid_audits),
    channelTrustScore: value(row.channel_trust_score),
  });

  await db.query(
    `INSERT INTO channel_publisher_quality_snapshots
       (stat_date, channel_id, trust_score, ctr_score, view_authenticity_score,
        historical_consistency_score, audience_retention_score, quality_score, quality_weight,
        sample_views, sample_clicks, metadata)
     VALUES (CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE trust_score=VALUES(trust_score), ctr_score=VALUES(ctr_score),
       view_authenticity_score=VALUES(view_authenticity_score), historical_consistency_score=VALUES(historical_consistency_score),
       audience_retention_score=VALUES(audience_retention_score), quality_score=VALUES(quality_score),
       quality_weight=VALUES(quality_weight), sample_views=VALUES(sample_views), sample_clicks=VALUES(sample_clicks),
       metadata=VALUES(metadata), updated_at=CURRENT_TIMESTAMP`,
    [channelId, metrics.trustScore, metrics.ctrScore, metrics.viewAuthenticityScore,
      metrics.historicalConsistencyScore, metrics.audienceRetentionScore, metrics.qualityScore,
      metrics.qualityWeight, metrics.sampleViews, metrics.sampleClicks,
      JSON.stringify({ observed_ctr: metrics.observedCtr, reach_ratio: metrics.reachRatio, weights: PUBLISHER_QUALITY_WEIGHTS })]
  );
  await db.query(
    "UPDATE channels SET publisher_quality_index=?, publisher_quality_weight=?, publisher_quality_updated_at=NOW() WHERE id=?",
    [metrics.qualityScore, metrics.qualityWeight, channelId]
  );
  return metrics;
}
