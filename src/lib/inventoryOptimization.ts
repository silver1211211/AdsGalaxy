import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { botUserBlockedCondition, botUserVerifiedReachableCondition } from "@/lib/botAudience";
import { publicQualityRating, riskLevel } from "@/lib/trafficQuality";
import { getInternalAdCompletionAnalytics } from "@/lib/internalAdCompletionQuality";

export type InventoryEntityType = "miniapp" | "channel" | "bot";
export type InventoryRank = "starter" | "basic" | "standard" | "advanced" | "elite";
export type DeliveryMode = "balanced" | "performance" | "growth" | "manual";
export type InventoryOverride = "none" | "boost" | "reduce" | "pause" | "whitelist" | "blacklist";

type SettingRow = RowDataPacket & {
  key: string;
  value: string;
};

export type InventoryMetrics = {
  entity_type: InventoryEntityType;
  entity_id: number;
  inventory_score: number;
  inventory_rank: InventoryRank;
  traffic_quality_score: number;
  fraud_risk_level: string;
  fill_rate: number;
  delivery_consistency: number;
  revenue_7d: number;
  impressions_7d: number;
  ctr: number | null;
  metadata: Record<string, unknown>;
};

export type DeliverySettings = {
  mode: DeliveryMode;
  exploration_allocation_percent: number;
  elite_inventory_boost: number;
  manual_quality_weight: number;
  manual_revenue_weight: number;
  manual_consistency_weight: number;
  manual_exploration_weight: number;
  manual_override_weight: number;
  attention_threshold: number;
};

const DEFAULT_SETTINGS: DeliverySettings = {
  mode: "balanced",
  exploration_allocation_percent: 10,
  elite_inventory_boost: 1.2,
  manual_quality_weight: 0.35,
  manual_revenue_weight: 0.2,
  manual_consistency_weight: 0.15,
  manual_exploration_weight: 0.1,
  manual_override_weight: 0.2,
  attention_threshold: 40,
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeMode(value: unknown): DeliveryMode {
  const mode = String(value || DEFAULT_SETTINGS.mode).toLowerCase();
  if (mode === "performance" || mode === "growth" || mode === "manual") return mode;
  return "balanced";
}

export function inventoryRank(score: number): InventoryRank {
  if (score >= 81) return "elite";
  if (score >= 61) return "advanced";
  if (score >= 41) return "standard";
  if (score >= 21) return "basic";
  return "starter";
}

export function publicInventoryQuality(score: unknown) {
  return publicQualityRating(score);
}

export async function getDeliveryOptimizationSettings(conn?: PoolConnection): Promise<DeliverySettings> {
  const db = conn || pool;
  const [rows] = await db.query<SettingRow[]>(`
    SELECT \`key\`, value
    FROM settings
    WHERE \`key\` IN (
      'delivery_optimization_mode',
      'delivery_exploration_allocation_percent',
      'delivery_elite_inventory_boost',
      'delivery_manual_quality_weight',
      'delivery_manual_revenue_weight',
      'delivery_manual_consistency_weight',
      'delivery_manual_exploration_weight',
      'delivery_manual_override_weight',
      'inventory_attention_threshold'
    )
  `);
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    mode: normalizeMode(map.get("delivery_optimization_mode")),
    exploration_allocation_percent: clamp(toNumber(map.get("delivery_exploration_allocation_percent") || DEFAULT_SETTINGS.exploration_allocation_percent), 0, 50),
    elite_inventory_boost: clamp(toNumber(map.get("delivery_elite_inventory_boost") || DEFAULT_SETTINGS.elite_inventory_boost), 1, 3),
    manual_quality_weight: clamp(toNumber(map.get("delivery_manual_quality_weight") || DEFAULT_SETTINGS.manual_quality_weight), 0, 1),
    manual_revenue_weight: clamp(toNumber(map.get("delivery_manual_revenue_weight") || DEFAULT_SETTINGS.manual_revenue_weight), 0, 1),
    manual_consistency_weight: clamp(toNumber(map.get("delivery_manual_consistency_weight") || DEFAULT_SETTINGS.manual_consistency_weight), 0, 1),
    manual_exploration_weight: clamp(toNumber(map.get("delivery_manual_exploration_weight") || DEFAULT_SETTINGS.manual_exploration_weight), 0, 1),
    manual_override_weight: clamp(toNumber(map.get("delivery_manual_override_weight") || DEFAULT_SETTINGS.manual_override_weight), 0, 1),
    attention_threshold: clamp(toNumber(map.get("inventory_attention_threshold") || DEFAULT_SETTINGS.attention_threshold), 0, 100),
  };
}

