import { classifyTelegramAccessFailure, persistTelegramChannelAccess, type TelegramAccessResult } from "@/lib/telegramChannelAccess";

export type TelegramCleanupCategory =
  | "SUCCESS"
  | "ALREADY_MISSING"
  | "CANNOT_DELETE_TERMINAL"
  | "CHANNEL_ACCESS_LOST"
  | "TEMPORARY";

export type TelegramCleanupClassification = {
  category: TelegramCleanupCategory;
  code: string;
  retryable: boolean;
  terminal: boolean;
  localSuccess: boolean;
  retryAfterSeconds: number | null;
  safeReason: string;
};

type CleanupFailureInput = {
  ok?: boolean;
  description?: unknown;
  httpStatus?: unknown;
  errorCode?: unknown;
  retryAfterSeconds?: unknown;
  error?: unknown;
};

export function classifyTelegramCleanupResult(input: CleanupFailureInput): TelegramCleanupClassification {
  if (input.ok) return { category: "SUCCESS", code: "OK", retryable: false, terminal: true, localSuccess: true, retryAfterSeconds: null, safeReason: "Telegram message deleted." };
  const errorText = input.error instanceof Error ? `${input.error.name} ${input.error.message}` : String(input.error || "");
  const description = String(input.description || errorText || "Telegram cleanup failed");
  const text = description.toLowerCase();
  const status = Number(input.httpStatus || input.errorCode || 0);
  const retryAfterSeconds = Math.max(0, Number(input.retryAfterSeconds || 0)) || null;
  const make = (category: TelegramCleanupCategory, code: string, retryable: boolean, terminal: boolean, localSuccess: boolean): TelegramCleanupClassification => ({
    category, code, retryable, terminal, localSuccess, retryAfterSeconds,
    safeReason: `${code}: ${status ? `HTTP ${status}: ` : ""}${description}`.slice(0, 1000),
  });
  if (/message to delete not found|message not found/.test(text)) return make("ALREADY_MISSING", "MESSAGE_NOT_FOUND", false, true, true);
  if (/message can'?t be deleted|message cannot be deleted|can'?t delete/.test(text)) return make("CANNOT_DELETE_TERMINAL", "MESSAGE_CANT_BE_DELETED", false, true, false);
  if (/bot is not a member|bot is not member/.test(text)) return make("CHANNEL_ACCESS_LOST", "BOT_IS_NOT_MEMBER", false, true, false);
  if (/bot was kicked|bot was blocked|bot removed/.test(text)) return make("CHANNEL_ACCESS_LOST", "BOT_REMOVED", false, true, false);
  if (/chat not found|channel not found|channel_invalid|peer_id_invalid/.test(text)) return make("CHANNEL_ACCESS_LOST", "CHANNEL_ACCESS_LOST", false, true, false);
  if (/not enough rights|not an administrator|administrator rights|chat_admin_required/.test(text) || status === 403) return make("CHANNEL_ACCESS_LOST", "CHAT_ADMIN_REQUIRED", false, true, false);
  if (status === 429 || retryAfterSeconds || /too many requests|retry after|flood[_ ]?wait|rate.?limit/.test(text)) return make("TEMPORARY", "RATE_LIMITED", true, false, false);
  if (status >= 500 || /timeout|timed out|aborterror|econnreset|eai_again|enotfound|network|socket|fetch failed|temporar|internal server error|bad gateway/.test(text)) return make("TEMPORARY", "TELEGRAM_TEMPORARY_ERROR", true, false, false);
  return make("CANNOT_DELETE_TERMINAL", "TELEGRAM_DELETE_TERMINAL", false, true, false);
}

export function telegramCleanupRetryDelaySeconds(attempt: number, retryAfterSeconds?: number | null) {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(21_600, Math.max(30, Math.ceil(retryAfterSeconds)));
  return Math.min(21_600, 60 * (2 ** Math.max(0, Math.min(8, attempt - 1))));
}

export async function persistCleanupAccessLoss(channelId: number | string | null | undefined, classification: TelegramCleanupClassification) {
  if (!channelId || classification.category !== "CHANNEL_ACCESS_LOST") return { autoPaused: false, stateChanged: false };
  const access = classifyTelegramAccessFailure({ description: classification.safeReason });
  const result: TelegramAccessResult = {
    ...access,
    checkedAt: new Date(), telegramChatId: null, username: null, title: null, channelType: null,
    botRole: null, canPostMessages: false,
  };
  return persistTelegramChannelAccess({ channelId, source: "telegram_cleanup", autoPauseActive: true }, result);
}

export async function mapWithBoundedConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const limit = Math.max(1, Math.min(20, Math.floor(concurrency || 1)));
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}
