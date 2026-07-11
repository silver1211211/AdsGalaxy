import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

const ADSGALAXY_REF_LINK = "https://t.me/Ads_Galaxy_bot?startapp=REF770190998629F";

// Plain-text URL (no <a> tag) so Telegram auto-links it instead of rendering
// custom link text — this is a system welcome post, not a paid ad, so it must
// never carry an inline keyboard, CTA button, tracking, or watermark.
const WELCOME_CAPTION =
  `🚀 <b>Welcome to AdsGalaxy</b>\n\n` +
  `Your channel has been added and is now under review.\n\n` +
  `💰 Monetize your Telegram:\n` +
  `• Channels (Public & Private)\n` +
  `• Bots\n` +
  `• Mini Apps\n\n` +
  `📢 Reach thousands of Telegram users by advertising your products across the AdsGalaxy network.\n\n` +
  `Start monetizing:\n${ADSGALAXY_REF_LINK}`;

async function logWelcomePostAttempt(channelId: number | string, status: "sent" | "failed", failureReason: string | null, telegramChatId: unknown, db: Pool | PoolConnection) {
  try {
    await db.query(
      "INSERT INTO notification_log (entity_type, entity_id, event_type, telegram_id, status, failure_reason) VALUES ('channel', ?, 'channel_welcome_post', ?, ?, ?)",
      [channelId, String(telegramChatId), status, failureReason ? failureReason.slice(0, 255) : null]
    );
  } catch (error) {
    console.error("Failed to write notification_log row for welcome post:", error instanceof Error ? error.message : error);
  }
}

// Idempotent and race-safe: the claim UPDATE below only succeeds for one
// caller at a time (WHERE welcome_post_sent_at IS NULL AND status is not
// already 'sending'), so two concurrent/duplicate creation requests can never
// both send the welcome post. A failed attempt resets status to 'failed',
// which is the only other state the claim condition accepts — so retrying
// after a failure works, but a successful send can never be duplicated.
export async function sendChannelWelcomePostIfNeeded(
  channelId: number | string,
  chatId: string | number,
  db: Pool | PoolConnection = pool
) {
  const [claim] = await db.query<ResultSetHeader>(
    `UPDATE channels
     SET welcome_post_status = 'sending', welcome_post_attempted_at = NOW()
     WHERE id = ?
       AND welcome_post_sent_at IS NULL
       AND (welcome_post_status IS NULL OR welcome_post_status = 'failed')`,
    [channelId]
  );
  if (claim.affectedRows === 0) return;

  const imageUrl = process.env.CHANNEL_WELCOME_IMAGE_URL;
  if (!imageUrl) {
    const reason = "CHANNEL_WELCOME_IMAGE_URL is not configured";
    console.error("Channel welcome post skipped:", { channel_id: channelId, reason });
    await db.query(
      "UPDATE channels SET welcome_post_status = 'failed', welcome_post_failure_reason = ? WHERE id = ?",
      [reason, channelId]
    );
    await logWelcomePostAttempt(channelId, "failed", reason, chatId, db);
    return;
  }

  try {
    const result = await sendTelegramMessage(chatId, WELCOME_CAPTION, {
      photo: imageUrl,
      parse_mode: "HTML",
    });

    if (result && result.ok) {
      await db.query(
        "UPDATE channels SET welcome_post_sent_at = NOW(), welcome_post_status = 'sent', welcome_post_failure_reason = NULL, welcome_post_message_id = ? WHERE id = ?",
        [result.result?.message_id || null, channelId]
      );
      await logWelcomePostAttempt(channelId, "sent", null, chatId, db);
      console.log("Channel welcome post sent", { channel_id: channelId });
    } else {
      const reason = String(result?.description || "Telegram send failed").slice(0, 255);
      await db.query(
        "UPDATE channels SET welcome_post_status = 'failed', welcome_post_failure_reason = ? WHERE id = ?",
        [reason, channelId]
      );
      await logWelcomePostAttempt(channelId, "failed", reason, chatId, db);
      console.error("Channel welcome post failed", { channel_id: channelId, reason });
    }
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Unknown error").slice(0, 255);
    await db.query(
      "UPDATE channels SET welcome_post_status = 'failed', welcome_post_failure_reason = ? WHERE id = ?",
      [reason, channelId]
    );
    await logWelcomePostAttempt(channelId, "failed", reason, chatId, db);
    console.error("Channel welcome post threw", { channel_id: channelId, reason });
  }
}
