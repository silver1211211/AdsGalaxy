import { recordChannelStatusTransitionAudit } from "@/lib/channelStatusAudit";
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

export type TelegramAccessEvidenceCategory = "confirmed" | "uncertain" | "temporary";

export type TelegramAccessCheckSource =
  | "submission"
  | "moderation"
  | "process_ads"
  | "periodic_health"
  | "webhook"
  | "admin_manual_check"
  | "publisher_reactivate"
  | "telegram_send"
  | "automatic_recovery"
  | "identity_reconciliation"
  | "missing_id_repair"
  | string;

export type TelegramAccessResult = {
  ok: boolean;
  state: TelegramAccessState;
  reason: string | null;
  reasonCode: string | null;
  evidenceCategory?: TelegramAccessEvidenceCategory;
  checkedAt: Date;
  telegramChatId: string | null;
  migratedFromChatId?: string | null;
  conflictingChannelId?: number | null;
  conflictingChatId?: string | null;
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
  expectedVersion?: number | null;
  checkUsernameConflict?: boolean;
};

type PersistInput = {
  channelId: number | string;
  source: TelegramAccessCheckSource;
  autoPauseActive?: boolean;
  expectedVersion?: number | null;
};

type FailureInput = {
  description?: unknown;
  httpStatus?: unknown;
  errorCode?: unknown;
  retryAfterSeconds?: unknown;
  error?: unknown;
  confirmedUnavailable?: boolean;
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

const PERMANENT_NUMERIC_CHAT_ID_REGEX = /^-[1-9]\d*$/;

export function isPermanentNumericChannelChatId(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s || s === "0") return false;
  return PERMANENT_NUMERIC_CHAT_ID_REGEX.test(s);
}

