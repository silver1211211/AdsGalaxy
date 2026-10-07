const ALLOWED_CLICK_PROTOCOLS = new Set(["http:", "https:", "tg:"]);
export function safeCampaignDestination(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return ALLOWED_CLICK_PROTOCOLS.has(url.protocol.toLowerCase()) ? url.toString() : null;
  } catch { return null; }
}