function overrideMultiplier(override: unknown, multiplier: unknown) {
  const type = String(override || "none") as InventoryOverride;
  if (type === "blacklist" || type === "pause") return 0;
  if (type === "whitelist") return 2;
  if (type === "boost") return clamp(toNumber(multiplier) || 1.25, 1, 3);
  if (type === "reduce") return clamp(toNumber(multiplier) || 0.75, 0.05, 1);
  return clamp(toNumber(multiplier) || 1, 0.05, 3);
}

function isNewInventory(row: Record<string, unknown>) {
  const createdAt = row.created_at ? new Date(String(row.created_at)).getTime() : 0;
  if (!createdAt) return false;
  return Date.now() - createdAt <= 30 * 24 * 60 * 60 * 1000;
}

function scoreInventory(input: {
  trafficQuality: number;
  risk: string;
  approvalScore: number;
  reputationScore: number;
  consistency: number;
  advertiserSatisfaction: number;
  ctr: number | null;
  fillRate: number;
  impressionQuality: number;
  revenueScore: number;
  override: InventoryOverride;
  priorityMultiplier: number;
}) {
  const riskPenalty = input.risk === "critical" ? 35 : input.risk === "high" ? 22 : input.risk === "medium" ? 10 : 0;
  const ctrScore = input.ctr === null ? 50 : clamp(input.ctr * 1000, 0, 100);
  const base =
    input.trafficQuality * 0.28 +
    input.approvalScore * 0.08 +
    input.reputationScore * 0.10 +
    input.consistency * 0.14 +
    input.advertiserSatisfaction * 0.10 +
    ctrScore * 0.08 +
    input.fillRate * 0.10 +
    input.impressionQuality * 0.08 +
    input.revenueScore * 0.04 -
    riskPenalty;

  return Math.round(clamp(base * overrideMultiplier(input.override, input.priorityMultiplier), 0, 100));
}

async function updateEntity(metrics: InventoryMetrics, conn?: PoolConnection) {
  const db = conn || pool;
  const table = metrics.entity_type === "miniapp" ? "miniapps" : metrics.entity_type === "channel" ? "channels" : "bots";
  await db.query(
    `UPDATE ${table} SET inventory_score = ?, inventory_rank = ?, inventory_updated_at = NOW() WHERE id = ?`,
    [metrics.inventory_score, metrics.inventory_rank, metrics.entity_id]
  );
}

export async function persistInventoryMetrics(metrics: InventoryMetrics, conn?: PoolConnection) {
  const db = conn || pool;
  await db.query(`
    INSERT INTO inventory_quality_daily_scores
      (
        entity_type, entity_id, date, inventory_score, inventory_rank,
        traffic_quality_score, fraud_risk_level, fill_rate, delivery_consistency,
        revenue_7d, impressions_7d, ctr, metadata
      )
    VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      inventory_score = VALUES(inventory_score),
      inventory_rank = VALUES(inventory_rank),
      traffic_quality_score = VALUES(traffic_quality_score),
      fraud_risk_level = VALUES(fraud_risk_level),
      fill_rate = VALUES(fill_rate),
      delivery_consistency = VALUES(delivery_consistency),
      revenue_7d = VALUES(revenue_7d),
      impressions_7d = VALUES(impressions_7d),
      ctr = VALUES(ctr),
      metadata = VALUES(metadata)
  `, [
    metrics.entity_type,
    metrics.entity_id,
    metrics.inventory_score,
    metrics.inventory_rank,
    metrics.traffic_quality_score,
    metrics.fraud_risk_level,
    metrics.fill_rate,
    metrics.delivery_consistency,
    metrics.revenue_7d,
    metrics.impressions_7d,
    metrics.ctr,
    JSON.stringify(metrics.metadata),
  ]);
  await updateEntity(metrics, conn);
}

