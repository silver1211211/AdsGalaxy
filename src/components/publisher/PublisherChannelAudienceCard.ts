import React from "react";
import { subscriberFreshness, telegramAudienceLabel } from "../../lib/channelRefreshPolicy.ts";

export type PublisherChannelAudience = { channel_type?: string | null; subscriber_count?: number | string | null; subscribers_last_success_at?: string | Date | null; subscribers_fetch_status?: string | null; below_minimum_since?: string | Date | null; monetization_paused_reason?: string | null; below_minimum_review_required?: boolean | number | null; monetization_auto_restored_at?: string | Date | null; status?: string | null };

export function PublisherChannelAudienceCard({ channel, now = new Date() }: { channel: PublisherChannelAudience; now?: Date }) {
  const freshness = subscriberFreshness(channel.subscribers_last_success_at || null, now);
  const notices: string[] = [];
  if (freshness === "delayed") notices.push("Refresh delayed");
  if (channel.subscribers_fetch_status === "failed" || freshness === "stale") notices.push("Count may be stale");
  if (channel.below_minimum_since && channel.monetization_paused_reason !== "below_minimum") {
    const deadline = new Date(new Date(channel.below_minimum_since).getTime() + 48 * 60 * 60 * 1000);
    notices.push(`Below-minimum grace period ends ${deadline.toLocaleString()}.`);
  }
  if (channel.monetization_paused_reason === "below_minimum") notices.push("Monetization is paused because the channel remains below the minimum.");
  if (channel.below_minimum_review_required) notices.push("Seven-day requalification review required.");
  if (channel.monetization_auto_restored_at) notices.push("Audience recovered and monetization was restored automatically.");
  if (!channel.below_minimum_since && channel.status === "paused" && channel.monetization_paused_reason === "below_minimum") notices.push("Audience recovered, but restoration is withheld because another restriction still applies.");
  return React.createElement("div", { className: "publisher-channel-audience" },
    React.createElement("span", null, `${Number(channel.subscriber_count || 0).toLocaleString()} ${telegramAudienceLabel(channel.channel_type)}`),
    React.createElement("span", null, channel.subscribers_last_success_at ? `Last successful refresh: ${new Date(channel.subscribers_last_success_at).toLocaleString()}` : "Refresh pending"),
    ...notices.map((notice, index) => React.createElement("p", { key: index }, notice))
  );
}
