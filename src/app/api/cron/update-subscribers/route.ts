import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { refreshSubscriberChannel } from "@/lib/channelSubscriberRefresh";
import { CHANNEL_REFRESH_ELIGIBILITY_SQL, SUBSCRIBER_REFRESH_HOURS } from "@/lib/channelRefreshPolicy";
export const dynamic = "force-dynamic";
/** Exact operational contract: 20 logical requests x 100 script batches = 2,000/run. */
export const SUBSCRIBER_REFRESH_BATCH_SIZE = 20;
export const SUBSCRIBER_REFRESH_MAX_BATCHES = 100;
export const SUBSCRIBER_REFRESH_MAX_PER_RUN = SUBSCRIBER_REFRESH_BATCH_SIZE * SUBSCRIBER_REFRESH_MAX_BATCHES;
const CURSOR_KEY = "subscriber_refresh_cursor";
type Channel = RowDataPacket & Record<string, any>;
const eligibleWhere = `WHERE ${CHANNEL_REFRESH_ELIGIBILITY_SQL} AND (c.subscribers_last_attempt_at IS NULL OR c.subscribers_last_attempt_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ${SUBSCRIBER_REFRESH_HOURS} HOUR)) AND (c.subscribers_next_retry_at IS NULL OR c.subscribers_next_retry_at<=UTC_TIMESTAMP())`;
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request); if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("update-subscribers", 1800); if (!lock) return NextResponse.json({ success: false, message: "Subscriber refresh already running" }, { status: 409 });
  try {
    const [[setting]]: any = await pool.query("SELECT value FROM settings WHERE `key`='min_subscribers' LIMIT 1"); const [[cursorRow]]: any = await pool.query("SELECT value FROM settings WHERE `key`=? LIMIT 1", [CURSOR_KEY]);
    const minimum = Math.max(0, Number(setting?.value || 100)); const cursor = Math.max(0, Number(cursorRow?.value || 0));
    const [[backlogRow]]: any = await pool.query(`SELECT COUNT(*) AS total FROM channels c JOIN users u ON u.id=c.user_id ${eligibleWhere}`); const backlogAtStart = Number(backlogRow?.total || 0);
    const select = async (comparison: string) => (await pool.query<Channel[]>(`SELECT c.id,c.user_id,c.chat_id,c.channel_type,c.tracking_account,c.status,c.is_deleted,c.marketplace_admin_status,c.paused_reason,c.automation_suspension_status,c.automation_suspended_until,c.revenue_protection_status,c.under_review,c.settlement_excluded_until,c.below_minimum_since,c.below_minimum_success_count,c.monetization_paused_reason,u.status publisher_status,u.is_banned publisher_is_banned FROM channels c JOIN users u ON u.id=c.user_id ${eligibleWhere} AND c.id ${comparison} ? ORDER BY c.id ASC LIMIT ${SUBSCRIBER_REFRESH_BATCH_SIZE}`, [cursor]))[0];
    let channels = await select(">"); if (channels.length === 0 && cursor > 0) channels = await select("<=");
    const nextCursor = channels.length ? Number(channels[channels.length - 1].id) : cursor;
    if (channels.length) await pool.query("INSERT INTO settings (`key`,value,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)", [CURSOR_KEY, String(nextCursor), "Durable fair continuation cursor for subscriber refresh"]);
    const results: any[] = []; for (const channel of channels) results.push({ id: channel.id, ...await refreshSubscriberChannel(channel, minimum) }); // deliberately sequential: Telegram concurrency remains 1
    const success = results.filter((r) => r.status !== "failed").length; const temporaryFailure = results.filter((r) => r.failureClass === "temporary").length; const permanentFailure = results.filter((r) => r.failureClass === "permanent").length;
    const telemetry = { eligible_backlog_at_start: backlogAtStart, processed: results.length, success_count: success, temporary_failure: temporaryFailure, permanent_failure: permanentFailure, remaining_backlog: Math.max(0, backlogAtStart - results.length), cursor: nextCursor, capacity_warning: backlogAtStart > SUBSCRIBER_REFRESH_MAX_PER_RUN };
    console.info("subscriber_refresh", JSON.stringify(telemetry)); return NextResponse.json({ success: true, processed: results.length, minimum, details: results, telemetry });
  } catch (error) { console.error("Subscriber refresh failed", error); return NextResponse.json({ success: false, error: "subscriber_refresh_failed" }, { status: 500 }); } finally { await releaseCronLock(lock); }
}