export async function maybeQueueInventoryAttention(metrics: InventoryMetrics, conn?: PoolConnection) {
  const settings = await getDeliveryOptimizationSettings(conn);
  if (metrics.inventory_score > settings.attention_threshold && metrics.fraud_risk_level !== "high" && metrics.fraud_risk_level !== "critical") return;
  const db = conn || pool;
  const reason = metrics.fraud_risk_level === "critical" || metrics.fraud_risk_level === "high"
    ? "High fraud risk affecting delivery quality"
    : "Inventory score below attention threshold";

  await db.query(`
    INSERT INTO inventory_attention_queue
      (entity_type, entity_id, inventory_score, inventory_rank, reason, status, metadata)
    SELECT ?, ?, ?, ?, ?, 'open', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM inventory_attention_queue
      WHERE entity_type = ? AND entity_id = ? AND status IN ('open', 'monitor')
    )
  `, [
    metrics.entity_type,
    metrics.entity_id,
    metrics.inventory_score,
    metrics.inventory_rank,
    reason,
    JSON.stringify(metrics),
    metrics.entity_type,
    metrics.entity_id,
  ]);
}

export async function calculateInventoryMetrics(entityType: InventoryEntityType, entityId: number, conn?: PoolConnection): Promise<InventoryMetrics> {
  const db = conn || pool;

  if (entityType === "miniapp") {
    const [[row]]: any = await db.query(`
      SELECT
        m.id, m.status, m.created_at, COALESCE(m.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(m.traffic_risk_level, 'low') as traffic_risk_level,
        COALESCE(m.inventory_override, 'none') as inventory_override,
        COALESCE(m.inventory_priority_multiplier, 1) as inventory_priority_multiplier,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = m.id AND mr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as requests_7d,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)), 0) as impressions_7d,
        COALESCE((SELECT SUM(ds.publisher_revenue) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)), 0) as revenue_7d,
        COALESCE((SELECT COUNT(DISTINCT ds.date) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND ds.impressions > 0), 0) as active_days_7d,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND ds.date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)), 0) as prev_impressions_7d
      FROM miniapps m
      WHERE m.id = ?
    `, [entityId]);
    const trafficQuality = toNumber(row?.traffic_quality_score || 60);
    const impressions = toNumber(row?.impressions_7d);
    const requests = toNumber(row?.requests_7d);
    const fillRate = requests > 0 ? clamp(impressions / requests * 100, 0, 100) : 50;
    const consistency = clamp(toNumber(row?.active_days_7d) / 7 * 100, 0, 100);
    const prevImpressions = toNumber(row?.prev_impressions_7d);
    const trendScore = prevImpressions > 0 ? clamp(impressions / prevImpressions * 50, 0, 100) : impressions > 0 ? 65 : 45;
    const revenueScore = clamp(toNumber(row?.revenue_7d) * 25, 0, 100);
    const completionAnalytics = await getInternalAdCompletionAnalytics({ conn: db, miniappId: entityId });
    const completionQualityScore = completionAnalytics.triggered_ads > 0
      ? clamp(completionAnalytics.completion_rate * 70 + Math.min(completionAnalytics.average_watch_duration / 15, 1) * 30 - completionAnalytics.fraud_signal_count * 5, 0, 100)
      : trafficQuality;
    const score = scoreInventory({
      trafficQuality,
      risk: row?.traffic_risk_level || riskLevel(trafficQuality),
      approvalScore: row?.status === "approved" || row?.status === "monetized" ? 80 : 45,
      reputationScore: isNewInventory(row || {}) ? 65 : 75,
      consistency,
      advertiserSatisfaction: clamp(trendScore * 0.65 + completionQualityScore * 0.35, 0, 100),
      ctr: null,
      fillRate,
      impressionQuality: clamp(trafficQuality * 0.7 + completionQualityScore * 0.3, 0, 100),
      revenueScore,
      override: row?.inventory_override || "none",
      priorityMultiplier: toNumber(row?.inventory_priority_multiplier || 1),
    });
    return {
      entity_type: "miniapp",
      entity_id: entityId,
      inventory_score: score,
      inventory_rank: inventoryRank(score),
      traffic_quality_score: trafficQuality,
      fraud_risk_level: row?.traffic_risk_level || riskLevel(trafficQuality),
      fill_rate: fillRate / 100,
      delivery_consistency: consistency / 100,
      revenue_7d: toNumber(row?.revenue_7d),
      impressions_7d: impressions,
      ctr: null,
      metadata: {
        requests_7d: requests,
        prev_impressions_7d: prevImpressions,
        trend_score: trendScore,
        completion_rate: completionAnalytics.completion_rate,
        average_watch_duration: completionAnalytics.average_watch_duration,
        incomplete_rate: completionAnalytics.incomplete_rate,
        abandonment_rate: completionAnalytics.abandonment_rate,
        fraud_signal_count: completionAnalytics.fraud_signal_count,
        completion_quality_score: completionQualityScore,
      },
    };
  }

  if (entityType === "channel") {
    const [[row]]: any = await db.query(`
      SELECT
        c.id, c.status, c.created_at, COALESCE(c.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(c.traffic_risk_level, 'low') as traffic_risk_level,
        COALESCE(c.inventory_override, 'none') as inventory_override,
        COALESCE(c.inventory_priority_multiplier, 1) as inventory_priority_multiplier,
        COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id = c.id AND cp.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as posts_7d,
        COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.channel_id = c.id AND cp.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as impressions_7d,
        COALESCE((SELECT SUM(asett.publisher_reward) FROM ad_settlements asett JOIN campaign_posts cp ON cp.id = asett.post_id WHERE cp.channel_id = c.id AND asett.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as revenue_7d,
        COALESCE((SELECT COUNT(*) FROM campaign_clicks cc JOIN campaign_posts cp ON cp.id = cc.post_id WHERE cp.channel_id = c.id AND cc.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as clicks_7d,
        COALESCE((SELECT COUNT(*) FROM campaign_views_audit cva JOIN campaign_posts cp ON cp.id = cva.post_id WHERE cp.channel_id = c.id AND cva.status = 'invalid' AND cva.check_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0) as invalid_audits
      FROM channels c
      WHERE c.id = ?
    `, [entityId]);
    const trafficQuality = toNumber(row?.traffic_quality_score || 60);
    const impressions = toNumber(row?.impressions_7d);
    const posts = toNumber(row?.posts_7d);
    const ctr = impressions > 0 ? clamp(toNumber(row?.clicks_7d) / impressions, 0, 1) : null;
    const consistency = clamp(posts / 7 * 100, 0, 100);
    const auditPenalty = clamp(toNumber(row?.invalid_audits) * 8, 0, 45);
    const score = scoreInventory({
      trafficQuality,
      risk: row?.traffic_risk_level || riskLevel(trafficQuality),
      approvalScore: row?.status === "active" ? 80 : 45,
      reputationScore: isNewInventory(row || {}) ? 65 : 75,
      consistency,
      advertiserSatisfaction: clamp((ctr || 0.01) * 1500, 0, 100),
      ctr,
      fillRate: posts > 0 ? 80 : 45,
      impressionQuality: clamp(trafficQuality - auditPenalty, 0, 100),
      revenueScore: clamp(toNumber(row?.revenue_7d) * 20, 0, 100),
      override: row?.inventory_override || "none",
      priorityMultiplier: toNumber(row?.inventory_priority_multiplier || 1),
    });
    return {
      entity_type: "channel",
      entity_id: entityId,
      inventory_score: score,
      inventory_rank: inventoryRank(score),
      traffic_quality_score: trafficQuality,
      fraud_risk_level: row?.traffic_risk_level || riskLevel(trafficQuality),
      fill_rate: posts > 0 ? 1 : 0,
      delivery_consistency: consistency / 100,
      revenue_7d: toNumber(row?.revenue_7d),
      impressions_7d: impressions,
      ctr,
      metadata: { posts_7d: posts, clicks_7d: toNumber(row?.clicks_7d), invalid_audits: toNumber(row?.invalid_audits) },
    };
  }

  const [[row]]: any = await db.query(`
    SELECT
      b.id, b.status, b.created_at, COALESCE(b.traffic_quality_score, 60) as traffic_quality_score,
      COALESCE(b.traffic_risk_level, 'low') as traffic_risk_level,
      COALESCE(b.inventory_override, 'none') as inventory_override,
      COALESCE(b.inventory_priority_multiplier, 1) as inventory_priority_multiplier,
      COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as impressions_7d,
      COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as revenue_7d,
      COALESCE((SELECT COUNT(DISTINCT DATE(bd.created_at)) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as active_days_7d,
      COALESCE((SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND ${botUserVerifiedReachableCondition("bu")}), 0) as active_users,
      COALESCE((SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND (${botUserBlockedCondition("bu")})), 0) as blocked_users
    FROM bots b
    WHERE b.id = ?
  `, [entityId]);
  const trafficQuality = toNumber(row?.traffic_quality_score || 60);
  const activeUsers = toNumber(row?.active_users);
  const blockedUsers = toNumber(row?.blocked_users);
  const userHealth = activeUsers + blockedUsers > 0 ? clamp(activeUsers / (activeUsers + blockedUsers) * 100, 0, 100) : 60;
  const consistency = clamp(toNumber(row?.active_days_7d) / 7 * 100, 0, 100);
  const impressions = toNumber(row?.impressions_7d);
  const score = scoreInventory({
    trafficQuality,
    risk: row?.traffic_risk_level || riskLevel(trafficQuality),
    approvalScore: row?.status === "active" ? 80 : 45,
    reputationScore: isNewInventory(row || {}) ? 65 : 75,
    consistency,
    advertiserSatisfaction: userHealth,
    ctr: null,
    fillRate: impressions > 0 ? 85 : 45,
    impressionQuality: trafficQuality,
    revenueScore: clamp(toNumber(row?.revenue_7d) * 50, 0, 100),
    override: row?.inventory_override || "none",
    priorityMultiplier: toNumber(row?.inventory_priority_multiplier || 1),
  });

  return {
    entity_type: "bot",
    entity_id: entityId,
    inventory_score: score,
    inventory_rank: inventoryRank(score),
    traffic_quality_score: trafficQuality,
    fraud_risk_level: row?.traffic_risk_level || riskLevel(trafficQuality),
    fill_rate: impressions > 0 ? 1 : 0,
    delivery_consistency: consistency / 100,
    revenue_7d: toNumber(row?.revenue_7d),
    impressions_7d: impressions,
    ctr: null,
    metadata: { active_users: activeUsers, blocked_users: blockedUsers, user_health: userHealth },
  };
}

