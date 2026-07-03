import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;

export type SystemLogType =
  | "channel_posting"
  | "bot_broadcast_hourly"
  | "channel_health"
  | "bot_health"
  | "publisher_trust_enforcement"
  | "channel_campaign_pause_delete_settlement"
  | "system_error";

export type SystemLogStatus = "success" | "partial_failure" | "failed";

type JsonValue = Record<string, unknown> | Array<unknown> | null;

export type SystemLogInput = {
  logType: SystemLogType;
  status: SystemLogStatus;
  title: string;
  summary?: string | null;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  slotDate?: string | null;
  slotTime?: string | null;
  attemptedCount?: number;
  successCount?: number;
  failedCount?: number;
  skippedCount?: number;
  autoPausedCount?: number;
  inactiveUsersCount?: number;
  pausedBotsCount?: number;
  failedBotsCount?: number;
  failureReasons?: JsonValue;
  affectedEntities?: JsonValue;
  metadata?: JsonValue;
};

function toJson(value: JsonValue | undefined) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function count(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function maskEntityId(type: string, id: string | number) {
  const raw = String(id);
  const suffix = raw.length > 4 ? raw.slice(-4) : raw;
  return `${type}_${suffix.padStart(4, "0")}`;
}

export function logStatus(success: number, failed: number): SystemLogStatus {
  if (failed > 0 && success > 0) return "partial_failure";
  if (failed > 0 && success === 0) return "failed";
  return "success";
}

export async function createSystemLog(input: SystemLogInput, db: Db = pool) {
  try {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO system_logs
        (log_type, status, title, summary, period_start, period_end, slot_date, slot_time,
         attempted_count, success_count, failed_count, skipped_count, auto_paused_count,
         inactive_users_count, paused_bots_count, failed_bots_count,
         failure_reasons, affected_entities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.logType,
        input.status,
        input.title.slice(0, 160),
        input.summary || null,
        input.periodStart || null,
        input.periodEnd || null,
        input.slotDate || null,
        input.slotTime || null,
        count(input.attemptedCount),
        count(input.successCount),
        count(input.failedCount),
        count(input.skippedCount),
        count(input.autoPausedCount),
        count(input.inactiveUsersCount),
        count(input.pausedBotsCount),
        count(input.failedBotsCount),
        toJson(input.failureReasons),
        toJson(input.affectedEntities),
        toJson(input.metadata),
      ]
    );
    return result?.insertId || null;
  } catch (error: unknown) {
    console.warn("System log write skipped", { type: input.logType, error: error instanceof Error ? error.message : "unknown_error" });
    return null;
  }
}

export async function upsertBroadcastHourlyLog(input: Omit<SystemLogInput, "logType" | "title" | "status"> & {
  status?: SystemLogStatus;
  title?: string;
}, db: Db = pool) {
  const success = count(input.successCount);
  const failed = count(input.failedCount);
  const status = input.status || logStatus(success, failed);

  try {
    await db.query(
      `INSERT INTO system_logs
        (log_type, status, title, summary, period_start, period_end,
         attempted_count, success_count, failed_count, skipped_count, auto_paused_count,
         inactive_users_count, paused_bots_count, failed_bots_count,
         failure_reasons, affected_entities, metadata)
       VALUES ('bot_broadcast_hourly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         attempted_count = attempted_count + VALUES(attempted_count),
         success_count = success_count + VALUES(success_count),
         failed_count = failed_count + VALUES(failed_count),
         skipped_count = skipped_count + VALUES(skipped_count),
         auto_paused_count = auto_paused_count + VALUES(auto_paused_count),
         inactive_users_count = inactive_users_count + VALUES(inactive_users_count),
         paused_bots_count = paused_bots_count + VALUES(paused_bots_count),
         failed_bots_count = failed_bots_count + VALUES(failed_bots_count),
         failure_reasons = COALESCE(VALUES(failure_reasons), failure_reasons),
         affected_entities = COALESCE(VALUES(affected_entities), affected_entities),
         metadata = COALESCE(VALUES(metadata), metadata),
         status = CASE
           WHEN failed_count + VALUES(failed_count) > 0 AND success_count + VALUES(success_count) > 0 THEN 'partial_failure'
           WHEN failed_count + VALUES(failed_count) > 0 THEN 'failed'
           ELSE 'success'
         END,
         updated_at = NOW()`,
      [
        status,
        input.title || "Bot broadcast hourly summary",
        input.summary || null,
        input.periodStart || null,
        input.periodEnd || null,
        count(input.attemptedCount),
        success,
        failed,
        count(input.skippedCount),
        count(input.autoPausedCount),
        count(input.inactiveUsersCount),
        count(input.pausedBotsCount),
        count(input.failedBotsCount),
        toJson(input.failureReasons),
        toJson(input.affectedEntities),
        toJson(input.metadata),
      ]
    );
  } catch (error: unknown) {
    console.warn("Broadcast hourly system log write skipped", { error: error instanceof Error ? error.message : "unknown_error" });
  }
}

export async function cleanupOldSystemLogs(db: Db = pool) {
  const [[setting]] = await db.query<Array<RowDataPacket & { value: string }>>("SELECT value FROM settings WHERE `key` = 'system_log_retention_days' LIMIT 1");
  const days = Math.min(365, Math.max(1, parseInt(setting?.value || "60", 10)));
  const [result] = await db.query<ResultSetHeader>("DELETE FROM system_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)", [days]);
  return { retentionDays: days, deleted: Number(result?.affectedRows || 0) };
}
