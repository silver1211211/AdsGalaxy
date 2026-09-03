export function composeCampaignCreativeText(title?: string | null, message?: string | null) {
  const cleanTitle = String(title || "").trim();
  const cleanMessage = String(message || "").trim();

  if (!cleanTitle) return cleanMessage;
  if (!cleanMessage) return cleanTitle;
  return `${cleanTitle}\n\n${cleanMessage}`;
}

function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function composeCampaignCreativeTelegramHtml(title?: string | null, message?: string | null) {
  const cleanTitle = String(title || "").trim();
  const cleanMessage = String(message || "").trim();
  const escapedMessage = escapeTelegramHtml(cleanMessage);

  if (!cleanTitle) return escapedMessage;

  const boldTitle = `<b>${escapeTelegramHtml(cleanTitle)}</b>`;
  if (!cleanMessage) return boldTitle;
  return `${boldTitle}\n\n${escapedMessage}`;
}

export function hasRestrictedClickCreativeContent(value?: string | null) {
  const text = String(value || "");
  return /@\w+/.test(text) || /(https?:\/\/[^\s]+)|(\w+\.\w+)/.test(text);
}
