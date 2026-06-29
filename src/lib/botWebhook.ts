import "server-only";

import crypto from "crypto";

function clean(value: unknown) {
  return String(value || "").trim();
}

function signingSecret() {
  return clean(process.env.BOT_WEBHOOK_SECRET || process.env.BOT_ADD_USER_SECRET);
}

export function createBotWebhookSecret(botId: number | string, botToken: string) {
  const secret = signingSecret();
  if (!secret || !clean(botToken)) return null;

  return crypto
    .createHmac("sha256", secret)
    .update(`${clean(botId)}:${clean(botToken)}`)
    .digest("hex")
    .slice(0, 40);
}

export function verifyBotWebhookSecret(botId: number | string, botToken: string, suppliedSecret: string) {
  const expected = createBotWebhookSecret(botId, botToken);
  const supplied = clean(suppliedSecret);
  if (!expected || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createBotWebhookUrl(origin: string, botId: number | string, botToken: string) {
  const secret = createBotWebhookSecret(botId, botToken);
  if (!secret) return null;

  const configuredOrigin = clean(
    process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL
    || origin
  ).replace(/\/$/, "");

  return `${configuredOrigin}/api/bot/webhook/${encodeURIComponent(clean(botId))}/${secret}`;
}

type TelegramActor = { id?: unknown };
type TelegramChat = { id?: unknown; type?: unknown };
type TelegramUpdate = {
  update_id?: unknown;
  message?: { from?: TelegramActor; chat?: TelegramChat };
  edited_message?: { from?: TelegramActor; chat?: TelegramChat };
  callback_query?: { from?: TelegramActor; message?: { chat?: TelegramChat } };
  inline_query?: { from?: TelegramActor };
  chosen_inline_result?: { from?: TelegramActor };
  shipping_query?: { from?: TelegramActor };
  pre_checkout_query?: { from?: TelegramActor };
  poll_answer?: { user?: TelegramActor };
  my_chat_member?: { from?: TelegramActor; chat?: TelegramChat; new_chat_member?: { status?: unknown } };
  chat_member?: { from?: TelegramActor; chat?: TelegramChat };
  chat_join_request?: { from?: TelegramActor; chat?: TelegramChat };
};

function numericId(value: unknown) {
  const normalized = clean(value);
  return /^-?\d+$/.test(normalized) ? normalized : null;
}

export function parsePublisherBotUpdate(value: unknown) {
  const update = (value && typeof value === "object" ? value : {}) as TelegramUpdate;
  const message = update.message || update.edited_message;
  const actor = message?.from
    || update.callback_query?.from
    || update.inline_query?.from
    || update.chosen_inline_result?.from
    || update.shipping_query?.from
    || update.pre_checkout_query?.from
    || update.poll_answer?.user
    || update.my_chat_member?.from
    || update.chat_member?.from
    || update.chat_join_request?.from;
  const chat = message?.chat
    || update.callback_query?.message?.chat
    || update.my_chat_member?.chat
    || update.chat_member?.chat
    || update.chat_join_request?.chat;
  const updateId = numericId(update.update_id);
  const chatId = numericId(chat?.id);
  const userId = chatId
    ? (chat?.type === "private" ? chatId : null)
    : numericId(actor?.id);
  const membershipStatus = clean(update.my_chat_member?.new_chat_member?.status).toLowerCase();
  const isInactive = membershipStatus === "left" || membershipStatus === "kicked";

  return { updateId, userId, isInactive };
}
