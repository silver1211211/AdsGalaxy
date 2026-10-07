import { PublisherAssetError } from "@/lib/publisherAssetOnboarding";

export type VerifiedPublisherBot = { id: string; username: string; name: string };

/** Only the publisher's supplied token is authoritative for publisher-bot control. */
export async function verifyPublisherBotToken(value: unknown): Promise<VerifiedPublisherBot> {
  const token = String(value ?? "").trim();
  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new PublisherAssetError("INVALID_BOT_TOKEN", "Bot token format is invalid.");
  let response: Response;
  let data: { ok?: boolean; result?: { id?: unknown; username?: unknown; first_name?: unknown }; error_code?: number; parameters?: { retry_after?: unknown } };
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    data = await response.json();
  } catch { throw new PublisherAssetError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Telegram is temporarily unavailable. Retry shortly.", 503); }
  if (response.status === 429 || data.error_code === 429) throw new PublisherAssetError("TELEGRAM_RATE_LIMITED", "Telegram is busy. Retry shortly.", 429, Math.min(3600, Math.max(1, Number(data.parameters?.retry_after) || 30)));
  if (response.status >= 500 || Number(data.error_code) >= 500) throw new PublisherAssetError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Telegram is temporarily unavailable. Retry shortly.", 503);
  if (!response.ok || data.ok !== true || !data.result) throw new PublisherAssetError("INVALID_BOT_TOKEN", "Telegram rejected this bot token.");
  const id = String(data.result.id ?? ""); const username = String(data.result.username ?? "").replace(/^@/, "");
  if (!/^\d{1,20}$/.test(id) || !username) throw new PublisherAssetError("TELEGRAM_TEMPORARILY_UNAVAILABLE", "Telegram returned an incomplete bot identity. Retry shortly.", 503);
  return { id, username, name: String(data.result.first_name ?? "").trim() };
}