function normalizeUsername(value: unknown) {
  return value ? String(value).replace(/^https?:\/\/t\.me\//i, "").replace(/^@+/, "").split(/[/?#]/)[0].trim() || null : null;
}

function normalizedFailureText(input: FailureInput) {
  const errorText = input.error instanceof Error ? `${input.error.name} ${input.error.message}` : String(input.error || "");
  return `${String(input.description || "")} ${errorText}`.trim().toLowerCase();
}

export function classifyTelegramEvidenceCategory(input: {
  ok?: boolean;
  permanent?: boolean;
  reasonCode?: string | null;
}): TelegramAccessEvidenceCategory {
  if (input.ok || input.permanent) return "confirmed";
  const code = String(input.reasonCode || "").toLowerCase();
  if (
    code === "chat_not_found_unconfirmed" ||
    code === "member_list_inaccessible" ||
    code === "incomplete_membership_response"
  ) {
    return "uncertain";
  }
  return "temporary";
}

export function classifyTelegramAccessFailure(input: FailureInput): Omit<TelegramAccessResult, "checkedAt" | "telegramChatId" | "username" | "title" | "channelType" | "botRole" | "canPostMessages"> {
  const text = normalizedFailureText(input);
  const status = Number(input.httpStatus || input.errorCode || 0);
  const parsedRetryAfter = (() => {
    if (Number(input.retryAfterSeconds || 0) > 0) return Math.max(0, Number(input.retryAfterSeconds));
    const match = text.match(/retry after\s+(\d+)|flood[_ ]?wait[_ ]?(\d+)/i);
    return match ? Math.max(0, Number(match[1] || match[2] || 0)) : 0;
  })();
  const retryAfterSeconds = parsedRetryAfter || null;
  const make = (state: Exclude<TelegramAccessState, "healthy" | "unchecked">, reasonCode: string, permanent: boolean, retryable: boolean) => ({
    ok: false as const,
    state,
    reason: SAFE_REASONS[state],
    reasonCode,
    evidenceCategory: classifyTelegramEvidenceCategory({ ok: false, permanent, reasonCode }),
    permanent,
    retryable,
    retryAfterSeconds,
  });

  if (status === 429 || retryAfterSeconds || /too many requests|retry after|flood[_ ]?wait|rate.?limit/.test(text)) {
    return make("temporarily_unavailable", "telegram_rate_limited", false, true);
  }
  if (/member list is inaccessible/.test(text)) {
    return make("temporarily_unavailable", "member_list_inaccessible", false, true);
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
    if (input.confirmedUnavailable) {
      return make("channel_not_found", "channel_not_found", true, false);
    }
    return make("channel_not_found", "chat_not_found_unconfirmed", false, true);
  }
  if (/incomplete or malformed telegram membership response/.test(text)) {
    return make("temporarily_unavailable", "incomplete_membership_response", false, true);
  }
  if (/temporary missing target identifier/.test(text)) {
    return make("temporarily_unavailable", "missing_target_identifier", false, true);
  }
  if (status >= 500 || /timeout|timed out|aborterror|econnreset|eai_again|enotfound|network|socket|fetch failed|temporar|bad gateway|service unavailable|gateway timeout|internal server error|incomplete|malformed|invalid json/.test(text)) {
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
    migratedFromChatId: partial.migratedFromChatId || null,
    conflictingChannelId: partial.conflictingChannelId ?? null,
    conflictingChatId: partial.conflictingChatId || null,
    username: partial.username || null,
    title: partial.title || null,
    channelType: partial.channelType || null,
    botRole: partial.botRole || null,
    canPostMessages: false,
  };
}

export function telegramAccessResultFromMembership(input: {
  chatId: string | number;
  migratedFromChatId?: string | null;
  username?: string | null;
  title?: string | null;
  channelType?: string | null;
  status?: string | null;
  canPostMessages?: boolean | null;
}): TelegramAccessResult {
  const role = String(input.status || "").trim().toLowerCase() || "unknown";
  const canPost = role === "creator" || (role === "administrator" && input.canPostMessages === true);
  if (!canPost) {
    if (role === "left" || role === "kicked") {
      return resultFromFailure({ description: `status=${role}` }, {
        telegramChatId: String(input.chatId), migratedFromChatId: input.migratedFromChatId || null,
        username: normalizeUsername(input.username), title: input.title || null,
        channelType: input.channelType || null, botRole: role,
      });
    }
    if (role === "member" || role === "restricted" || (role === "administrator" && input.canPostMessages === false)) {
      return resultFromFailure({ description: "administrator posting permission missing" }, {
        telegramChatId: String(input.chatId), migratedFromChatId: input.migratedFromChatId || null,
        username: normalizeUsername(input.username), title: input.title || null,
        channelType: input.channelType || null, botRole: role,
      });
    }
    return resultFromFailure({ description: "incomplete or malformed telegram membership response", httpStatus: 502 }, {
      telegramChatId: String(input.chatId), migratedFromChatId: input.migratedFromChatId || null,
      username: normalizeUsername(input.username), title: input.title || null,
      channelType: input.channelType || null, botRole: role,
    });
  }
  return {
    ok: true,
    state: "healthy",
    reason: null,
    reasonCode: null,
    evidenceCategory: "confirmed",
    checkedAt: new Date(),
    telegramChatId: String(input.chatId),
    migratedFromChatId: input.migratedFromChatId || null,
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
  let stableChatId = isPermanentNumericChannelChatId(input.chatId)
    ? String(input.chatId).trim()
    : null;
  let expectedVersion = input.expectedVersion;
  if (input.persist !== false && expectedVersion === undefined && input.channelId) {
    try {
      const [verRows] = await db.query<Array<RowDataPacket & { telegram_access_version: number }>>(
        "SELECT telegram_access_version FROM channels WHERE id=? LIMIT 1",
        [input.channelId],
      );
      if (verRows[0]) expectedVersion = Number(verRows[0].telegram_access_version || 0);
    } catch {
      // Non-fatal if pre-read fails
    }
  }
  if (!stableChatId && input.chatId === undefined && input.channelId) {
    try {
      const [storedRows] = await db.query<Array<RowDataPacket & { chat_id?: string | number | null }>>(
        "SELECT id,user_id,status,title,chat_id,username,channel_type,telegram_access_state,telegram_access_version,health_checked_at,reactivated_at,failure_reason FROM channels WHERE id=? AND is_deleted=FALSE LIMIT 1",
        [input.channelId],
      );
      if (storedRows[0] && isPermanentNumericChannelChatId(storedRows[0].chat_id)) {
        stableChatId = String(storedRows[0].chat_id).trim();
      }
    } catch {
      // Non-fatal if pre-read fails
    }
  }

  const target = stableChatId || (username ? `@${username}` : null);
  let result: TelegramAccessResult;

  if (!target) {
    result = resultFromFailure({ description: "temporary missing target identifier", httpStatus: 503 });
  } else {
    type TelegramChat = { id: string | number; username?: string; title?: string; type?: string };
    let migratedFromChatId: string | null = null;
    let migratedTargetChatId: string | null = null;
    let usernamePointedToDifferentChatId: string | null = null;

    let chatResponse = await telegram<TelegramChat>("getChat", { chat_id: target });
    if (!chatResponse.ok && chatResponse.parameters?.migrate_to_chat_id) {
      migratedTargetChatId = String(chatResponse.parameters.migrate_to_chat_id).trim();
      if (isPermanentNumericChannelChatId(migratedTargetChatId)) {
        migratedFromChatId = stableChatId || null;
        chatResponse = await telegram<TelegramChat>("getChat", { chat_id: migratedTargetChatId });
      }
    }
    if (!chatResponse.ok && stableChatId && username) {
      const initialFail = classifyTelegramAccessFailure({
        description: chatResponse.description,
        httpStatus: chatResponse.httpStatus,
        errorCode: chatResponse.error_code,
        retryAfterSeconds: chatResponse.parameters?.retry_after,
      });
      if (initialFail.reasonCode === "chat_not_found_unconfirmed") {
        const altResponse = await telegram<TelegramChat>("getChat", { chat_id: `@${username}` });
        if (altResponse.ok && altResponse.result) {
          const altId = String(altResponse.result.id).trim();
          if (altId === stableChatId) {
            chatResponse = altResponse;
          } else {
            usernamePointedToDifferentChatId = altId;
          }
        }
      }
    }

    if (usernamePointedToDifferentChatId) {
      result = {
        ...resultFromFailure({ description: "identity mismatch" }, {
          telegramChatId: stableChatId,
          conflictingChatId: usernamePointedToDifferentChatId,
          username,
        }),
        state: "identity_mismatch",
        reason: SAFE_REASONS.identity_mismatch,
        reasonCode: "username_points_to_different_chat",
        evidenceCategory: "confirmed",
        permanent: true,
        retryable: false,
      };
    } else if (!chatResponse.ok || !chatResponse.result) {
      result = resultFromFailure({
        description: chatResponse.description,
        httpStatus: chatResponse.httpStatus,
        errorCode: chatResponse.error_code,
        retryAfterSeconds: chatResponse.parameters?.retry_after,
      }, { telegramChatId: stableChatId, username });
    } else {
      const chat = chatResponse.result;
      const resolvedChatId = String(chat.id).trim();
      const isAuthorizedMigration = Boolean(
        migratedFromChatId && migratedTargetChatId && resolvedChatId === migratedTargetChatId
      );

      if (!isPermanentNumericChannelChatId(resolvedChatId)) {
        result = resultFromFailure(
          { description: "incomplete or malformed telegram membership response", httpStatus: 502 },
          { telegramChatId: stableChatId, username },
        );
      } else if (stableChatId && stableChatId !== resolvedChatId && !isAuthorizedMigration) {
        result = {
          ...resultFromFailure({ description: "identity mismatch" }, {
            telegramChatId: stableChatId,
            conflictingChatId: resolvedChatId,
            username,
          }),
          state: "identity_mismatch",
          reason: SAFE_REASONS.identity_mismatch,
          reasonCode: "identity_mismatch",
          evidenceCategory: "confirmed",
          permanent: true,
          retryable: false,
        };
      } else {
        let usernameConflictChatId: string | null = null;
        if (
          input.checkUsernameConflict &&
          stableChatId &&
          username &&
          normalizeUsername(chat.username) &&
          normalizeUsername(chat.username)?.toLowerCase() !== username.toLowerCase()
        ) {
          const handleCheck = await telegram<TelegramChat>("getChat", { chat_id: `@${username}` });
          if (handleCheck.ok && handleCheck.result && String(handleCheck.result.id).trim() !== resolvedChatId) {
            usernameConflictChatId = String(handleCheck.result.id).trim();
          }
        }

        if (usernameConflictChatId) {
          result = {
            ...resultFromFailure({ description: "identity mismatch" }, {
              telegramChatId: stableChatId,
              conflictingChatId: usernameConflictChatId,
              username: normalizeUsername(chat.username) || username,
            }),
            state: "identity_mismatch",
            reason: SAFE_REASONS.identity_mismatch,
            reasonCode: "username_points_to_different_chat",
            evidenceCategory: "confirmed",
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
              ...resultFromFailure({ description: "identity mismatch" }, {
                telegramChatId: stableChatId || null,
                conflictingChannelId: Number(collisions[0].id),
                conflictingChatId: resolvedChatId,
                username,
              }),
              state: "identity_mismatch",
              reason: SAFE_REASONS.identity_mismatch,
              reasonCode: "identity_conflict",
              evidenceCategory: "confirmed",
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
                  migratedFromChatId,
                  username: normalizeUsername(chat.username),
                  title: chat.title || null,
                  channelType: chat.type || null,
                });
              } else {
                result = telegramAccessResultFromMembership({
                  chatId: resolvedChatId,
                  migratedFromChatId,
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
                migratedFromChatId,
                username: normalizeUsername(chat.username),
                title: chat.title || null,
                channelType: chat.type || null,
              });
            }
          }
        }
      }
    }
  }

  if (input.persist !== false) {
    await persistTelegramChannelAccess({ ...input, expectedVersion }, result, db);
  }
  console.info("telegram_channel_access_check", {
    channel_id: Number(input.channelId), check_source: input.source, new_state: result.state,
    normalized_reason: result.reasonCode, evidence_category: result.evidenceCategory,
    permanent: result.permanent, retryable: result.retryable,
    auto_pause_requested: Boolean(input.autoPauseActive), duration_ms: Date.now() - startedAt,
  });
  return result;
}

