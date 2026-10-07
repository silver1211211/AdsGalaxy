import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { createSystemLog, maskEntityId } from "@/lib/systemLogs";
import { enqueueAssetNotification } from "@/lib/platformNotifications";

type Db = typeof pool | PoolConnection;

export type TelegramAccessState =
  | "healthy"
  | "permission_missing"
  | "bot_removed"
  | "channel_not_found"
  | "restricted"
  | "temporarily_unavailable"
  | "identity_mismatch"
  | "unchecked";

export type TelegramAccessCheckSource =
  | "submission"
  | "moderation"
  | "process_ads"
  | "periodic_health"
  | "webhook"
  | "admin_manual_check"
  | "publisher_reactivate"
  | "telegram_send"
  | string;

export type TelegramAccessResult = {
  ok: boolean;
  state: TelegramAccessState;
  reason: string | null;
  reasonCode: string | null;
  checkedAt: Date;
  telegramChatId: string | null;
  username: string | null;
  title: string | null;
  channelType: string | null;
  botRole: string | null;
  canPostMessages: boolean;
  permanent: boolean;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

type TelegramResponse<T = Record<string, unknown>> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { migrate_to_chat_id?: string | number; retry_after?: number };
  httpStatus?: number;
};

type VerifyInput = {
  channelId: number | string;
  chatId?: string | number | null;
  username?: string | null;
  source: TelegramAccessCheckSource;
  persist?: boolean;
  autoPauseActive?: boolean;
};

type PersistInput = {
  channelId: number | string;
  source: TelegramAccessCheckSource;
  autoPauseActive?: boolean;
};

type FailureInput = {
  description?: unknown;
  httpStatus?: unknown;
  errorCode?: unknown;
  retryAfterSeconds?: unknown;
  error?: unknown;
};

export const TELEGRAM_ACCESS_STALE_HOURS = Math.min(
  168,
  Math.max(1, Number(process.env.CHANNEL_TELEGRAM_HEALTH_STALE_HOURS || 24)),
);

const SAFE_REASONS: Record<Exclude<TelegramAccessState, "healthy" | "unchecked">, string> = {
  permission_missing: "Ads Galaxy bot does not have administrator posting permission.",
  bot_removed: "Ads Galaxy bot was removed from the channel.",
  channel_not_found: "Telegram channel could not be found or accessed using its stored identity.",
  restricted: "Telegram has restricted access to this channel.",
  temporarily_unavailable: "Telegram verification is temporarily unavailable.",
  identity_mismatch: "Telegram channel identity does not match the stored channel.",
};

function normalizeUsername(value: unknown) {
  return value ? String(value).replace(/^@/, "").trim() || null : null;
}

function normalizedFailureText(input: FailureInput) {
  const errorText = input.error instanceof Error ? `${input.error.name} ${input.error.message}` : String(input.error || "");
  return `${String(input.description || "")} ${errorText}`.trim().toLowerCase();
}

