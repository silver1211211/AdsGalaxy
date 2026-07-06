export type MiniAppSubmissionInput = {
  miniapp_name?: unknown;
  miniapp_username?: unknown;
  bot_id?: unknown;
  telegram_bot_id?: unknown;
  webapp_url?: unknown;
  miniapp_url?: unknown;
};

export type ValidatedMiniAppSubmission = {
  miniapp_name: string;
  miniapp_username: string;
  miniapp_username_with_at: string;
  bot_id: string;
  telegram_bot_id: string;
  webapp_url: string;
  miniapp_url: string;
};

export class MiniAppSubmissionValidationError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "MiniAppSubmissionValidationError";
  }
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function fail(message: string): never {
  throw new MiniAppSubmissionValidationError(message);
}

function normalizeBotUsername(value: unknown) {
  const raw = cleanText(value);
  if (!raw) fail("Telegram Bot username must start with @.");

  if (!raw.startsWith("@")) {
    fail("Telegram Bot username must start with @.");
  }

  if (/\s/.test(raw)) {
    fail("Telegram Bot username cannot contain spaces.");
  }

  const withoutAt = raw.slice(1);
  if (withoutAt.includes("@")) {
    fail("Telegram Bot username must contain only one @, at the start.");
  }

  if (withoutAt.length < 3 || withoutAt.length > 32) {
    fail("Telegram Bot username must be between 3 and 32 characters (excluding @).");
  }

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(withoutAt)) {
    fail("Telegram Bot username can only contain letters, numbers and underscores after the @.");
  }

  if (!/bot$/i.test(withoutAt)) {
    fail("Telegram Bot username must end with 'bot' (e.g. @MyAppBot).");
  }

  return {
    username: withoutAt,
    usernameWithAt: `@${withoutAt}`,
  };
}

function validateBotId(value: unknown) {
  const botId = cleanText(value);
  if (!/^\d{9,20}$/.test(botId)) {
    fail("Invalid bot ID");
  }
  return botId;
}

const TELEGRAM_LINK_HOSTNAMES = new Set(["t.me", "telegram.me", "www.t.me", "www.telegram.me"]);

function isTelegramLinkHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return TELEGRAM_LINK_HOSTNAMES.has(host) || host.endsWith(".t.me") || host.endsWith(".telegram.me");
}

// The Web App URL is the real HTTPS website configured as the Mini App in
// BotFather (what AdsGram and other ad networks require) — it must never be
// a t.me/telegram.me launch link, which belongs in the separate Mini App URL
// field instead.
function validateHttpsUrl(value: unknown) {
  const webappUrl = cleanText(value);
  let parsed: URL;

  try {
    parsed = new URL(webappUrl);
  } catch {
    fail("Please enter a valid HTTPS website URL.");
  }

  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) {
    fail("Please enter a valid HTTPS website URL.");
  }

  if (isTelegramLinkHostname(parsed.hostname)) {
    fail("Telegram links are not allowed here. Please enter your website's HTTPS URL.");
  }

  return parsed.toString();
}

function getTelegramMiniAppDomain(parsed: URL) {
  if (parsed.protocol === "https:" && (parsed.hostname === "t.me" || parsed.hostname === "telegram.me")) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const domain = parts[0] || "";
    const hasAppPath = parts.length >= 2;
    const hasStartApp = parsed.searchParams.has("startapp");
    if (domain && (hasAppPath || hasStartApp)) return domain;
  }

  if (parsed.protocol === "tg:" && parsed.hostname === "resolve") {
    const domain = parsed.searchParams.get("domain") || "";
    const appName = parsed.searchParams.get("appname") || "";
    if (domain && appName) return domain;
  }

  return "";
}

function validateMiniAppUrl(value: unknown, normalizedUsername: string) {
  const miniappUrl = cleanText(value);
  let parsed: URL;

  try {
    parsed = new URL(miniappUrl);
  } catch {
    fail("Please enter a valid Telegram Mini App URL beginning with https://t.me/.");
  }

  const domain = getTelegramMiniAppDomain(parsed);
  if (!domain) {
    fail("Please enter a valid Telegram Mini App URL beginning with https://t.me/.");
  }

  if (domain.toLowerCase() !== normalizedUsername.toLowerCase()) {
    fail("This Telegram Mini App URL doesn't match the Bot Username you entered above.");
  }

  return miniappUrl;
}

export function validateMiniAppSubmission(input: MiniAppSubmissionInput): ValidatedMiniAppSubmission {
  const miniappName = cleanText(input.miniapp_name);
  if (miniappName.length < 3) {
    fail("Mini App name must be at least 3 characters");
  }
  if (miniappName.length > 50) {
    fail("Mini App name must be at most 50 characters");
  }

  const username = normalizeBotUsername(input.miniapp_username);
  const botId = validateBotId(input.bot_id);
  const telegramBotId = validateBotId(input.telegram_bot_id ?? input.bot_id);
  const webappUrl = validateHttpsUrl(input.webapp_url);
  const miniappUrl = validateMiniAppUrl(input.miniapp_url, username.username);

  return {
    miniapp_name: miniappName,
    miniapp_username: username.username,
    miniapp_username_with_at: username.usernameWithAt,
    bot_id: botId,
    telegram_bot_id: telegramBotId,
    webapp_url: webappUrl,
    miniapp_url: miniappUrl,
  };
}
