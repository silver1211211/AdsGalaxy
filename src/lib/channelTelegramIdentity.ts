import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;

type VerifyIdentityInput = {
  channelId: number | string;
  chatId?: string | number | null;
  username?: string | null;
  source: string;
};

type TelegramResponse<T = Record<string, unknown>> = {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { migrate_to_chat_id?: string | number; retry_after?: number };
};

function normalizeUsername(value: unknown) {
  return value ? String(value).replace(/^@/, "").trim() || null : null;
}

async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<TelegramResponse<T>> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  return response.json() as Promise<TelegramResponse<T>>;
}

export async function verifyAndStoreChannelIdentity(input: VerifyIdentityInput, db: Db = pool) {
  const username = normalizeUsername(input.username);
  const attempts: Array<string | number> = [];
  if (input.chatId != null && String(input.chatId).trim() && String(input.chatId) !== "0") attempts.push(input.chatId);
  if (username) attempts.push("@" + username);
  if (!attempts.length) throw new Error("Channel requires a Telegram chat_id or username before activation.");

  let chat: { id: string | number; username?: string; title?: string; type?: string } | undefined;
  let lastReason = "Telegram channel could not be resolved.";
  for (const target of attempts) {
    let response = await telegram<typeof chat>("getChat", { chat_id: target });
    if (!response.ok && response.parameters?.migrate_to_chat_id) {
      response = await telegram<typeof chat>("getChat", { chat_id: response.parameters.migrate_to_chat_id });
    }
    if (response.ok && response.result) {
      chat = response.result;
      break;
    }
    lastReason = response.description || lastReason;
  }
  if (!chat) throw new Error(lastReason);

  const [collisions] = await db.query<RowDataPacket[]>(
    "SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1",
    [String(chat.id), input.channelId],
  );
  if (collisions[0]) throw new Error("Resolved Telegram chat_id is already assigned to another channel.");

  const me = await telegram<{ id: number }>("getMe", {});
  if (!me.ok || !me.result?.id) throw new Error(me.description || "Ads Galaxy bot identity is unavailable.");
  let member = await telegram<{
    status?: string;
    can_post_messages?: boolean;
    user?: { id?: number };
  }>("getChatMember", { chat_id: chat.id, user_id: me.result.id });

  if (!member.ok && String(member.description || "").toLowerCase().includes("member list is inaccessible")) {
    const administrators = await telegram<Array<{
      status?: string;
      can_post_messages?: boolean;
      user?: { id?: number };
    }>>("getChatAdministrators", { chat_id: chat.id });
    const botAdmin = administrators.ok
      ? administrators.result?.find((entry) => String(entry.user?.id) === String(me.result?.id))
      : undefined;
    member = botAdmin
      ? { ok: true, result: botAdmin }
      : { ok: false, description: "Channel exists but Ads Galaxy bot is not an administrator." };
  }

  if (!member.ok || !member.result) throw new Error(member.description || "Unable to verify Ads Galaxy bot access.");
  const status = String(member.result.status || "unknown");
  const canPost = status === "creator"
    || (status === "administrator" && member.result.can_post_messages !== false);
  if (!canPost) throw new Error(
    status === "left" || status === "kicked"
      ? "Ads Galaxy bot is not a member of the channel."
      : "Ads Galaxy bot must be an administrator with posting permission.",
  );

  const currentUsername = normalizeUsername(chat.username);
  await db.query(
    "UPDATE channels SET chat_id=?,username=?,title=COALESCE(NULLIF(?,''),title),health_status='healthy',health_checked_at=UTC_TIMESTAMP(6),failure_reason=NULL WHERE id=?",
    [String(chat.id), currentUsername, String(chat.title || "").slice(0, 255), input.channelId],
  );
  await db.query(
    "INSERT INTO channel_telegram_identities (channel_id,telegram_chat_id,channel_type,current_username,bot_member_status,bot_can_post,verification_state,consecutive_failure_count,last_verified_at,last_success_at,last_checked_at,next_retry_at,last_failure_code,last_failure_reason,last_check_source) VALUES (?,?,?,?,?,1,'healthy',0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),NULL,NULL,NULL,?) ON DUPLICATE KEY UPDATE telegram_chat_id=VALUES(telegram_chat_id),channel_type=VALUES(channel_type),previous_username=IF(NOT(current_username<=>VALUES(current_username)),current_username,previous_username),last_username_changed_at=IF(NOT(current_username<=>VALUES(current_username)),UTC_TIMESTAMP(6),last_username_changed_at),current_username=VALUES(current_username),bot_member_status=VALUES(bot_member_status),bot_can_post=1,verification_state='healthy',consecutive_failure_count=0,first_failure_at=NULL,last_failure_at=NULL,last_verified_at=UTC_TIMESTAMP(6),last_success_at=UTC_TIMESTAMP(6),last_checked_at=UTC_TIMESTAMP(6),next_retry_at=NULL,last_failure_code=NULL,last_failure_reason=NULL,last_check_source=VALUES(last_check_source)",
    [
      input.channelId,
      String(chat.id),
      chat.type === "channel" ? "public" : "private",
      currentUsername,
      status,
      input.source.slice(0, 32),
    ],
  );
  return { chatId: String(chat.id), username: currentUsername, title: chat.title || null, status, canPost: true };
}