export async function refreshInventoryOptimization(entityType: InventoryEntityType, limit = 200, conn?: PoolConnection) {
  const db = conn || pool;
  const table = entityType === "miniapp" ? "miniapps" : entityType === "channel" ? "channels" : "bots";
  const [rows]: any = await db.query(`SELECT id FROM ${table} WHERE is_deleted = FALSE ORDER BY id DESC LIMIT ?`, [Math.max(1, Math.min(Number(limit) || 200, 1000))]);
  let processed = 0;
  for (const row of rows) {
    const metrics = await calculateInventoryMetrics(entityType, Number(row.id), conn);
    await persistInventoryMetrics(metrics, conn);
    await maybeQueueInventoryAttention(metrics, conn);
    processed++;
  }
  return processed;
}

export async function refreshAllInventoryOptimization(limit = 200, conn?: PoolConnection) {
  return {
    miniapps: await refreshInventoryOptimization("miniapp", limit, conn),
    channels: await refreshInventoryOptimization("channel", limit, conn),
    bots: await refreshInventoryOptimization("bot", limit, conn),
  };
}

export function calculateAdvertiserPerformanceScore(input: {
  trustLevel?: string | null;
  campaignQuality?: unknown;
  spend?: unknown;
  approvedCampaigns?: unknown;
}) {
  const trust = String(input.trustLevel || "new").toLowerCase();
  const trustScore = trust === "trusted" ? 90 : trust === "verified" ? 80 : trust === "restricted" ? 20 : 55;
  const quality = clamp(toNumber(input.campaignQuality ?? 50), 0, 100);
  const spendScore = clamp(Math.log10(toNumber(input.spend) + 1) * 25, 0, 100);
  const approvalScore = clamp(toNumber(input.approvedCampaigns) * 12, 0, 100);
  return Math.round(clamp(trustScore * 0.35 + quality * 0.35 + spendScore * 0.2 + approvalScore * 0.1, 0, 100));
}

