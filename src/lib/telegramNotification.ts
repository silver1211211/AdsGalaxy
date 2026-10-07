import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
type Queryable = Pool | PoolConnection;
export type TelegramNotificationOutcome = "DELIVERED" | "TEMPORARY_FAILURE" | "PERMANENT_UNREACHABLE" | "INVALID_RECIPIENT" | "INTERNAL_FAILURE";
export async function getUserTelegramRecipient(userId: number, db: Queryable = pool) {
  const [rows] = await db.query<Array<RowDataPacket & { telegram_id: string | number | null }>>("SELECT telegram_id FROM users WHERE id=? LIMIT 1", [userId]);
  const value = rows[0]?.telegram_id;
  return value === null || value === undefined || !String(value).trim() ? null : String(value);
}
export function classifyTelegramNotificationResult(input: unknown): { outcome: TelegramNotificationOutcome; retryAfterSeconds: number | null; code: string } {
  if (input && typeof input === "object" && "ok" in input && (input as { ok?: boolean }).ok) return { outcome: "DELIVERED", retryAfterSeconds: null, code: "delivered" };
  const value = input as { error_code?: number; description?: string; parameters?: { retry_after?: number } } | Error | null;
  const description = String(value instanceof Error ? value.message : value?.description || "").toLowerCase();
  const status = value instanceof Error ? 0 : Number(value?.error_code || 0);
  const retryAfter = value instanceof Error ? null : Number(value?.parameters?.retry_after || 0) || null;
  if (!description) return { outcome: "INTERNAL_FAILURE", retryAfterSeconds: null, code: "unknown_notification_failure" };
  if (/telegram_id_missing|invalid recipient|recipient.*missing/.test(description)) return { outcome: "INVALID_RECIPIENT", retryAfterSeconds: null, code: "invalid_recipient" };
  if (/bot was blocked by the user|user is deactivated|forbidden.*bot|bot can.t initiate conversation|chat not found/.test(description)) return { outcome: "PERMANENT_UNREACHABLE", retryAfterSeconds: null, code: "recipient_unreachable" };
  if (status === 429 || retryAfter || /too many requests|retry after|flood/.test(description)) return { outcome: "TEMPORARY_FAILURE", retryAfterSeconds: retryAfter, code: "rate_limited" };
  if (/timeout|timed out|econnreset|eai_again|network|fetch failed|socket/.test(description) || status >= 500) return { outcome: "TEMPORARY_FAILURE", retryAfterSeconds: null, code: "temporary_transport_failure" };
  return { outcome: "INTERNAL_FAILURE", retryAfterSeconds: null, code: "telegram_notification_failed" };
}
