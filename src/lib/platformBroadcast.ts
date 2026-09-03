import pool from "@/lib/db";
import { escapeTelegramHtml } from "@/lib/telegram";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export const PLATFORM_BROADCAST_BATCH_SIZE = 20;
export const PLATFORM_BROADCAST_MAX_ATTEMPTS = 4;
export const PLATFORM_BROADCAST_QUIET_SCANS = 3;
export const PLATFORM_BROADCAST_QUIET_SECONDS = 120;

const OFFICIAL_BOT_REACHABLE = ` AND (u.official_bot_started_at IS NOT NULL OR EXISTS (
  SELECT 1 FROM platform_broadcast_recipients previous
  WHERE previous.user_id = u.id AND previous.status = 'sent'
))`;

export type BroadcastTarget = "all_users" | "joined_within" | "active_within";
export type BroadcastWindowUnit = "seconds" | "minutes" | "hours";

export function parseBroadcastTarget(input: any) {
  const targetType = String(input?.target_type || "all_users") as BroadcastTarget;
  if (targetType === "all_users") return { targetType, targetValue: null, targetUnit: null, targetSince: null };
  if (!(["joined_within", "active_within"] as string[]).includes(targetType)) throw new Error("Select a valid recipient group.");
  const targetValue = Number(input?.target_value);
  const targetUnit = String(input?.target_unit || "hours") as BroadcastWindowUnit;
  if (!Number.isInteger(targetValue) || targetValue < 1 || targetValue > 1_000_000) throw new Error("Enter a whole-number time window between 1 and 1,000,000.");
  if (!(["seconds", "minutes", "hours"] as string[]).includes(targetUnit)) throw new Error("Select seconds, minutes, or hours.");
  const multiplier = targetUnit === "hours" ? 3_600_000 : targetUnit === "minutes" ? 60_000 : 1_000;
  return { targetType, targetValue, targetUnit, targetSince: new Date(Date.now() - targetValue * multiplier) };
}

export async function countEligibleRecipients(targetSince: Date | null, targetType: BroadcastTarget) {
  const column = targetType === "joined_within" ? "u.created_at" : targetType === "active_within" ? "u.last_active_at" : null;
  const filter = column ? ` AND ${column} >= ?` : "";
  const params = column ? [targetSince] : [];
  const [rows]: any = await pool.query(`SELECT COUNT(*) count FROM users u
    WHERE u.telegram_id IS NOT NULL AND TRIM(u.telegram_id) REGEXP '^[1-9][0-9]{4,19}$'
      AND COALESCE(LOWER(u.status),'active') NOT IN ('banned','deleted','blocked','deactivated')${OFFICIAL_BOT_REACHABLE}${filter}`, params);
  return Number(rows[0]?.count || 0);
}

export function validateButtonUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { const url = new URL(text); return ["http:", "https:", "tg:"].includes(url.protocol) ? text : null; }
  catch { return null; }
}

export function telegramHtml(source: string) {
  let text = escapeTelegramHtml(source).replace(/\r\n/g, "\n");
  const rules: Array<[RegExp, string]> = [
    [/`([^`\n]+)`/g, "<code>$1</code>"], [/\*\*([^*\n]+)\*\*/g, "<b>$1</b>"],
    [/__([^_\n]+)__/g, "<u>$1</u>"], [/~~([^~\n]+)~~/g, "<s>$1</s>"], [/_([^_\n]+)_/g, "<i>$1</i>"],
  ];
  for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
  return text;
}

export function composeHtml(title: string, titleBold: boolean, message: string) {
  const safeTitle = escapeTelegramHtml(title.trim());
  const heading = safeTitle ? (titleBold ? `<b>${safeTitle}</b>` : safeTitle) : "";
  return [heading, telegramHtml(message.trim())].filter(Boolean).join("\n\n");
}

export async function audit(broadcastId: number, action: string, adminId?: number | null, details?: unknown) {
  await pool.query("INSERT INTO platform_broadcast_audit_logs (broadcast_id,admin_id,action,details) VALUES (?,?,?,?)", [broadcastId, adminId || null, action, details ? JSON.stringify(details) : null]);
}

export async function discoverRecipients(broadcastId: number, connection: PoolConnection | typeof pool = pool) {
  const [broadcasts]: any = await connection.query("SELECT target_type,target_since FROM platform_broadcasts WHERE id=? LIMIT 1", [broadcastId]);
  const targetType = String(broadcasts[0]?.target_type || "all_users") as BroadcastTarget;
  const column = targetType === "joined_within" ? "u.created_at" : targetType === "active_within" ? "u.last_active_at" : null;
  const filter = column ? ` AND ${column} >= ?` : "";
  const params = column ? [broadcastId, broadcasts[0]?.target_since] : [broadcastId];
  const [result]: any = await connection.query(
    `INSERT IGNORE INTO platform_broadcast_recipients (broadcast_id,user_id,telegram_id)
     SELECT ?,u.id,TRIM(u.telegram_id) FROM users u
     WHERE u.telegram_id IS NOT NULL AND TRIM(u.telegram_id) REGEXP '^[1-9][0-9]{4,19}$'
       AND COALESCE(LOWER(u.status),'active') NOT IN ('banned','deleted','blocked','deactivated')${OFFICIAL_BOT_REACHABLE}${filter}`, params);
  await connection.query(`UPDATE platform_broadcasts b SET discovered_count=(SELECT COUNT(*) FROM platform_broadcast_recipients r WHERE r.broadcast_id=b.id),last_recipient_scan_at=NOW() WHERE b.id=?`, [broadcastId]);
  return Number(result.affectedRows || 0);
}

export function classifyTelegramFailure(data: any) {
  const code = Number(data?.error_code || 0); const description = String(data?.description || "").toLowerCase();
  if (code === 429) return { category: "rate_limited", retry: true, delay: Math.max(1, Number(data?.parameters?.retry_after || 5)) };
  if (code >= 500 || code === 0) return { category: "temporary", retry: true, delay: 30 };
  if (/blocked|chat not found|deactivated|user is deactivated/.test(description)) return { category: "blocked", retry: false, delay: 0 };
  return { category: "permanent", retry: false, delay: 0 };
}

export async function syncBroadcastCounts(broadcastId: number) {
  await pool.query(`UPDATE platform_broadcasts SET
    sent_count=(SELECT COUNT(*) FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='sent'),
    failed_count=(SELECT COUNT(*) FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='failed'),
    blocked_count=(SELECT COUNT(*) FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='blocked')
    WHERE id=?`, [broadcastId, broadcastId, broadcastId, broadcastId]);
}

export async function getBroadcastDashboard(id?: number) {
  const where = id ? "WHERE b.id=?" : ""; const params = id ? [id] : [];
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT b.*,a.username created_by,
    (SELECT COUNT(*) FROM platform_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status='queued') queued_count,
    (SELECT COUNT(*) FROM platform_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status='sending') sending_count,
    (SELECT COUNT(*) FROM platform_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status='sent') sent_live,
    (SELECT COUNT(*) FROM platform_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status='failed') failed_live,
    (SELECT COUNT(*) FROM platform_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.status='blocked') blocked_live
    FROM platform_broadcasts b LEFT JOIN admins a ON a.id=b.created_by_admin_id ${where} ORDER BY b.id DESC LIMIT ${id ? 1 : 50}`, params);
  return rows;
}