export function calculateCampaignPriorityScore(input: {
  advertiserTrustMultiplier?: unknown;
  campaignQuality?: unknown;
  cpmBid?: unknown;
  historicalPerformance?: unknown;
  advertiserPerformance?: unknown;
}) {
  const trust = clamp(toNumber(input.advertiserTrustMultiplier || 1) * 60, 0, 100);
  const quality = clamp(toNumber(input.campaignQuality ?? 50), 0, 100);
  const cpm = clamp(toNumber(input.cpmBid) * 20, 0, 100);
  const performance = clamp(toNumber(input.historicalPerformance ?? 50), 0, 100);
  const advertiser = clamp(toNumber(input.advertiserPerformance ?? 50), 0, 100);
  return Math.round(clamp(trust * 0.2 + quality * 0.3 + cpm * 0.25 + performance * 0.15 + advertiser * 0.1, 0, 100));
}

export function deliveryScoreForInventory(row: Record<string, unknown>, settings: DeliverySettings, campaignPriority = 50) {
  const override = String(row.inventory_override || "none") as InventoryOverride;
  if (override === "blacklist" || override === "pause") return 0;

  const inventoryScore = clamp(toNumber(row.inventory_score ?? 50), 0, 100);
  const rank = String(row.inventory_rank || inventoryRank(inventoryScore));
  const qualityMatch = 100 - Math.abs(campaignPriority - inventoryScore);
  const explorationBoost = isNewInventory(row) ? settings.exploration_allocation_percent : 0;
  const eliteBoost = rank === "elite" ? settings.elite_inventory_boost : 1;
  const manualBoost = override === "whitelist" ? 45 : override === "boost" ? 25 : override === "reduce" ? -25 : 0;
  const multiplier = overrideMultiplier(override, row.inventory_priority_multiplier);

  let score = inventoryScore * 0.55 + qualityMatch * 0.25 + explorationBoost + manualBoost;
  if (settings.mode === "performance") score = inventoryScore * 0.75 + qualityMatch * 0.2 + manualBoost;
  if (settings.mode === "growth") score = inventoryScore * 0.45 + qualityMatch * 0.15 + explorationBoost * 3 + manualBoost;
  if (settings.mode === "manual") {
    score =
      inventoryScore * settings.manual_quality_weight +
      qualityMatch * settings.manual_revenue_weight +
      (toNumber(row.delivery_consistency) || 50) * settings.manual_consistency_weight +
      explorationBoost * settings.manual_exploration_weight +
      (manualBoost + 50) * settings.manual_override_weight;
  }

  return clamp(score * eliteBoost * multiplier, 0, 300);
}

export function rankInventoryForDelivery<T extends Record<string, unknown>>(
  rows: T[],
  settings: DeliverySettings,
  campaignPriority = 50
) {
  const eligible = rows.filter((row) => {
    const override = String(row.inventory_override || "none");
    return override !== "blacklist" && override !== "pause";
  });
  const explorationCount = Math.floor(eligible.length * (settings.exploration_allocation_percent / 100));
  const newInventory = eligible
    .filter(isNewInventory)
    .sort((a, b) => deliveryScoreForInventory(b, settings, campaignPriority) - deliveryScoreForInventory(a, settings, campaignPriority));
  const established = eligible
    .filter((row) => !isNewInventory(row))
    .sort((a, b) => deliveryScoreForInventory(b, settings, campaignPriority) - deliveryScoreForInventory(a, settings, campaignPriority));

  if (settings.mode === "growth" || explorationCount > 0) {
    return [...newInventory.slice(0, explorationCount), ...established, ...newInventory.slice(explorationCount)];
  }

  return [...established, ...newInventory];
}
