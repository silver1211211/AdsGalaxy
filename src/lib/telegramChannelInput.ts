const TELEGRAM_LINK_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;
const TELEGRAM_INVITE_HASH_PATTERN = /^[A-Za-z0-9_-]+$/;

function telegramUrl(value: unknown) {
  const input = String(value || "").trim();
  if (!input) return null;

  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" || !TELEGRAM_LINK_HOSTS.has(hostname) || parsed.username || parsed.password || parsed.port) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizePublicChannelUsername(value: unknown) {
  const input = String(value || "").trim();
  if (!input) return null;

  const parsed = telegramUrl(input);
  let candidate = input.replace(/^@/, "");
  if (parsed) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 1 || segments[0].startsWith("+") || segments[0].toLowerCase() === "joinchat") {
      return null;
    }
    candidate = segments[0];
  } else if (/[:/]/.test(candidate)) {
    return null;
  }

  return TELEGRAM_USERNAME_PATTERN.test(candidate) ? candidate : null;
}

export function normalizePrivateInviteLink(value: unknown) {
  const parsed = telegramUrl(value);
  if (!parsed) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  let inviteHash = "";
  let style: "plus" | "joinchat" | null = null;

  if (segments.length === 1 && segments[0].startsWith("+")) {
    inviteHash = segments[0].slice(1);
    style = "plus";
  } else if (segments.length === 2 && segments[0].toLowerCase() === "joinchat") {
    inviteHash = segments[1];
    style = "joinchat";
  }

  if (!style || !TELEGRAM_INVITE_HASH_PATTERN.test(inviteHash)) return null;
  return style === "plus"
    ? `https://t.me/+${inviteHash}`
    : `https://t.me/joinchat/${inviteHash}`;
}

export function isValidPublicChannelUsername(value: unknown) {
  return normalizePublicChannelUsername(value) !== null;
}

export function publicChannelUrl(value: unknown) {
  const username = normalizePublicChannelUsername(value);
  return username ? `https://t.me/${username}` : null;
}

export function isValidPrivateInviteLink(value: unknown) {
  return normalizePrivateInviteLink(value) !== null;
}
