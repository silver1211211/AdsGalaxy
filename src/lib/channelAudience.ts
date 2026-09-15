import { campaignCategoryMatches } from "@/lib/campaignCategories";

export const CHANNEL_AUDIENCE_KEYS = [
  "global",
  "africa",
  "asia",
  "europe",
  "north_america",
  "south_america",
  "oceania",
] as const;

export type ChannelAudienceKey = typeof CHANNEL_AUDIENCE_KEYS[number];

export type SpecificChannelAudienceKey = Exclude<ChannelAudienceKey, "global">;

export const CHANNEL_AUDIENCE_OPTIONS: ReadonlyArray<{ value: ChannelAudienceKey; label: string }> = [
  { value: "global", label: "Global" },
  { value: "africa", label: "Africa" },
  { value: "asia", label: "Asia" },
  { value: "europe", label: "Europe" },
  { value: "north_america", label: "North America" },
  { value: "south_america", label: "South America" },
  { value: "oceania", label: "Oceania" },
];

export const PUBLISHER_CHANNEL_AUDIENCE_OPTIONS: ReadonlyArray<{ value: SpecificChannelAudienceKey; label: string }> =
  CHANNEL_AUDIENCE_OPTIONS.filter(
    (option): option is { value: SpecificChannelAudienceKey; label: string } => option.value !== "global",
  );

export const UNCLASSIFIED_AUDIENCE = "unclassified" as const;

export const COUNTRY_AUDIENCE_MAP: Readonly<Record<string, Exclude<ChannelAudienceKey, "global">>> = {
  NG: "africa", ZA: "africa", EG: "africa", KE: "africa",
  IN: "asia", CN: "asia", JP: "asia",
  GB: "europe", DE: "europe", FR: "europe", IT: "europe", ES: "europe",
  US: "north_america", CA: "north_america", MX: "north_america",
  BR: "south_america", AR: "south_america", CO: "south_america",
  AU: "oceania", NZ: "oceania",
};

export function audienceForCountryCode(value: unknown) {
  const code = String(value || "").trim().toUpperCase();
  return COUNTRY_AUDIENCE_MAP[code] || null;
}

export type ExplicitCampaignAudienceTargeting = {
  version: 1;
  mode: "explicit";
  audiences: ChannelAudienceKey[];
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function audienceToken(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeAudienceKey(value: unknown): ChannelAudienceKey | null {
  const token = audienceToken(value);
  return CHANNEL_AUDIENCE_KEYS.includes(token as ChannelAudienceKey)
    ? token as ChannelAudienceKey
    : null;
}

function audienceList(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

export function normalizeExplicitCampaignAudiences(value: unknown): ChannelAudienceKey[] {
  const parsed = parseJson(value);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { audiences?: unknown }).audiences)
      ? (parsed as { audiences: unknown[] }).audiences
      : [];

  if (values.length === 0) {
    throw new Error("Select at least one target audience");
  }

  const audiences: ChannelAudienceKey[] = [];
  for (const valueItem of values) {
    const audience = normalizeAudienceKey(valueItem);
    if (!audience) throw new Error("Target audience contains an unsupported value");
    if (!audiences.includes(audience)) audiences.push(audience);
  }

  if (audiences.includes("global") && audiences.length > 1) {
    throw new Error("Global cannot be combined with another target audience");
  }

  return audiences;
}

export function serializeExplicitCampaignAudience(value: unknown) {
  const targeting: ExplicitCampaignAudienceTargeting = {
    version: 1,
    mode: "explicit",
    audiences: normalizeExplicitCampaignAudiences(value),
  };
  return JSON.stringify(targeting);
}

export function parseCampaignAudienceTargeting(value: unknown):
  | { mode: "legacy_unrestricted" }
  | { mode: "explicit"; audiences: ChannelAudienceKey[] } {
  const parsed = parseJson(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return { mode: "legacy_unrestricted" };
  }

  const candidate = parsed as { version?: unknown; mode?: unknown; audiences?: unknown };
  if (candidate.version !== 1 || candidate.mode !== "explicit") {
    return { mode: "legacy_unrestricted" };
  }

  try {
    return { mode: "explicit", audiences: normalizeExplicitCampaignAudiences(candidate.audiences) };
  } catch {
    // Invalid explicit configuration must fail closed instead of widening delivery.
    return { mode: "explicit", audiences: [] };
  }
}

export function classifyChannelAudience(value: unknown): ChannelAudienceKey | null {
  const values = audienceList(value);
  if (values.length === 0) return null;
  const parsed = values.map(normalizeAudienceKey);
  if (parsed.some((audience) => audience === null)) return null;
  const normalized = Array.from(new Set(parsed as ChannelAudienceKey[]));

  if (normalized.length === CHANNEL_AUDIENCE_KEYS.length
    && CHANNEL_AUDIENCE_KEYS.every((audience) => normalized.includes(audience))) {
    return "global";
  }

  return normalized.length === 1 ? normalized[0] : null;
}

export function normalizeChannelAudience(value: unknown): SpecificChannelAudienceKey {
  const values = audienceList(value);
  if (values.length !== 1) {
    throw new Error("Select exactly one channel audience");
  }
  const audience = normalizeAudienceKey(values[0]);
  if (!audience) throw new Error("Channel audience contains an unsupported value");
  if (audience === "global") throw new Error("Select one specific channel audience");
  return audience;
}

export function campaignAudienceMatchesChannel(campaignAudience: unknown, channelAudience: unknown) {
  const targeting = parseCampaignAudienceTargeting(campaignAudience);
  if (targeting.mode === "legacy_unrestricted") return true;
  const channel = classifyChannelAudience(channelAudience);
  if (channel === null) return false;
  return targeting.audiences.includes("global") || targeting.audiences.includes(channel);
}

export function channelCampaignMatchesInventory(input: {
  campaignCategory: unknown;
  campaignAudience: unknown;
  channelCategories: unknown;
  channelAudience: unknown;
  campaignCountries?: unknown;
  campaignLanguages?: unknown;
  channelCountry?: unknown;
  channelLanguage?: unknown;
}) {
  const list=(value:unknown,normalizer:(item:unknown)=>string|null)=>{try{const parsed=typeof value==="string"?JSON.parse(value):value;const values=Array.isArray(parsed)?parsed:[];return values.map(normalizer).filter(Boolean) as string[];}catch{return [] as string[];}};
  const country=(value:unknown)=>{const code=String(value||"").trim().toUpperCase();return /^[A-Z]{2}$/.test(code)?code:null;};
  const language=(value:unknown)=>{const code=String(value||"").trim().toLowerCase().split("-")[0];return /^[a-z]{2,3}$/.test(code)?code:null;};
  const countries=list(input.campaignCountries,country), languages=list(input.campaignLanguages,language);
  const channelCountry=country(input.channelCountry),channelLanguage=language(input.channelLanguage);
  return campaignCategoryMatches(input.campaignCategory, input.channelCategories)
    && campaignAudienceMatchesChannel(input.campaignAudience, input.channelAudience)
    && (countries.length===0||(channelCountry!==null&&countries.includes(channelCountry)))
    && (languages.length===0||(channelLanguage!==null&&languages.includes(channelLanguage)));
}