function statusForPermanentState(state: TelegramAccessState) {
  if (state === "bot_removed" || state === "permission_missing" || state === "channel_not_found") return state;
  return "paused";
}

export async function persistTelegramChannelAccess(input: PersistInput, result: TelegramAccessResult, db: Db = pool) {
  const isPool = typeof (db as any).getConnection === "function";
  const conn = isPool ? await (db as any).getConnection() : db;
  const shouldManageTx = isPool && typeof (conn as any).beginTransaction === "function";

  try {
    if (shouldManageTx) {
      await (conn as any).beginTransaction();
    }

    const [rows]: any = await (conn as any).query(
      "SELECT id,user_id,status,title,chat_id,username,channel_type,telegram_access_state,telegram_access_version,health_checked_at,reactivated_at,failure_reason FROM channels WHERE id=? AND is_deleted=FALSE LIMIT 1",
      [input.channelId],
    );
    const channel = rows?.[0];
    if (!channel) {
      if (shouldManageTx) await (conn as any).rollback();
      return { autoPaused: false, stateChanged: false };
    }

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== null &&
      Number(channel.telegram_access_version || 0) !== Number(input.expectedVersion)
    ) {
      if (shouldManageTx) await (conn as any).rollback();
      return { autoPaused: false, stateChanged: false, skippedStale: true };
    }

    const checkedAtMs = result.checkedAt instanceof Date ? result.checkedAt.getTime() : new Date(String(result.checkedAt)).getTime();
    const latestAuthoritativeMs = Math.max(
      channel.health_checked_at ? new Date(String(channel.health_checked_at)).getTime() : 0,
      channel.reactivated_at ? new Date(String(channel.reactivated_at)).getTime() : 0,
      channel.admin_paused_at ? new Date(String(channel.admin_paused_at)).getTime() : 0,
      channel.publisher_paused_at ? new Date(String(channel.publisher_paused_at)).getTime() : 0,
    );
    if (Number.isFinite(checkedAtMs) && latestAuthoritativeMs > 0 && checkedAtMs + 1000 < latestAuthoritativeMs) {
      if (shouldManageTx) await (conn as any).rollback();
      return { autoPaused: false, stateChanged: false, skippedStale: true };
    }

    const evidenceCategory = result.evidenceCategory || classifyTelegramEvidenceCategory({
      ok: result.ok,
      permanent: result.permanent,
      reasonCode: result.reasonCode,
    });
    const isTemporaryOrUncertain = !result.ok && !result.permanent;
    const persistedState: TelegramAccessState = isTemporaryOrUncertain ? "temporarily_unavailable" : result.state;
    const isProtectedIntentionalStatus = ["paused", "rejected", "deleted", "pending"].includes(String(channel.status || ""));
    const previousState = String(channel.telegram_access_state || "unchecked");
    const stateChanged = previousState !== persistedState;
    const safeReason = result.reason ? result.reason.slice(0, 255) : null;
    const preservedFailureReason = isProtectedIntentionalStatus && isTemporaryOrUncertain
      ? (channel.failure_reason ?? null)
      : safeReason;

    const existingValidChatId = isPermanentNumericChannelChatId(channel.chat_id)
      ? String(channel.chat_id).trim()
      : null;
    const safeHealthyChatId = existingValidChatId && !result.migratedFromChatId
      ? existingValidChatId
      : isPermanentNumericChannelChatId(result.telegramChatId)
        ? String(result.telegramChatId).trim()
        : existingValidChatId;
    const safeFailureChatId = result.state === "identity_mismatch"
      ? existingValidChatId
      : existingValidChatId || (isPermanentNumericChannelChatId(result.telegramChatId) ? String(result.telegramChatId).trim() : null);
    const safeUsername = result.state === "identity_mismatch" ? channel.username : (result.username || channel.username);

    if (result.ok) {
      await conn.query(
        `UPDATE channels SET
           chat_id=COALESCE(?,chat_id),username=COALESCE(?,username),title=COALESCE(NULLIF(?,''),title),
           telegram_access_state='healthy',telegram_access_version=telegram_access_version+IF(COALESCE(telegram_access_state,'unchecked')='healthy',0,1),
           health_status='healthy',health_checked_at=UTC_TIMESTAMP(6),failure_reason=NULL,health_failure_reason=NULL
         WHERE id=? AND is_deleted=FALSE`,
        [safeHealthyChatId, result.username, result.title, input.channelId],
      );
    } else {
      await conn.query(
        `UPDATE channels SET
           chat_id=CASE WHEN chat_id IS NULL OR chat_id=0 THEN COALESCE(?,chat_id) ELSE chat_id END,
           username=COALESCE(?,username),title=COALESCE(NULLIF(?,''),title),
           telegram_access_state=?,telegram_access_version=telegram_access_version+IF(COALESCE(telegram_access_state,'unchecked')=?,0,1),
           health_status=?,health_checked_at=UTC_TIMESTAMP(6),last_failure_at=UTC_TIMESTAMP(6),
           failure_reason=?,health_failure_reason=?
         WHERE id=? AND is_deleted=FALSE`,
        [safeFailureChatId, safeUsername, result.title, persistedState, persistedState,
          result.permanent ? "critical" : "warning", preservedFailureReason, safeReason, input.channelId],
      );
    }

    const identityChatId = (result.ok ? safeHealthyChatId : safeFailureChatId)
      || (existingValidChatId ? existingValidChatId : null);
    const jitterSeconds = (Math.abs(Number(input.channelId) || 1) % 7) + 1;
    const nextRetryAt = result.retryable
      ? new Date(Date.now() + (Math.max(5, result.retryAfterSeconds || 15 * 60) + jitterSeconds) * 1000)
      : null;
    const authoritativeBotRole = result.ok
      ? (result.botRole || "administrator")
      : result.permanent
        ? (result.botRole || (result.state === "bot_removed" ? "left" : result.state === "permission_missing" ? "administrator" : null))
        : null;

    if (identityChatId) {
      await conn.query(
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
           current_username=COALESCE(VALUES(current_username),current_username),
           bot_member_status=IF(VALUES(verification_state)='healthy',VALUES(bot_member_status),IF(?='confirmed',COALESCE(VALUES(bot_member_status),bot_member_status),bot_member_status)),
           bot_can_post=IF(VALUES(verification_state)='healthy',1,IF(?='confirmed',0,bot_can_post)),
           verification_state=VALUES(verification_state),
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
          safeUsername, authoritativeBotRole, result.canPostMessages ? 1 : 0, result.state,
          result.state, result.state, result.state, result.state, result.state,
          nextRetryAt, result.reasonCode, result.reason ? result.reason.slice(0, 500) : null, String(input.source).slice(0, 32),
          evidenceCategory, evidenceCategory,
        ],
      );

      try {
        await conn.query(
          `UPDATE channel_telegram_identities SET
             last_confirmed_bot_member_status = IF(?='healthy', COALESCE(?, bot_member_status), last_confirmed_bot_member_status),
             last_confirmed_bot_can_post = IF(?='healthy', 1, last_confirmed_bot_can_post),
             last_confirmed_at = IF(?='healthy', UTC_TIMESTAMP(6), last_confirmed_at),
             last_evidence_category = ?
           WHERE channel_id = ?`,
          [result.state, authoritativeBotRole, result.state, result.state, evidenceCategory, input.channelId]
        );
      } catch {
        // Ignored if Batch 2 columns not yet present in mock
      }
    }

    if (result.migratedFromChatId || result.state === "identity_mismatch") {
      try {
        await conn.query(
          `UPDATE channel_telegram_identities SET
             migrated_from_chat_id=COALESCE(?,migrated_from_chat_id),
             last_migrated_at=IF(? IS NOT NULL,UTC_TIMESTAMP(6),last_migrated_at),
             identity_conflict_chat_id=?,
             identity_conflict_channel_id=?,
             identity_conflict_reason=?
           WHERE channel_id=?`,
          [
            result.migratedFromChatId || null,
            result.migratedFromChatId || null,
            result.state === "identity_mismatch" ? (result.conflictingChatId || null) : null,
            result.state === "identity_mismatch" ? (result.conflictingChannelId ?? null) : null,
            result.state === "identity_mismatch" ? (result.reasonCode || "identity_mismatch") : null,
            input.channelId,
          ],
        );
      } catch {
        // Forward-compatible if Batch 3 columns are not yet applied
      }
    }

    const isReconciliationSource = [
      "identity_reconciliation",
      "missing_id_repair",
      "telegram_identity_sync",
    ].includes(String(input.source));

    let autoPaused = false;
    let newChannelStatus = String(channel.status || "");
    if (
      !result.ok &&
      result.permanent &&
      result.state !== "identity_mismatch" &&
      !isReconciliationSource && input.autoPauseActive && channel.status === "active" &&
      channel.paused_by_actor !== "admin" && channel.paused_by_actor !== "publisher"
    ) {
      const nextStatus = statusForPermanentState(result.state);
      const [transition]: any = await (conn as any).query(
        `UPDATE channels SET status=?,paused_reason=?,suggested_fix=?,auto_paused_at=UTC_TIMESTAMP(6),
           telegram_access_previous_status=COALESCE(telegram_access_previous_status,'active'),
           notification_state_version=notification_state_version+1
         WHERE id=? AND is_deleted=FALSE AND status='active'`,
        [nextStatus, safeReason, result.state === "bot_removed"
          ? "Re-add Ads Galaxy bot as an administrator with posting permission, then resume manually."
          : "Restore Ads Galaxy bot administrator posting permission, then resume manually.", input.channelId],
      );
      autoPaused = Boolean(transition?.affectedRows && transition.affectedRows > 0);
      if (autoPaused) {
        newChannelStatus = nextStatus;
        await recordChannelStatusTransitionAudit(conn, {
          channelId: Number(input.channelId),
          telegramChatId: result.telegramChatId || channel.chat_id,
          previousStatus: String(channel.status),
          newStatus: nextStatus,
          sourceWorker: String(input.source || "telegram_channel_access"),
          reasonCode: result.reasonCode || result.state,
          reasonText: safeReason || result.reason || result.state,
          evidenceClassification: "permanent",
          verificationAttemptRef: `version:${Number(channel.telegram_access_version || 0) + 1}`,
          actorType: String(input.source).includes("webhook") ? "webhook" : "system",
          transitionIntent: "automatic",
          verificationVersion: Number(channel.telegram_access_version || 0) + 1,
          notificationGenerated: true,
          metadata: {
            state: result.state,
            check_source: input.source,
          },
        });
      }
    }

    try {
      await conn.query(
        `INSERT INTO channel_telegram_access_observations
          (channel_id,last_attempt_state,last_attempt_code,last_attempt_reason,last_attempt_source,last_attempt_at,
           next_retry_at,last_successful_verification_at)
         VALUES (?,?,?,?,?,UTC_TIMESTAMP(6),?,IF(?='healthy',UTC_TIMESTAMP(6),NULL))
         ON DUPLICATE KEY UPDATE
           last_attempt_state=VALUES(last_attempt_state),
           last_attempt_code=VALUES(last_attempt_code),
           last_attempt_reason=VALUES(last_attempt_reason),
           last_attempt_source=VALUES(last_attempt_source),
           last_attempt_at=UTC_TIMESTAMP(6),
           next_retry_at=VALUES(next_retry_at),
           last_successful_verification_at=IF(VALUES(last_attempt_state)='healthy',UTC_TIMESTAMP(6),last_successful_verification_at)`,
        [
          input.channelId,
          result.state,
          result.reasonCode || (result.ok ? "healthy" : result.state),
          result.reason ? result.reason.slice(0, 500) : null,
          String(input.source).slice(0, 64),
          nextRetryAt,
          result.state,
        ],
      );
    } catch {
      // Forward-compatible if observation table is unavailable in lightweight test mocks
    }

    if (shouldManageTx) {
      await (conn as any).commit();
    }

    if (autoPaused) {
      const [versionRows]: any = await (conn as any).query(
        "SELECT notification_state_version FROM channels WHERE id=? LIMIT 1", [input.channelId],
      ).catch(() => [[{ notification_state_version: 1 }]]);
      const updated = versionRows?.[0];
      await enqueueAssetNotification(conn, {
        assetType: "channel", assetId: Number(input.channelId), userId: Number(channel.user_id),
        event: "access_removed", name: channel.title,
        version: Number(updated?.notification_state_version || channel.telegram_access_version + 1),
      }).catch(() => undefined);
      await createSystemLog({
        logType: "channel_health", status: "failed", title: "Channel auto-paused",
        summary: `Channel auto-paused because ${safeReason || result.state}`,
        autoPausedCount: 1, failedCount: 1, failureReasons: { [result.state]: 1 },
        affectedEntities: { channels: [maskEntityId("channel", input.channelId)] },
        metadata: { telegram_access_state: result.state, reason_code: result.reasonCode, check_source: input.source },
      }, conn).catch(() => undefined);
    }

    console.info("telegram_channel_access_persisted", {
      channel_id: Number(input.channelId), check_source: input.source, previous_state: previousState,
      new_state: result.state, normalized_reason: result.reasonCode, evidence_category: evidenceCategory,
      previous_status: channel.status, new_status: newChannelStatus,
      permanent: result.permanent, retryable: result.retryable, auto_paused: autoPaused,
    });
    return { autoPaused, stateChanged, evidenceCategory };
  } catch (error) {
    if (shouldManageTx) {
      await (conn as any).rollback().catch(() => undefined);
    }
    throw error;
  } finally {
    if (isPool && typeof (conn as any).release === "function") {
      (conn as any).release();
    }
  }
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
