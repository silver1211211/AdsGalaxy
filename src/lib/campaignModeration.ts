export type CampaignCreativeKind = "channel" | "bot" | "miniapp" | "teaser" | "channel_growth";
export type SensitiveCreative = {
  destinationUrl?: unknown;
  cta?: unknown;
  image?: unknown;
  logo?: unknown;
  title?: unknown;
  text?: unknown;
  variants?: unknown;
};

function text(value: unknown) { return String(value ?? "").trim(); }
function variants(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  return values.map((item) => text(item));
}

export function getSensitiveCreativeFingerprint(kind: CampaignCreativeKind, creative: SensitiveCreative) {
  const base: Record<string, unknown> = {
    destination_url: text(creative.destinationUrl),
    cta: text(creative.cta),
    title: text(creative.title),
    text: text(creative.text),
  };
  if (kind === "teaser") {
    base.variants = variants(creative.variants);
  } else {
    base.image = text(creative.image);
    if (kind === "miniapp") base.logo = text(creative.logo);
  }
  return JSON.stringify(base);
}

export function didSensitiveCampaignContentChange(
  kind: CampaignCreativeKind,
  previous: SensitiveCreative,
  next: SensitiveCreative,
) {
  return getSensitiveCreativeFingerprint(kind, previous) !== getSensitiveCreativeFingerprint(kind, next);
}

export function campaignCreativeKind(input: { type?: unknown; campaignKind?: unknown; teaserMode?: unknown }): CampaignCreativeKind {
  if (String(input.teaserMode || "none") === "teaser_only") return "teaser";
  if (String(input.campaignKind || "") === "channel_growth") return "channel_growth";
  if (String(input.type || "") === "broadcast") return "bot";
  return "channel";
}
