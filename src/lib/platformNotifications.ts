import "server-only";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";
import { classifyTelegramNotificationResult } from "@/lib/telegramNotification";

type Queryable = Pool | PoolConnection;

export type PlatformNotificationInput = {
  eventKey: string;
  userId: number;
  eventType: string;
  entityType: string;
  entityId: number | string;
  messageHtml: string;
  metadata?: Record<string, unknown>;
};

export async function enqueuePlatformNotification(db: Queryable, input: PlatformNotificationInput) {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO platform_notification_events
       (event_key,user_id,event_type,entity_type,entity_id,message_html,metadata,status,next_attempt_at)
     VALUES (?,?,?,?,?,?,?,'pending',NOW())`,
    [input.eventKey, input.userId, input.eventType, input.entityType, String(input.entityId), input.messageHtml,
      input.metadata ? JSON.stringify(input.metadata) : null],
  );
  return result.affectedRows === 1;
}

export async function enqueueCampaignNotification(
  db: Queryable,
  input: { campaignId: number; userId: number; event: "approved" | "completed" | "daily_cap" | "insufficient_balance"; name: string; billingDay?: string },
) {
  const escaped = escapeTelegramHtml(input.name || `Campaign #${input.campaignId}`);
  const definitions = {
    approved: [`campaign_approved:${input.campaignId}`, "Campaign approved ✅", `“${escaped}” is now ready for delivery.`],
    completed: [`campaign_completed:${input.campaignId}`, "Campaign completed ✅", `“${escaped}” has finished delivery.`],
    daily_cap: [`daily_cap:${input.campaignId}:${input.billingDay}`, "Daily cap reached", `“${escaped}” reached today’s daily limit.<br>Traffic is paused until the next UTC billing day.`],
    insufficient_balance: [`campaign_low_balance:${input.campaignId}`, "Campaign paused", `“${escaped}” was paused because your advertising balance is insufficient.`],
  } as const;
  const [eventKey, title, body] = definitions[input.event];
  return enqueuePlatformNotification(db, {
    eventKey, userId: input.userId, eventType: `campaign_${input.event}`, entityType: "campaign", entityId: input.campaignId,
    messageHtml: `<b>${title}</b>\n\n${body.replace(/<br>/g, "\n")}`,
  });
}

export async function enqueueAssetNotification(
  db: Queryable,
  input: { assetType: "channel" | "bot" | "miniapp"; assetId: number; userId: number; event: "approved" | "paused" | "access_removed" | "access_restored"; name: string; version?: number },
) {
  const label = input.assetType === "miniapp" ? "Mini App" : input.assetType[0].toUpperCase() + input.assetType.slice(1);
  const escaped = escapeTelegramHtml(input.name || `${label} #${input.assetId}`);
  const suffix = input.version === undefined ? "" : `:${input.version}`;
  const copy = {
    approved: [`${label} approved ✅`, `“${escaped}” is now active and can start earning.`],
    paused: [`${label} paused`, `“${escaped}” is not earning right now. Activate it again to continue monetizing.`],
    access_removed: ["Ads Galaxy bot removed", `Our bot no longer has the required access to “${escaped}”. Add it back as admin to continue earning.`],
    access_restored: ["Access restored", `“${escaped}” can earn again.`],
  } as const;
  return enqueuePlatformNotification(db, {
    eventKey: `asset_${input.event}:${input.assetType}:${input.assetId}${suffix}`,
    userId: input.userId, eventType: `asset_${input.event}`, entityType: input.assetType, entityId: input.assetId,
    messageHtml: `<b>${copy[input.event][0]}</b>\n\n${copy[input.event][1]}`,
  });
}