export function classifyTelegramAccessFailure(input: FailureInput): Omit<TelegramAccessResult, "checkedAt" | "telegramChatId" | "username" | "title" | "channelType" | "botRole" | "canPostMessages"> {
  const text = normalizedFailureText(input);
  const status = Number(input.httpStatus || input.errorCode || 0);
  const retryAfterSeconds = Math.max(0, Number(input.retryAfterSeconds || 0)) || null;
  const make = (state: Exclude<TelegramAccessState, "healthy" | "unchecked">, reasonCode: string, permanent: boolean, retryable: boolean) => ({
    ok: false as const,
    state,
    reason: SAFE_REASONS[state],
    reasonCode,
    permanent,
    retryable,
    retryAfterSeconds,
  });

  if (status === 429 || retryAfterSeconds || /too many requests|retry after|flood[_ ]?wait|rate.?limit/.test(text)) {
    return make("temporarily_unavailable", "telegram_rate_limited", false, true);
  }
  if (/chat_restricted|chat restricted|forbidden:.*restricted/.test(text)) {
    return make("restricted", "chat_restricted", true, false);
  }
  if (/bot was kicked|bot is not a member|bot is not member|bot was blocked|bot removed|status.?[:= ]+kicked|status.?[:= ]+left/.test(text)) {
    return make("bot_removed", "bot_removed", true, false);
  }
  if (/chat_admin_required|need administrator rights|not enough rights|not an administrator|must be an administrator|administrator.*permission|can.?post.?messages/.test(text)) {
    return make("permission_missing", "permission_missing", true, false);
  }
  if (/chat not found|channel_invalid|peer_id_invalid|channel not found|chat_id_invalid/.test(text)) {
    return make("channel_not_found", "channel_not_found", true, false);
  }
  if (status >= 500 || /timeout|timed out|aborterror|econnreset|eai_again|enotfound|network|socket|fetch failed|temporar/.test(text)) {
    return make("temporarily_unavailable", "telegram_temporarily_unavailable", false, true);
  }
  return make("temporarily_unavailable", "telegram_unclassified_error", false, true);
}

async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<TelegramResponse<T>> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    return { ok: false, description: "Telegram bot configuration is unavailable.", httpStatus: 503 };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const body = await response.json() as TelegramResponse<T>;
    return { ...body, httpStatus: response.status };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : "Telegram network error.", httpStatus: 503 };
  }
}

let botIdPromise: Promise<number> | null = null;
async function getBotId() {
  if (!botIdPromise) {
    botIdPromise = telegram<{ id: number }>("getMe", {}).then((response) => {
      if (!response.ok || !response.result?.id) throw new Error(response.description || "Telegram bot identity unavailable.");
      return Number(response.result.id);
    }).catch((error) => {
      botIdPromise = null;
      throw error;
    });
  }
  return botIdPromise;
}

function resultFromFailure(input: FailureInput, partial: Partial<TelegramAccessResult> = {}): TelegramAccessResult {
  const failure = classifyTelegramAccessFailure(input);
  return {
    ...failure,
    checkedAt: new Date(),
    telegramChatId: partial.telegramChatId || null,
    username: partial.username || null,
    title: partial.title || null,
    channelType: partial.channelType || null,
    botRole: partial.botRole || null,
    canPostMessages: false,
  };
}

export function telegramAccessResultFromMembership(input: {
  chatId: string | number;
  username?: string | null;
  title?: string | null;
  channelType?: string | null;
  status?: string | null;
  canPostMessages?: boolean | null;
}): TelegramAccessResult {
  const role = String(input.status || "unknown");
  const canPost = role === "creator" || (role === "administrator" && input.canPostMessages === true);
  if (!canPost) {
    return resultFromFailure({ description: role === "left" || role === "kicked" ? `status=${role}` : "administrator posting permission missing" }, {
      telegramChatId: String(input.chatId), username: normalizeUsername(input.username), title: input.title || null,
      channelType: input.channelType || null, botRole: role,
    });
  }
  return {
    ok: true,
    state: "healthy",
    reason: null,
    reasonCode: null,
    checkedAt: new Date(),
    telegramChatId: String(input.chatId),
    username: normalizeUsername(input.username),
    title: input.title || null,
    channelType: input.channelType || null,
    botRole: role,
    canPostMessages: true,
    permanent: false,
    retryable: false,
    retryAfterSeconds: null,
  };
}

