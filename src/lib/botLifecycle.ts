import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";
import { createSystemLog, maskEntityId } from "@/lib/systemLogs";
import { ensureStoredBotWebhookUrl } from "@/lib/botWebhook";

type Db = typeof pool | PoolConnection;

export type BotStatusType = "active" | "paused" | "token_invalid" | "bot_deleted" | "unreachable";
export type BotUserStatusType = "active" | "inactive" | "blocked_bot" | "user_not_found" | "chat_not_found" | "unreachable";

export type TelegramFailure = {
  status: BotUserStatusType | BotStatusType;
  reason: string;
  suggestedFix: string;
  permanent: boolean;
};

function normalize(value: unknown) {
  return String(value || "").toLowerCase();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function botHealthLogHook(_event: string, _payload: Record<string, unknown>) {
  // Future integration point for System Logs, Bot User Health Logs, and Broadcast Logs.
}

export function classifyBotUserSendFailure(description?: string): TelegramFailure | null {
  const text = normalize(description);
  if (!text) return null;
  if (text.includes("blocked by the user") || text.includes("bot was blocked")) {
    return { status: "blocked_bot", reason: "User blocked the bot.", suggestedFix: "User must unblock the bot to receive future ads.", permanent: true };
  }
  if (text.includes("chat not found")) {
    return { status: "chat_not_found", reason: "Telegram chat was not found.", suggestedFix: "User must start the bot again.", permanent: true };
  }
  if (text.includes("user not found")) {
    return { status: "user_not_found", reason: "Telegram user was not found.", suggestedFix: "User must start the bot again.", permanent: true };
  }
  if (text.includes("forbidden") || text.includes("can't initiate conversation") || text.includes("cannot initiate conversation")) {
    return { status: "unreachable", reason: "Bot cannot initiate conversation with this user.", suggestedFix: "User must open the bot and start it again.", permanent: true };
  }
  return null;
}

export function classifyBotTokenFailure(description?: string): TelegramFailure | null {
  const text = normalize(description);
  if (!text) return null;
  if (text.includes("unauthorized") || text.includes("token") || text.includes("not found")) {
    return { status: "token_invalid", reason: "Bot token is invalid.", suggestedFix: "Update the bot token, then reactivate the bot.", permanent: true };
  }
  if (text.includes("bot was deleted") || text.includes("bot deleted")) {
    return { status: "bot_deleted", reason: "Bot appears deleted or unavailable.", suggestedFix: "Create or reconnect the bot, then reactivate.", permanent: true };
  }
  return null;
}

export async function checkBotHealth(bot: { id: number | string; bot_token: string }, db: Db = pool) {
  let lastFailure: TelegramFailure | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${bot.bot_token}/getMe`);
      const data = await response.json().catch(() => ({}));
      if (!data.ok) {
        lastFailure = classifyBotTokenFailure(data.description || `HTTP ${response.status}`) || {
          status: "unreachable" as const,
          reason: data.description || "Bot is unreachable.",
          suggestedFix: "Check bot token and Telegram connectivity, then reactivate.",
          permanent: response.status === 401 || response.status === 404,
        };

        if (attempt < 3) await sleep(500 * attempt);
        continue;
      }

      await db.query(
        "UPDATE bots SET health_status = 'active', health_checked_at = NOW(), failure_reason = NULL WHERE id = ?",
        [bot.id]
      );
      return { ok: true, status: "active" as const, reason: null, suggestedFix: null, permanent: false };
    } catch (error: any) {
      lastFailure = {
        status: "unreachable" as const,
        reason: error?.message || "Bot health check failed.",
        suggestedFix: "Try again later.",
        permanent: false,
      };
      if (attempt < 3) await sleep(500 * attempt);
    }
  }

  const failure = lastFailure || {
    status: "unreachable" as const,
    reason: "Bot health check failed.",
    suggestedFix: "Try again later.",
    permanent: false,
  };
  if (failure.permanent) await autoPauseBot(bot.id, failure, db);
  else await recordBotFailure(bot.id, failure.reason, db);
  return { ok: false, ...failure };
}

export async function autoPauseBot(botId: number | string, failure: TelegramFailure, db: Db = pool) {
  await db.query(
    `UPDATE bots
     SET status = ?,
         paused_reason = ?,
         suggested_fix = ?,
         health_status = ?,
         health_checked_at = NOW(),
         last_failure_at = NOW(),
         failure_reason = ?,
         auto_paused_at = NOW()
     WHERE id = ?`,
    [failure.status, failure.reason, failure.suggestedFix, failure.status, failure.reason, botId]
  );
  await createSystemLog({
    logType: "bot_health",
    status: "failed",
    title: "Bot auto-paused",
    summary: `Bot auto-paused because ${failure.reason}`,
    failedBotsCount: 1,
    failureReasons: { [failure.status]: 1 },
    affectedEntities: { bots: [maskEntityId("bot", botId)] },
    metadata: {
      health_status: failure.status,
      suggested_fix: failure.suggestedFix,
    },
  }, db);
  botHealthLogHook("bot_auto_paused", { bot_id: botId, status: failure.status, reason: failure.reason });
}

export async function recordBotFailure(botId: number | string, reason: string, db: Db = pool) {
  await db.query(
    "UPDATE bots SET last_failure_at = NOW(), failure_reason = ?, health_checked_at = NOW(), health_status = COALESCE(health_status, 'unreachable') WHERE id = ?",
    [reason.slice(0, 255), botId]
  );
}

export async function recordBotBroadcastSuccess(botId: number | string, db: Db = pool) {
  await db.query(
    "UPDATE bots SET last_successful_broadcast_at = NOW(), health_status = 'active', health_checked_at = NOW(), failure_reason = NULL WHERE id = ?",
    [botId]
  );
}

export async function markBotUserInactive(userId: number | string, failure: TelegramFailure, db: Db = pool) {
  const status = ["blocked_bot", "user_not_found", "chat_not_found", "unreachable"].includes(failure.status)
    ? failure.status
    : "inactive";
  await db.query(
    `UPDATE bot_users
     SET is_active = FALSE,
         status = ?,
         inactive_reason = ?,
         last_health_failure_at = NOW()
     WHERE id = ?`,
    [status, failure.reason, userId]
  );
  botHealthLogHook("bot_user_inactive", { bot_user_id: userId, status, reason: failure.reason });
}

export async function markBotUserDeliverySuccess(userId: number | string, db: Db = pool) {
  await db.query(
    "UPDATE bot_users SET is_active = TRUE, status = 'active', inactive_reason = NULL, last_successful_delivery_at = NOW() WHERE id = ?",
    [userId]
  );
}

export async function reactivateBotAfterHealthCheck(
  botId: number | string,
  token: string,
  db: Db = pool,
  origin = ""
) {
  const webhookUrl = await ensureStoredBotWebhookUrl(db, origin, botId, token);
  const health = await checkBotHealth({ id: botId, bot_token: token }, db);
  if (!health.ok) {
    throw new Error(health.reason || "Bot health check failed");
  }
  await db.query(
    `UPDATE bots
     SET status = 'active',
         is_deleted = FALSE,
         paused_reason = NULL,
         suggested_fix = NULL,
         health_status = 'active',
         health_checked_at = NOW(),
         failure_reason = NULL,
         reactivated_at = NOW()
     WHERE id = ?`,
    [botId]
  );
  return { ...health, webhookUrl };
}

export async function sendWithRetries(send: () => Promise<any>) {
  let last: any = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await send();
    if (last?.ok) return { ok: true, result: last, attempts: attempt };
    const permanentUser = classifyBotUserSendFailure(last?.description);
    const permanentBot = classifyBotTokenFailure(last?.description);
    if (permanentUser || permanentBot) return { ok: false, result: last, attempts: attempt, failure: permanentUser || permanentBot };
  }
  return { ok: false, result: last, attempts: 3, failure: null };
}
