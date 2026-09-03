import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";

type QueryExecutor = Pick<PoolConnection, "query">;

type NotificationRow = RowDataPacket & {
  id: number;
  campaign_id: number;
  campaign_name: string;
  telegram_id: string | number | null;
  remaining_budget: string | number;
};

export async function enqueueMiniAppBudgetExhaustedNotification(
  conn: QueryExecutor,
  campaignId: number,
) {
  await conn.query(
    `INSERT IGNORE INTO miniapp_campaign_notification_outbox
       (campaign_id, event_type, exhaustion_cycle, status, next_attempt_at)
     SELECT id, 'budget_exhausted', budget_exhaustion_cycle, 'pending', NOW()
     FROM miniapp_rewarded_campaigns
     WHERE id = ? AND pause_reason = 'budget_exhausted'`,
    [campaignId],
  );
}

export async function markMiniAppCampaignBudgetExhausted(
  conn: QueryExecutor,
  campaignId: number,
) {
  await conn.query(
    `UPDATE miniapp_rewarded_campaigns
     SET budget_exhaustion_cycle = budget_exhaustion_cycle
           + CASE WHEN COALESCE(pause_reason, '') = 'budget_exhausted' THEN 0 ELSE 1 END,
         status = 'paused',
         pause_reason = 'budget_exhausted',
         remaining_budget = GREATEST(remaining_budget, 0)
     WHERE id = ?`,
    [campaignId],
  );
  await enqueueMiniAppBudgetExhaustedNotification(conn, campaignId);
}

export async function dispatchMiniAppCampaignNotifications(limit = 20) {
  const boundedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const [candidates] = await pool.query<NotificationRow[]>(
    `SELECT o.id, o.campaign_id, c.campaign_name, c.remaining_budget, u.telegram_id
     FROM miniapp_campaign_notification_outbox o
     JOIN miniapp_rewarded_campaigns c ON c.id = o.campaign_id
     JOIN users u ON u.id = c.advertiser_id
     WHERE (
       o.status IN ('pending', 'failed') AND o.next_attempt_at <= NOW()
     ) OR (
       o.status = 'processing' AND o.updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
     )
     ORDER BY o.id ASC
     LIMIT ?`,
    [boundedLimit],
  );

  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const [claim] = await pool.query<import("mysql2/promise").ResultSetHeader>(
      `UPDATE miniapp_campaign_notification_outbox
       SET status = 'processing', attempt_count = attempt_count + 1, last_error = NULL
       WHERE id = ? AND (
         (status IN ('pending', 'failed') AND next_attempt_at <= NOW())
         OR (status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE))
       )`,
      [candidate.id],
    );
    if (claim.affectedRows !== 1) continue;

    try {
      if (!candidate.telegram_id) throw new Error("Advertiser Telegram ID is missing");
      const result = await sendTelegramMessage(
        String(candidate.telegram_id),
        `âš ï¸ <b>Mini App campaign budget exhausted</b>\n\n` +
          `Your campaign "<b>${escapeTelegramHtml(candidate.campaign_name)}</b>" can no longer fund another impression and has been paused.\n\n` +
          `Remaining budget: <b>$${Number(candidate.remaining_budget || 0).toFixed(2)}</b>\n\n` +
          `Add funds, then resume the campaign to continue delivery.`,
        { parse_mode: "HTML" },
      );
      if (!result?.ok) throw new Error(String(result?.description || "Telegram delivery failed"));
      await pool.query(
        `UPDATE miniapp_campaign_notification_outbox
         SET status = 'sent', sent_at = NOW(), last_error = NULL
         WHERE id = ? AND status = 'processing'`,
        [candidate.id],
      );
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notification failed";
      await pool.query(
        `UPDATE miniapp_campaign_notification_outbox
         SET status = 'failed', last_error = ?,
             next_attempt_at = TIMESTAMPADD(MINUTE, LEAST(60, POW(2, LEAST(attempt_count, 5))), NOW())
         WHERE id = ? AND status = 'processing'`,
        [message.slice(0, 255), candidate.id],
      );
      failed += 1;
    }
  }
  return { checked: candidates.length, sent, failed };
}