export async function recordBalanceNotificationTransition(
  conn: PoolConnection,
  input: { userId: number; previousBalance: number; newBalance: number; threshold?: number },
) {
  const threshold = input.threshold ?? 5;
  const crossedBelow = input.previousBalance > threshold && input.newBalance <= threshold;
  const recovered = input.newBalance > threshold;
  await conn.query(
    `INSERT INTO advertiser_balance_notification_state(user_id,below_threshold,threshold_cycle,last_balance)
     VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE
       threshold_cycle=threshold_cycle+IF(below_threshold=0 AND VALUES(below_threshold)=1,1,0),
       below_threshold=VALUES(below_threshold),last_balance=VALUES(last_balance)`,
    [input.userId, input.newBalance <= threshold ? 1 : 0, crossedBelow ? 1 : 0, input.newBalance],
  );
  if (crossedBelow) {
    const [[state]] = await conn.query<Array<RowDataPacket & { threshold_cycle: number }>>(
      "SELECT threshold_cycle FROM advertiser_balance_notification_state WHERE user_id=? FOR UPDATE", [input.userId]);
    await enqueuePlatformNotification(conn, {
      eventKey: `low_balance:${input.userId}:${Number(state?.threshold_cycle || 1)}`,
      userId: input.userId, eventType: "low_balance", entityType: "user", entityId: input.userId,
      messageHtml: `<b>Balance running low</b>\n\nYou have <b>$${input.newBalance.toFixed(2)}</b> remaining.\nTop up to keep your campaigns running.`,
      metadata: { threshold, previous_balance: input.previousBalance, balance: input.newBalance },
    });
  }
  return { crossedBelow, recovered };
}

export async function dispatchPlatformNotifications(limit = 50) {
  const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
  const [rows] = await pool.query<Array<RowDataPacket & { id: number; message_html: string; telegram_id: string | number | null }>>(
    `SELECT n.id,n.message_html,u.telegram_id FROM platform_notification_events n JOIN users u ON u.id=n.user_id
     WHERE (n.status IN ('pending','failed') AND n.next_attempt_at<=NOW())
        OR (n.status='processing' AND n.updated_at<DATE_SUB(NOW(),INTERVAL 10 MINUTE))
     ORDER BY n.id LIMIT ?`, [bounded]);
  let sent = 0; let failed = 0;
  for (const row of rows) {
    const [claim] = await pool.query<ResultSetHeader>(
      `UPDATE platform_notification_events SET status='processing',attempt_count=attempt_count+1,last_error=NULL
       WHERE id=? AND ((status IN ('pending','failed') AND next_attempt_at<=NOW()) OR (status='processing' AND updated_at<DATE_SUB(NOW(),INTERVAL 10 MINUTE)))`, [row.id]);
    if (claim.affectedRows !== 1) continue;
    try {
      const result = row.telegram_id ? await sendTelegramMessage(String(row.telegram_id), row.message_html, { parse_mode: "HTML" }) : { ok: false, description: "telegram_id_missing" };
      const classified = classifyTelegramNotificationResult(result);
      if (classified.outcome === "DELIVERED") {
        await pool.query("UPDATE platform_notification_events SET status='sent',sent_at=NOW(),last_error=NULL WHERE id=? AND status='processing'", [row.id]); sent += 1;
      } else if (classified.outcome === "TEMPORARY_FAILURE") {
        await pool.query(`UPDATE platform_notification_events SET status='failed',last_error=?,next_attempt_at=TIMESTAMPADD(SECOND,COALESCE(?,LEAST(3600,POW(2,LEAST(attempt_count,5))*60)),NOW()) WHERE id=? AND status='processing'`, [classified.code, classified.retryAfterSeconds, row.id]); failed += 1;
      } else {
        await pool.query("UPDATE platform_notification_events SET status='failed',last_error=?,next_attempt_at='9999-12-31 23:59:59' WHERE id=? AND status='processing'", [classified.code, row.id]); failed += 1;
      }
    } catch (error) {
      const classified = classifyTelegramNotificationResult(error instanceof Error ? error : new Error("notification_failed"));
      await pool.query(
        `UPDATE platform_notification_events SET status='failed',last_error=?,
         next_attempt_at=TIMESTAMPADD(MINUTE,LEAST(60,POW(2,LEAST(attempt_count,5))),NOW()) WHERE id=? AND status='processing'`,
        [classified.code, row.id]);
      failed += 1;
    }
  }
  return { checked: rows.length, sent, failed };
}

