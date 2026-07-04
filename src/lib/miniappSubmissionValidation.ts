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
  if (!raw) fail("Invalid Mini App username");

  const withoutAt = raw.replace(/^@/, "");
  if (!raw.startsWith("@")) {
    fail("Invalid Mini App username: must start with @");
  }

  if (withoutAt.length < 3 || withoutAt.length > 32) {
    fail("Invalid Mini App username");
  }

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(withoutAt)) {
    fail("Invalid Mini App username");
  }

  if (!/bot$/i.test(withoutAt)) {
    fail("Invalid Mini App username");
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
    fail("Web App URL must be a valid HTTPS URL (e.g. https://yourapp.example.com)");
  }

  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) {
    fail("Web App URL must be a valid HTTPS URL (e.g. https://yourapp.example.com)");
  }

  if (isTelegramLinkHostname(parsed.hostname)) {
    fail("Web App URL must be the HTTPS website configured in BotFather, not a t.me or telegram.me link");
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
    fail("Mini App URL must be a valid Telegram Mini App link");
  }

  const domain = getTelegramMiniAppDomain(parsed);
  if (!domain) {
    fail("Mini App URL must be a valid Telegram Mini App link");
  }

  if (domain.toLowerCase() !== normalizedUsername.toLowerCase()) {
    fail("Mini App URL must match the submitted Mini App username");
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
