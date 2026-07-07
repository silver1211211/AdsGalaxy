export function composeCampaignCreativeText(title?: string | null, message?: string | null) {
  const cleanTitle = String(title || "").trim();
  const cleanMessage = String(message || "").trim();

  if (!cleanTitle) return cleanMessage;
  if (!cleanMessage) return cleanTitle;
  return `${cleanTitle}\n\n${cleanMessage}`;
}

export function hasRestrictedClickCreativeContent(value?: string | null) {
  const text = String(value || "");
  return /@\w+/.test(text) || /(https?:\/\/[^\s]+)|(\w+\.\w+)/.test(text);
}