export async function verifyTelegramChannelAccess(input: VerifyInput, db: Db = pool): Promise<TelegramAccessResult> {
  const startedAt = Date.now();
  const username = normalizeUsername(input.username);
  const stableChatId = input.chatId != null && String(input.chatId).trim() && String(input.chatId) !== "0"
    ? String(input.chatId)
    : null;
  const target = stableChatId || (username ? `@${username}` : null);
  let result: TelegramAccessResult;

  if (!target) {
    result = resultFromFailure({ description: "chat not found" });
  } else {
    type TelegramChat = { id: string | number; username?: string; title?: string; type?: string };
    let chatResponse = await telegram<TelegramChat>("getChat", { chat_id: target });
    if (!chatResponse.ok && chatResponse.parameters?.migrate_to_chat_id) {
      chatResponse = await telegram<TelegramChat>("getChat", { chat_id: chatResponse.parameters.migrate_to_chat_id });
    }
    if (!chatResponse.ok || !chatResponse.result) {
      result = resultFromFailure({
        description: chatResponse.description,
        httpStatus: chatResponse.httpStatus,
        errorCode: chatResponse.error_code,
        retryAfterSeconds: chatResponse.parameters?.retry_after,
      }, { telegramChatId: stableChatId, username });
    } else {
      const chat = chatResponse.result;
      const resolvedChatId = String(chat.id);
      if (stableChatId && stableChatId !== resolvedChatId) {
        result = {
          ...resultFromFailure({ description: "identity mismatch" }, { telegramChatId: stableChatId, username }),
          state: "identity_mismatch",
          reason: SAFE_REASONS.identity_mismatch,
          reasonCode: "identity_mismatch",
          permanent: true,
          retryable: false,
        };
      } else {
        const [collisions] = await db.query<RowDataPacket[]>(
          "SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1",
          [resolvedChatId, input.channelId],
        );
        if (collisions[0]) {
          result = {
            ...resultFromFailure({ description: "identity mismatch" }, { telegramChatId: resolvedChatId, username }),
            state: "identity_mismatch",
            reason: SAFE_REASONS.identity_mismatch,
            reasonCode: "identity_conflict",
            permanent: true,
            retryable: false,
          };
        } else {
          try {
            const botId = await getBotId();
            const memberResponse = await telegram<{ status?: string; can_post_messages?: boolean }>("getChatMember", {
              chat_id: resolvedChatId,
              user_id: botId,
            });
            if (!memberResponse.ok || !memberResponse.result) {
              result = resultFromFailure({
                description: memberResponse.description,
                httpStatus: memberResponse.httpStatus,
                errorCode: memberResponse.error_code,
                retryAfterSeconds: memberResponse.parameters?.retry_after,
              }, {
                telegramChatId: resolvedChatId,
                username: normalizeUsername(chat.username),
                title: chat.title || null,
                channelType: chat.type || null,
              });
            } else {
              result = telegramAccessResultFromMembership({
                chatId: resolvedChatId,
                username: chat.username,
                title: chat.title,
                channelType: chat.type,
                status: memberResponse.result.status,
                canPostMessages: memberResponse.result.can_post_messages,
              });
            }
          } catch (error) {
            result = resultFromFailure({ error, httpStatus: 503 }, {
              telegramChatId: resolvedChatId,
              username: normalizeUsername(chat.username),
              title: chat.title || null,
              channelType: chat.type || null,
            });
          }
        }
      }
    }
  }

  if (input.persist !== false) {
    await persistTelegramChannelAccess(input, result, db);
  }
  console.info("telegram_channel_access_check", {
    channel_id: Number(input.channelId), check_source: input.source, new_state: result.state,
    normalized_reason: result.reasonCode, permanent: result.permanent, retryable: result.retryable,
    auto_pause_requested: Boolean(input.autoPauseActive), duration_ms: Date.now() - startedAt,
  });
  return result;
}

function statusForPermanentState(state: TelegramAccessState) {
  if (state === "bot_removed" || state === "permission_missing" || state === "channel_not_found") return state;
  return "paused";
}

