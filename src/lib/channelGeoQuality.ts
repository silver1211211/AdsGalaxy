import { classifyChannelAudience, audienceForCountryCode, type ChannelAudienceKey } from "@/lib/channelAudience";

export type ChannelGeoEvidence = { publisherSelected: unknown; adminRegion?: ChannelAudienceKey | null; verifiedCountry?: string | null; requestCountries?: Array<{ country: string; share: number }>; languageHint?: string | null };
export function classifyChannelGeoConfidence(input: ChannelGeoEvidence) {
  const selected = classifyChannelAudience(input.publisherSelected);
  const verified = audienceForCountryCode(input.verifiedCountry);
  const request = [...(input.requestCountries || [])].sort((a,b)=>b.share-a.share)[0];
  const requestRegion = request && request.share >= 0.6 ? audienceForCountryCode(request.country) : null;
  const authoritative = input.adminRegion || verified || requestRegion || selected || null;
  const strong = [input.adminRegion, verified, requestRegion].filter(Boolean) as ChannelAudienceKey[];
  const conflict = Boolean(authoritative && ([selected, ...strong].filter(Boolean) as ChannelAudienceKey[]).some(value=>value!==authoritative));
  const confidence = input.adminRegion ? "verified" : verified ? "high" : requestRegion ? "medium" : selected ? "publisher_declared" : "unknown";
  return { selected_region: selected, authoritative_region: authoritative, confidence, conflict_detected: conflict, reason: input.adminRegion ? "manual_admin_classification" : verified ? "verified_metadata" : requestRegion ? "request_geo_majority" : selected ? "publisher_selection_only" : "no_geo_evidence", language_hint: input.languageHint || null };
}
