export type PausableCampaignKind = "bot" | "channel";

export const BOT_PAUSE_WARNING =
  "Pausing this campaign will stop new bot broadcasts. Already delivered messages will remain available. Do you want to continue?";

export const CHANNEL_PAUSE_WARNING =
  "Pausing this campaign will delete all active posts from channels. You cannot resume this campaign for 1 hour. Do you want to continue?";

export function pausableCampaignKind(type: unknown): PausableCampaignKind | null {
  if (type === "broadcast") return "bot";
  if (type === "views" || type === "clicks") return "channel";
  return null;
}

export function campaignPauseWarning(type: unknown) {
  const kind = pausableCampaignKind(type);
  if (kind === "bot") return BOT_PAUSE_WARNING;
  if (kind === "channel") return CHANNEL_PAUSE_WARNING;
  return null;
}