export async function persistTelegramChannelAccess(input: PersistInput, result: TelegramAccessResult, db: Db = pool) {
  const [rows] = await db.query<Array<RowDataPacket & {
    id: number; user_id: number; status: string; title: string; chat_id: string | number | null;
    username: string | null; channel_type: string | null; telegram_access_state: string | null;
    telegram_access_version: number;
  }>>(
    "SELECT id,user_id,status,title,chat_id,username,channel_type,telegram_access_state,telegram_access_version FROM channels WHERE id=? AND is_deleted=FALSE LIMIT 1",
    [input.channelId],
  );
  const channel = rows[0];
  if (!channel) return { autoPaused: false, stateChanged: false };
  const previousState = String(channel.telegram_access_state || "unchecked");
  const stateChanged = previousState !== result.state;
  const safeReason = result.reason ? result.reason.slice(0, 255) : null;

  if (result.ok) {
    await db.query(
      `UPDATE channels SET
         chat_id=COALESCE(?,chat_id),username=COALESCE(?,username),title=COALESCE(NULLIF(?,''),title),
         telegram_access_state='healthy',telegram_access_version=telegram_access_version+IF(COALESCE(telegram_access_state,'unchecked')='healthy',0,1),
         health_status='healthy',health_checked_at=UTC_TIMESTAMP(6),failure_reason=NULL,health_failure_reason=NULL
       WHERE id=? AND is_deleted=FALSE`,
      [result.telegramChatId, result.username, result.title, input.channelId],
    );
  } else {
    await db.query(
      `UPDATE channels SET
         chat_id=CASE WHEN chat_id IS NULL OR chat_id=0 THEN COALESCE(?,chat_id) ELSE chat_id END,
         username=COALESCE(?,username),title=COALESCE(NULLIF(?,''),title),
         telegram_access_state=?,telegram_access_version=telegram_access_version+IF(COALESCE(telegram_access_state,'unchecked')=?,0,1),
         health_status=?,health_checked_at=UTC_TIMESTAMP(6),last_failure_at=UTC_TIMESTAMP(6),
         failure_reason=?,health_failure_reason=?
       WHERE id=? AND is_deleted=FALSE`,
      [result.telegramChatId, result.username, result.title, result.state, result.state,
        result.permanent ? "critical" : "warning", safeReason, safeReason, input.channelId],
    );
  }

  const identityChatId = result.telegramChatId || (channel.chat_id != null ? String(channel.chat_id) : null);
  if (identityChatId) {
    const nextRetryAt = result.retryable
      ? new Date(Date.now() + Math.max(60, result.retryAfterSeconds || 15 * 60) * 1000)
      : null;
    await db.query(
      `INSERT INTO channel_telegram_identities
        (channel_id,telegram_chat_id,channel_type,current_username,bot_member_status,bot_can_post,verification_state,
         consecutive_failure_count,first_failure_at,last_failure_at,last_verified_at,last_success_at,last_checked_at,
         next_retry_at,last_failure_code,last_failure_reason,last_check_source)
       VALUES (?,?,?,?,?,?,?,IF(?='healthy',0,1),IF(?='healthy',NULL,UTC_TIMESTAMP(6)),IF(?='healthy',NULL,UTC_TIMESTAMP(6)),
         IF(?='healthy',UTC_TIMESTAMP(6),NULL),IF(?='healthy',UTC_TIMESTAMP(6),NULL),UTC_TIMESTAMP(6),?,?,?,?)
       ON DUPLICATE KEY UPDATE
         telegram_chat_id=VALUES(telegram_chat_id),channel_type=VALUES(channel_type),
         previous_username=IF(NOT(current_username<=>VALUES(current_username)),current_username,previous_username),
         last_username_changed_at=IF(NOT(current_username<=>VALUES(current_username)),UTC_TIMESTAMP(6),last_username_changed_at),
         current_username=COALESCE(VALUES(current_username),current_username),bot_member_status=VALUES(bot_member_status),
         bot_can_post=VALUES(bot_can_post),verification_state=VALUES(verification_state),
         consecutive_failure_count=IF(VALUES(verification_state)='healthy',0,consecutive_failure_count+1),
         first_failure_at=IF(VALUES(verification_state)='healthy',NULL,COALESCE(first_failure_at,UTC_TIMESTAMP(6))),
         last_failure_at=IF(VALUES(verification_state)='healthy',NULL,UTC_TIMESTAMP(6)),
         last_verified_at=IF(VALUES(verification_state)='healthy',UTC_TIMESTAMP(6),last_verified_at),
         last_success_at=IF(VALUES(verification_state)='healthy',UTC_TIMESTAMP(6),last_success_at),
         last_checked_at=UTC_TIMESTAMP(6),next_retry_at=VALUES(next_retry_at),
         last_failure_code=VALUES(last_failure_code),last_failure_reason=VALUES(last_failure_reason),last_check_source=VALUES(last_check_source)`,
      [
        input.channelId, identityChatId,
        result.channelType === "public" || result.channelType === "private"
          ? result.channelType
          : channel.channel_type || (result.username ? "public" : "private"),
        result.username || channel.username, result.botRole, result.canPostMessages ? 1 : 0, result.state,
        result.state, result.state, result.state, result.state, result.state,
        nextRetryAt, result.reasonCode, result.reason ? result.reason.slice(0, 500) : null, String(input.source).slice(0, 32),
      ],
    );
  }

  let autoPaused = false;
  if (!result.ok && result.permanent && input.autoPauseActive && channel.status === "active") {
    const nextStatus = statusForPermanentState(result.state);
    const [transition] = await db.query<ResultSetHeader>(
      `UPDATE channels SET status=?,paused_reason=?,suggested_fix=?,auto_paused_at=UTC_TIMESTAMP(6),
         telegram_access_previous_status=COALESCE(telegram_access_previous_status,'active'),
         notification_state_version=notification_state_version+1
       WHERE id=? AND is_deleted=FALSE AND status='active'`,
      [nextStatus, safeReason, result.state === "bot_removed"
        ? "Re-add Ads Galaxy bot as an administrator with posting permission, then resume manually."
        : "Restore Ads Galaxy bot administrator posting permission, then resume manually.", input.channelId],
    );
    autoPaused = transition.affectedRows > 0;
    if (autoPaused) {
      const [[updated]] = await db.query<Array<RowDataPacket & { notification_state_version: number }>>(
        "SELECT notification_state_version FROM channels WHERE id=? LIMIT 1", [input.channelId],
      );
      await enqueueAssetNotification(db, {
        assetType: "channel", assetId: Number(input.channelId), userId: Number(channel.user_id),
        event: "access_removed", name: channel.title,
        version: Number(updated?.notification_state_version || channel.telegram_access_version + 1),
      });
      await createSystemLog({
        logType: "channel_health", status: "failed", title: "Channel auto-paused",
        summary: `Channel auto-paused because ${safeReason || result.state}`,
        autoPausedCount: 1, failedCount: 1, failureReasons: { [result.state]: 1 },
        affectedEntities: { channels: [maskEntityId("channel", input.channelId)] },
        metadata: { telegram_access_state: result.state, reason_code: result.reasonCode, check_source: input.source },
      }, db);
    }
  }

  console.info("telegram_channel_access_persisted", {
    channel_id: Number(input.channelId), check_source: input.source, previous_state: previousState,
    new_state: result.state, normalized_reason: result.reasonCode, permanent: result.permanent,
    retryable: result.retryable, auto_paused: autoPaused,
  });
  return { autoPaused, stateChanged };
}

export async function persistTelegramMembershipUpdate(input: PersistInput & {
  chatId: string | number;
  username?: string | null;
  title?: string | null;
  channelType?: string | null;
  status?: string | null;
  canPostMessages?: boolean | null;
}, db: Db = pool) {
  const result = telegramAccessResultFromMembership({
    chatId: input.chatId, username: input.username, title: input.title, channelType: input.channelType,
    status: input.status, canPostMessages: input.canPostMessages,
  });
  await persistTelegramChannelAccess(input, result, db);
  return result;
}
