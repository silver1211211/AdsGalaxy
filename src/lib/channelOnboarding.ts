import { getAuthenticatedUserStatus } from "@/lib/auth";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2/promise";

export class ChannelOnboardingError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryAfter = 0) { super(message); }
}

/** Reuse signed Mini App identity; never treat Telegram IDs as internal users.id. */
export async function authenticateChannelPublisher(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host !== (request.headers.get("host") || new URL(request.url).host))) {
    throw new ChannelOnboardingError("UNAUTHORIZED", "Please reopen AdsGalaxy and try again.", 403);
  }
  const identity = await getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
  const [rows] = await pool.query<Array<RowDataPacket & { id: number; telegram_id: string; status: string }>>(
    "SELECT id,telegram_id,status FROM users WHERE id=? LIMIT 1", [identity.id]);
  const user = rows[0];
  if (!user || !/^\d+$/.test(String(user.telegram_id))) throw new ChannelOnboardingError("UNAUTHORIZED", "Please reopen AdsGalaxy and try again.", 401);
  if (String(user.status).toLowerCase() === "banned") throw new ChannelOnboardingError("PUBLISHER_RESTRICTED", "This publisher account is restricted.", 403);
  return user;
}

export type TelegramChannelResult = {
  id?: number; type?: string; title?: string; username?: string; status?: string;
  can_post_messages?: boolean; can_delete_messages?: boolean; can_invite_users?: boolean; can_edit_messages?: boolean;
};
/** Bounded read-only Bot API requests. Never return Telegram descriptions containing private data. */
export async function channelTelegram<T = TelegramChannelResult>(token: string, method: string, body: Record<string, unknown>) {
  let response: Response;
  let data: { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } };
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000), cache: "no-store",
    });
    data = await response.json();
  } catch {
    throw new ChannelOnboardingError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Telegram is temporarily unavailable. Try again shortly.", 503);
  }
  if (response.status === 429 || data.error_code === 429) {
    throw new ChannelOnboardingError("TELEGRAM_RATE_LIMITED", "Telegram is busy. Please wait before trying again.", 429, Math.min(3600, Math.max(1, Number(data.parameters?.retry_after) || 30)));
  }
  if (response.status >= 500 || Number(data.error_code) >= 500) throw new ChannelOnboardingError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Telegram is temporarily unavailable. Try again shortly.", 503);
  if (data.ok && (data.result === undefined || data.result === null)) throw new ChannelOnboardingError("TELEGRAM_INVALID_RESPONSE", "Telegram returned an incomplete response. Please try again shortly.", 503);
  return { ok: response.ok && data.ok === true, result: data.result!, error_code: data.error_code, description: "Telegram could not verify channel access." };
}

export function requireStableChannelId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^-[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new ChannelOnboardingError("TELEGRAM_INVALID_RESPONSE", "Telegram could not verify this channel. Please try again shortly.", 503);
  return id;
}

/** MTProto infrastructure/configuration failures must never reject a channel permanently. */
export function throwIfPrivateVerificationUnavailable(code: string) {
  if (code === "rate_limited") throw new ChannelOnboardingError("TELEGRAM_RATE_LIMITED", "Telegram is busy. Please try again later.", 429, 60);
  if (["verification_timeout", "network_error", "telegram_rpc_error", "all_accounts_failed", "missing_api_id", "missing_api_hash", "missing_account_sessions", "session_unauthorized", "session_auth_error", "auth_key_duplicated", "all_accounts_unhealthy"].includes(code)) {
    throw new ChannelOnboardingError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Private channel verification is temporarily unavailable. Try again shortly.", 503);
  }
}

export function requireChannelBotPermissions(member: TelegramChannelResult | undefined, privateChannel: boolean) {
  const creator = member?.status === "creator";
  if (!creator && (member?.status !== "administrator" || !member.can_post_messages || !member.can_delete_messages || (privateChannel && !member.can_invite_users))) {
    throw new ChannelOnboardingError("PERMISSION_REQUIRED", `Add @Ads_Galaxy_Bot as an administrator with Post Messages, Delete Messages${privateChannel ? " and Add Members" : ""} permissions first.`);
  }
}

export async function requireChannelPublisherAuthority(token: string, chatId: string | number, telegramUserId: string) {
  const member = await channelTelegram(token, "getChatMember", { chat_id: chatId, user_id: telegramUserId });
  if (!member.ok || !["creator", "administrator"].includes(String(member.result?.status))) {
    throw new ChannelOnboardingError("CHANNEL_OWNERSHIP_REQUIRED", "You must be an owner or administrator of this Telegram channel.", 403);
  }
}

export function onboardingErrorResponse(error: ChannelOnboardingError) {
  return Response.json({ error: error.message, code: error.code, message: error.message, retryable: error.status === 429 || error.status === 503 },
    { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined });
}

export function channelOnboardingTelemetry(input: {
  requestId: string; stage: string; result: string; code?: string; publisherId?: number; chatId?: string; mode?: string;
}) {
  console.info(JSON.stringify({ event: "channel_onboarding", at: new Date().toISOString(), ...input }));
}
