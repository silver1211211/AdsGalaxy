import pool from "@/lib/db";
import { escapeTelegramHtml } from "@/lib/telegram";
import { dispatchPlatformNotifications, enqueuePlatformNotification } from "@/lib/platformNotifications";

type EntityType = "withdrawal" | "channel" | "miniapp" | "bot";

// Durable, idempotent and best-effort. Business actions never roll back when
// Telegram is unavailable; the notification worker safely retries the event.
async function notify(
  telegramId: unknown,
  message: string,
  event: { entityType: EntityType; entityId: number | string; eventType: string }
) {
  try {
    if (!telegramId) return;
    const [[user]] = await pool.query<Array<import("mysql2/promise").RowDataPacket & { id: number }>>(
      "SELECT id FROM users WHERE telegram_id=? LIMIT 1", [String(telegramId)]);
    if (!user) return;
    await enqueuePlatformNotification(pool, {
      eventKey: `${event.eventType}:${event.entityType}:${event.entityId}`,
      userId: Number(user.id), eventType: event.eventType, entityType: event.entityType,
      entityId: event.entityId, messageHtml: message,
    });
    void dispatchPlatformNotifications(10).catch((error) => console.error("Notification dispatch failed", error));
  } catch (error) {
    console.error(`Notification enqueue failed (${event.eventType}):`, error instanceof Error ? error.message : error);
  }
}

function money(value: unknown) {
  return `$${Number(value || 0).toFixed(2)}`;
}

// ── Withdrawals ───────────────────────────────────────────────────────────

export async function notifyWithdrawalPaid(telegramId: unknown, input: { withdrawalId?: number | string; amount: unknown; network?: string | null }) {
  const networkLine = input.network ? `Network: <b>${escapeTelegramHtml(input.network)}</b>\n` : "";
  const message =
    `🚀 <b>Withdrawal Completed</b>\n\n` +
    `Amount: <b>${money(input.amount)}</b>\n` +
    networkLine +
    `\nYour withdrawal has been successfully processed and sent.\n\n` +
    `Thank you for using AdsGalaxy.`;
  await notify(telegramId, message, { entityType: "withdrawal", entityId: input.withdrawalId || "unknown", eventType: "withdrawal_paid" });
}

export async function notifyWithdrawalRejected(telegramId: unknown, input: { withdrawalId?: number | string; amount: unknown; reason?: string | null; refunded: boolean }) {
  const reasonLine = input.reason ? `Reason: <b>${escapeTelegramHtml(input.reason)}</b>\n\n` : "\n";
  const refundLine = input.refunded
    ? "The withdrawal amount has been returned to your available balance."
    : "Contact support if you believe this is a mistake.";
  const message =
    `❌ <b>Withdrawal Rejected</b>\n\n` +
    `Amount: <b>${money(input.amount)}</b>\n` +
    reasonLine +
    refundLine;
  await notify(telegramId, message, { entityType: "withdrawal", entityId: input.withdrawalId || "unknown", eventType: "withdrawal_rejected" });
}

// ── Channels ──────────────────────────────────────────────────────────────

export async function notifyChannelSubmitted(telegramId: unknown, channelId: number | string, title?: string) {
  await notify(
    telegramId,
    `🕒 <b>Channel Submitted for Review</b>\n\nYour channel "<b>${escapeTelegramHtml(title)}</b>" has been submitted and is now pending review.\n\nWe'll notify you as soon as it's approved.`,
    { entityType: "channel", entityId: channelId, eventType: "channel_submitted" }
  );
}

export async function notifyChannelApproved(telegramId: unknown, channelId: number | string, title?: string) {
  await notify(
    telegramId,
    `✅ <b>Channel Approved</b>\n\nYour channel "<b>${escapeTelegramHtml(title)}</b>" has been approved and is now active in the AdsGalaxy advertising network.\n\nYou can start receiving sponsored campaigns right away.`,
    { entityType: "channel", entityId: channelId, eventType: "channel_approved" }
  );
}

export async function notifyChannelRejected(telegramId: unknown, channelId: number | string, title?: string) {
  await notify(
    telegramId,
    `❌ <b>Channel Rejected</b>\n\nYour channel "<b>${escapeTelegramHtml(title)}</b>" was not approved for monetization at this time.\n\nReview our publisher guidelines and resubmit once the issue is resolved.`,
    { entityType: "channel", entityId: channelId, eventType: "channel_rejected" }
  );
}

export async function notifyChannelRemoved(telegramId: unknown, channelId: number | string, title?: string) {
  await notify(
    telegramId,
    `🗑️ <b>Channel Removed</b>\n\nYour channel "<b>${escapeTelegramHtml(title)}</b>" has been removed from AdsGalaxy and will no longer receive campaigns.\n\nYou can add it again at any time if you'd like to resume monetization.`,
    { entityType: "channel", entityId: channelId, eventType: "channel_removed" }
  );
}

