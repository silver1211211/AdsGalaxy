import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";
import { verifyTelegramChannelAccess } from "@/lib/telegramChannelAccess";

type Db = typeof pool | PoolConnection;

type VerifyIdentityInput = {
  channelId: number | string;
  chatId?: string | number | null;
  username?: string | null;
  source: string;
};

export type ChannelVerificationCode =
  | "inaccessible_channel"
  | "missing_permission"
  | "temporarily_rate_limited"
  | "temporary_telegram_error"
  | "identity_conflict";

export class ChannelVerificationError extends Error {
  constructor(
    public code: ChannelVerificationCode,
    message: string,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ChannelVerificationError";
  }
}

function verificationCode(state: string, reasonCode: string | null): ChannelVerificationCode {
  if (state === "permission_missing") return "missing_permission";
  if (state === "identity_mismatch") return "identity_conflict";
  if (reasonCode === "telegram_rate_limited") return "temporarily_rate_limited";
  if (state === "temporarily_unavailable") return "temporary_telegram_error";
  return "inaccessible_channel";
}

/** Compatibility wrapper. The canonical verifier owns classification and persistence. */
export async function verifyAndStoreChannelIdentity(input: VerifyIdentityInput, db: Db = pool) {
  const result = await verifyTelegramChannelAccess({
    channelId: input.channelId,
    chatId: input.chatId,
    username: input.username,
    source: input.source,
    persist: true,
    autoPauseActive: false,
  }, db);
  if (!result.ok) {
    throw new ChannelVerificationError(
      verificationCode(result.state, result.reasonCode),
      result.reason || "Telegram channel verification failed.",
      result.retryAfterSeconds,
    );
  }
  return {
    chatId: String(result.telegramChatId),
    username: result.username,
    title: result.title,
    status: result.botRole,
    canPost: result.canPostMessages,
  };
}
