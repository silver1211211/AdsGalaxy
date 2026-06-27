import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export const INTERNAL_REWARDED_AD_SECONDS = 15;

export type InternalAdCompletionEventType =
  | "impression_recorded"
  | "watch_update"
  | "completed"
  | "app_minimized"
  | "app_backgrounded"
  | "session_abandoned"
  | "ad_abandoned";

export type WatchQualityTier = "fraud_watch" | "very_low" | "valid_low_quality" | "average";
export type FraudEscalationLevel = "ignore" | "warning" | "watch" | "fraud_signal";

type Queryable = {
  query: (sql: string, values?: unknown[]) => Promise<any>;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

export function normalizeWatchDuration(value: unknown) {
  return clamp(toNumber(value), 0, INTERNAL_REWARDED_AD_SECONDS);
}

export function watchDurationQualityTier(seconds: unknown, completed = false): WatchQualityTier {
  const duration = normalizeWatchDuration(seconds);
  if (completed && duration >= INTERNAL_REWARDED_AD_SECONDS) return "average";
  if (duration >= 8) return "valid_low_quality";
  if (duration >= 3) return "very_low";
  return "fraud_watch";
}

export function qualityScoreForWatchTier(tier: WatchQualityTier) {
  if (tier === "average") return 60;
  if (tier === "valid_low_quality") return 40;
  if (tier === "very_low") return 20;
  return 5;
}

export function fraudEscalationLevel(incompleteCount: number): FraudEscalationLevel {
  if (incompleteCount >= 5) return "fraud_signal";
  if (incompleteCount >= 3) return "watch";
  if (incompleteCount >= 2) return "warning";
  return "ignore";
}

export function isCompletionEvent(value: unknown): value is InternalAdCompletionEventType {
  return [
    "impression_recorded",
    "watch_update",
    "completed",
    "app_minimized",
    "app_backgrounded",
    "session_abandoned",
    "ad_abandoned",
  ].includes(String(value));
}

export async function recordInternalAdCompletionEvent(input: {
  conn: PoolConnection;
  requestId: string;
  miniappId: number;
  campaignId: number | null;
  telegramUserId: string;
  eventType: InternalAdCompletionEventType;
  watchDurationSeconds: number;
  completed: boolean;
  abandonmentReason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const watchDurationSeconds = normalizeWatchDuration(input.watchDurationSeconds);
  const qualityTier = watchDurationQualityTier(watchDurationSeconds, input.completed);
  const qualityScore = qualityScoreForWatchTier(qualityTier);
  const isIncomplete = !input.completed && input.eventType !== "impression_recorded" && input.eventType !== "watch_update";

  const [[windowRow]] = await input.conn.query<RowDataPacket[]>(`
    SELECT COUNT(*) as incomplete_count
    FROM miniapp_internal_ad_completion_events
    WHERE miniapp_id = ?
      AND telegram_user_id = ?
      AND event_type IN ('app_minimized', 'app_backgrounded', 'session_abandoned', 'ad_abandoned')
      AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `, [input.miniappId, input.telegramUserId]);

  const incompleteCount = Number(windowRow?.incomplete_count || 0) + (isIncomplete ? 1 : 0);
  const escalation = fraudEscalationLevel(incompleteCount);
  const fraudSignalCount = escalation === "fraud_signal" ? incompleteCount : 0;
  const metadata = {
    ...(input.metadata || {}),
    max_rewarded_seconds: INTERNAL_REWARDED_AD_SECONDS,
    completion_model: "15s_internal_rewarded",
    incomplete_count_24h: incompleteCount,
    fraud_escalation_level: escalation,
  };

  await input.conn.query(`
    INSERT INTO miniapp_internal_ad_completion_events
      (
        request_id, miniapp_id, campaign_id, telegram_user_id, event_type,
        watch_duration_seconds, quality_tier, fraud_escalation_level,
        abandonment_reason, metadata
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.requestId,
    input.miniappId,
    input.campaignId,
    input.telegramUserId,
    input.eventType,
    watchDurationSeconds,
    qualityTier,
    escalation,
    input.abandonmentReason || null,
    JSON.stringify(metadata),
  ]);

  await input.conn.query(`
    UPDATE miniapp_internal_ad_impressions
    SET
      watch_duration_seconds = GREATEST(watch_duration_seconds, ?),
      completion_status = CASE
        WHEN ? = 1 THEN 'completed'
        WHEN completion_status = 'completed' THEN completion_status
        WHEN ? IN ('app_minimized', 'app_backgrounded', 'session_abandoned', 'ad_abandoned') THEN 'incomplete'
        ELSE completion_status
      END,
      completion_quality_tier = CASE
        WHEN ? = 1 THEN ?
        WHEN completion_status = 'completed' THEN completion_quality_tier
        WHEN ? > watch_duration_seconds THEN ?
        ELSE completion_quality_tier
      END,
      completion_quality_score = GREATEST(completion_quality_score, ?),
      completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
      abandoned_at = CASE WHEN ? IN ('app_minimized', 'app_backgrounded', 'session_abandoned', 'ad_abandoned') THEN COALESCE(abandoned_at, NOW()) ELSE abandoned_at END,
      abandonment_reason = CASE WHEN ? IN ('app_minimized', 'app_backgrounded', 'session_abandoned', 'ad_abandoned') THEN ? ELSE abandonment_reason END,
      fraud_escalation_level = ?,
      fraud_signal_count = ?,
      quality_metadata = ?
    WHERE request_id = ?
  `, [
    watchDurationSeconds,
    input.completed ? 1 : 0,
    input.eventType,
    input.completed ? 1 : 0,
    qualityTier,
    watchDurationSeconds,
    qualityTier,
    qualityScore,
    input.completed ? 1 : 0,
    input.eventType,
    input.eventType,
    input.abandonmentReason || input.eventType,
    escalation,
    fraudSignalCount,
    JSON.stringify(metadata),
    input.requestId,
  ]);

  return {
    watch_duration_seconds: watchDurationSeconds,
    completion_quality_tier: qualityTier,
    completion_quality_score: qualityScore,
    fraud_escalation_level: escalation,
    fraud_signal_count: fraudSignalCount,
    incomplete_count_24h: incompleteCount,
  };
}

export async function getInternalAdCompletionAnalytics(input: {
  conn: Queryable;
  miniappId: number | string;
  startDate?: string;
  endDate?: string;
}) {
  const params: unknown[] = [input.miniappId];
  let dateFilter = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
  if (input.startDate && input.endDate) {
    dateFilter = "created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)";
    params.push(input.startDate, input.endDate);
  }

  const [[row]]: any = await input.conn.query(`
    SELECT
      COUNT(*) as triggered_ads,
      COALESCE(SUM(CASE WHEN completion_status = 'completed' THEN 1 ELSE 0 END), 0) as completed_ads,
      COALESCE(AVG(watch_duration_seconds), 0) as average_watch_duration,
      COALESCE(SUM(CASE WHEN completion_status <> 'completed' THEN 1 ELSE 0 END), 0) as incomplete_ads,
      COALESCE(SUM(CASE WHEN abandonment_reason IS NOT NULL OR completion_status = 'incomplete' THEN 1 ELSE 0 END), 0) as abandoned_ads,
      COALESCE(SUM(fraud_signal_count), 0) as fraud_signal_count
    FROM miniapp_internal_ad_impressions
    WHERE miniapp_id = ? AND ${dateFilter}
  `, params);

  const triggeredAds = toNumber(row?.triggered_ads);
  const completedAds = toNumber(row?.completed_ads);
  const incompleteAds = toNumber(row?.incomplete_ads);
  const abandonedAds = toNumber(row?.abandoned_ads);

  return {
    triggered_ads: triggeredAds,
    completed_ads: completedAds,
    completion_rate: triggeredAds > 0 ? completedAds / triggeredAds : 0,
    average_watch_duration: toNumber(row?.average_watch_duration),
    incomplete_ads: incompleteAds,
    incomplete_rate: triggeredAds > 0 ? incompleteAds / triggeredAds : 0,
    abandoned_ads: abandonedAds,
    abandonment_rate: triggeredAds > 0 ? abandonedAds / triggeredAds : 0,
    fraud_signal_count: toNumber(row?.fraud_signal_count),
  };
}
