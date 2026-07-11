import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";
import {
  autoPauseChannel,
  checkChannelHealth,
  markChannelHealthSuccess,
  recordChannelPostFailure,
} from "@/lib/channelLifecycle";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

async function hasLastSubscriberUpdateColumn() {
  const [rows]: any = await pool.query(`
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channels'
      AND COLUMN_NAME = 'last_subscriber_update_at'
    LIMIT 1
  `);

  return rows.length > 0;
}

export async function GET(_req: NextRequest) {
  const unauthorized = requireCronSecret(_req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("update-subscribers", 900);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Subscriber cron is already running" }, { status: 409 });
  }

  try {
    const isDev = process.env.MODE === "DEV";
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json({ error: "BOT_TOKEN not configured" }, { status: 500 });
    }

    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_SUBSCRIBER_ADD_INTERVAL || "10");
    const intervalMs = intervalMinutes * 60 * 1000;

    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_subscriber_cron_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      const minutesLeft = intervalMinutes;
      return NextResponse.json({
        success: false,
        message: `Too early. Please wait ${minutesLeft} more minutes.`,
      }, { status: 429 });
    }

    const canTrackSubscriberUpdates = await hasLastSubscriberUpdateColumn();
    const updateWindowCondition = canTrackSubscriberUpdates
      ? "AND (c.last_subscriber_update_at IS NULL OR c.last_subscriber_update_at < NOW() - INTERVAL 1 DAY)"
      : "";
    const updateOrder = canTrackSubscriberUpdates
      ? "c.last_subscriber_update_at ASC"
      : "c.id ASC";

    const [channels]: any = await pool.query(`
      SELECT c.*, u.telegram_id as owner_telegram_id
      FROM channels c
      JOIN users u ON c.user_id = u.id
      WHERE c.is_deleted = FALSE
        AND c.status = 'active'
        AND COALESCE(c.health_status, 'healthy') IN ('healthy','warning')
        ${updateWindowCondition}
      ORDER BY ${updateOrder}
      LIMIT 5
    `);

    const results = [];

    for (const channel of channels) {
      try {
        const health = await checkChannelHealth({ id: channel.id, chat_id: channel.chat_id });
        if (!health.ok) {
          if (health.permanent) {
            await autoPauseChannel(channel.id, health);
          } else {
            await recordChannelPostFailure(channel.id, health.reason || "Temporary channel health failure");
          }

          if (canTrackSubscriberUpdates) {
            await pool.query("UPDATE channels SET last_subscriber_update_at = NOW() WHERE id = ?", [channel.id]);
          }

          const channelLabel = channel.username ? `@${escapeTelegramHtml(channel.username)}` : `ID ${escapeTelegramHtml(channel.chat_id)}`;
          const notification = `<b>Channel Health Alert</b>\n\nYour channel <b>${escapeTelegramHtml(channel.title)}</b> (${channelLabel}) is not currently counted as active.\n\nReason: <i>${escapeTelegramHtml(health.reason || "Unable to verify channel access")}</i>\n\n${escapeTelegramHtml(health.suggestedFix || "Please verify channel access and try again.")}`;

          try {
            await sendTelegramMessage(channel.owner_telegram_id, notification, { parse_mode: "HTML" });
          } catch (notifyErr) {
            console.error(`Failed to notify publisher for channel ${channel.id}:`, notifyErr);
          }

          results.push({ id: channel.id, username: channel.username, status: health.status, reason: health.reason });
          continue;
        }

        const countRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${channel.chat_id}`);
        const countData = await countRes.json();
        if (!countData.ok) {
          await recordChannelPostFailure(channel.id, countData.description || "Unable to refresh subscriber count");
          results.push({ id: channel.id, username: channel.username, status: "count_failed", reason: countData.description });
          continue;
        }

        const subscriberCount = countData.result;
        if (canTrackSubscriberUpdates) {
          await pool.query(
            "UPDATE channels SET subscriber_count = ?, last_subscriber_update_at = NOW() WHERE id = ?",
            [subscriberCount, channel.id]
          );
        } else {
          await pool.query(
            "UPDATE channels SET subscriber_count = ? WHERE id = ?",
            [subscriberCount, channel.id]
          );
        }
        await markChannelHealthSuccess(channel.id);
        results.push({ id: channel.id, username: channel.username, status: "updated", subscribers: subscriberCount });
      } catch (channelErr: any) {
        console.error(`Error processing channel ${channel.id}:`, channelErr);
        results.push({ id: channel.id, username: channel.username, status: "error", error: channelErr.message });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      details: results,
    });
  } catch (error: any) {
    console.error("Subscriber Update Cron Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
