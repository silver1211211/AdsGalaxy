import { safeCampaignDestination } from "@/lib/clickDestination";

type Destination = { campaignId: number; targetUrl: string; expiresAt: number };
const destinations = new Map<string, Destination>();
const TTL_MS = 5 * 60_000;
const key = (campaignPublicId: number, postId: number) => `${campaignPublicId}:${postId}`;

/** Server-derived, short-lived fallback only. Never accepts a request URL. */
export function rememberClickDestination(campaignPublicId: number, postId: number, campaignId: number, url: string) {
  const targetUrl = safeCampaignDestination(url); if (!targetUrl) return;
  destinations.set(key(campaignPublicId, postId), { campaignId, targetUrl, expiresAt: Date.now() + TTL_MS });
}
export function cachedClickDestination(campaignPublicId: number, postId: number) {
  const item = destinations.get(key(campaignPublicId, postId));
  if (!item || item.expiresAt < Date.now()) { destinations.delete(key(campaignPublicId, postId)); return null; }
  return item;
}