export async function notifyChannelPaused(telegramId: unknown, channelId: number | string, title?: string, version: number | string = 1) {
  await notify(telegramId, `<b>Channel paused</b>\n\n“${escapeTelegramHtml(title)}” is not earning right now. Activate it again to continue monetizing.`,
    { entityType: "channel", entityId: `${channelId}:${version}`, eventType: "channel_paused" });
}

// ── Mini Apps ─────────────────────────────────────────────────────────────

export async function notifyMiniAppSubmitted(telegramId: unknown, miniAppId: number | string, name?: string) {
  await notify(
    telegramId,
    `🕒 <b>Mini App Submitted for Review</b>\n\nYour Mini App "<b>${escapeTelegramHtml(name)}</b>" has been submitted and is now pending review.\n\nWe'll notify you as soon as it's approved.`,
    { entityType: "miniapp", entityId: miniAppId, eventType: "miniapp_submitted" }
  );
}

export async function notifyMiniAppApproved(telegramId: unknown, miniAppId: number | string, name?: string) {
  await notify(
    telegramId,
    `✅ <b>Mini App Approved</b>\n\nYour Mini App "<b>${escapeTelegramHtml(name)}</b>" has been approved and is now eligible to serve ads.\n\nMake sure the AdsGalaxy SDK is integrated to start earning.`,
    { entityType: "miniapp", entityId: miniAppId, eventType: "miniapp_approved" }
  );
}

export async function notifyMiniAppRejected(telegramId: unknown, miniAppId: number | string, name?: string) {
  await notify(
    telegramId,
    `❌ <b>Mini App Rejected</b>\n\nYour Mini App "<b>${escapeTelegramHtml(name)}</b>" was not approved for monetization at this time.\n\nReview our publisher guidelines and resubmit once the issue is resolved.`,
    { entityType: "miniapp", entityId: miniAppId, eventType: "miniapp_rejected" }
  );
}

export async function notifyMiniAppRemoved(telegramId: unknown, miniAppId: number | string, name?: string) {
  await notify(
    telegramId,
    `🗑️ <b>Mini App Removed</b>\n\nYour Mini App "<b>${escapeTelegramHtml(name)}</b>" has been removed from AdsGalaxy and will no longer serve ads.\n\nContact support if you believe this was unexpected.`,
    { entityType: "miniapp", entityId: miniAppId, eventType: "miniapp_removed" }
  );
}

export async function notifyMiniAppPaused(telegramId: unknown, miniAppId: number | string, name?: string, version: number | string = 1) {
  await notify(telegramId, `<b>Mini App paused</b>\n\n“${escapeTelegramHtml(name)}” is not earning right now. Activate it again to continue monetizing.`,
    { entityType: "miniapp", entityId: `${miniAppId}:${version}`, eventType: "miniapp_paused" });
}

// ── Bots ──────────────────────────────────────────────────────────────────

export async function notifyBotSubmitted(telegramId: unknown, botId: number | string, botUsername?: string) {
  await notify(
    telegramId,
    `🕒 <b>Bot Submitted for Review</b>\n\nYour bot @${escapeTelegramHtml(botUsername)} has been submitted and is now pending review.\n\nWe'll notify you as soon as it's approved.`,
    { entityType: "bot", entityId: botId, eventType: "bot_submitted" }
  );
}

export async function notifyBotApproved(telegramId: unknown, botId: number | string, botUsername?: string) {
  await notify(
    telegramId,
    `🤖 <b>Bot Approved</b>\n\nYour bot @${escapeTelegramHtml(botUsername)} has been approved for monetization.\n\nYou can now start serving ads to your bot's users.`,
    { entityType: "bot", entityId: botId, eventType: "bot_approved" }
  );
}

export async function notifyBotRejected(telegramId: unknown, botId: number | string, botUsername?: string) {
  await notify(
    telegramId,
    `❌ <b>Bot Rejected</b>\n\nYour bot @${escapeTelegramHtml(botUsername)} was not approved for monetization at this time.\n\nReview our publisher guidelines and resubmit once the issue is resolved.`,
    { entityType: "bot", entityId: botId, eventType: "bot_rejected" }
  );
}

export async function notifyBotRemoved(telegramId: unknown, botId: number | string, botUsername?: string) {
  await notify(
    telegramId,
    `🗑️ <b>Bot Removed</b>\n\nYour bot @${escapeTelegramHtml(botUsername)} has been removed from AdsGalaxy and will no longer serve ads.\n\nAdd it again anytime if you'd like to resume monetization.`,
    { entityType: "bot", entityId: botId, eventType: "bot_removed" }
  );
}

export async function notifyBotPaused(telegramId: unknown, botId: number | string, botUsername?: string, version: number | string = 1) {
  await notify(telegramId, `<b>Bot paused</b>\n\n@${escapeTelegramHtml(botUsername)} is not earning right now. Activate it again to continue monetizing.`,
    { entityType: "bot", entityId: `${botId}:${version}`, eventType: "bot_paused" });
}
