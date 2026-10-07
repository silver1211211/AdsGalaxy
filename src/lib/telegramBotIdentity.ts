import { resolvePublicBotIdentity } from "@/lib/telegramMtproto";
import { PublisherAssetError } from "@/lib/publisherAssetOnboarding";

export function normalizeTelegramBotId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!/^\d{9,20}$/.test(id)) throw new PublisherAssetError("INVALID_BOT_ID", "Enter a valid Telegram Bot ID.");
  return id;
}

export async function verifyPublicBotIdentity(usernameInput: unknown, suppliedId?: unknown) {
  const username = String(usernameInput ?? "").trim().replace(/^@/, "");
  if (!username) throw new PublisherAssetError("BOT_USERNAME_REQUIRED", "Telegram Bot username is required.");
  const identity = await resolvePublicBotIdentity(username);
  if (!identity.ok) {
    if (["invalid_username", "username_not_occupied"].includes(identity.code)) throw new PublisherAssetError("BOT_NOT_FOUND", "Bot not found on Telegram.", 404);
    if (identity.code === "not_a_bot") throw new PublisherAssetError("NOT_A_TELEGRAM_BOT", "This Telegram username does not belong to a bot.", 400);
    if (identity.code === "rate_limited") throw new PublisherAssetError("TELEGRAM_RATE_LIMITED", "Telegram is busy. Please retry shortly.", 429, Math.min(3600, Math.max(1, identity.retryAfterSeconds || 30)));
    throw new PublisherAssetError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Telegram is temporarily unavailable. Please retry shortly.", 503);
  }
  const normalizedSuppliedId = suppliedId === undefined || suppliedId === null || String(suppliedId).trim() === "" ? null : normalizeTelegramBotId(suppliedId);
  if (normalizedSuppliedId && normalizedSuppliedId !== identity.id) throw new PublisherAssetError("BOT_ID_MISMATCH", "The entered Bot ID does not match this Telegram bot.", 400);
  return identity;
}
