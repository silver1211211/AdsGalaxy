export const MINIAPP_CAMPAIGN_LIMITS = {
  campaignName: 15,
  title: 50,
  description: 200,
  categories: 3,
} as const;

export function normalizeMiniAppCampaignCategories(value: unknown) {
  const categories = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const selected = Array.from(new Set(categories.filter((category) => !["General", "All", "All Categories"].includes(category))));
  if (selected.length > MINIAPP_CAMPAIGN_LIMITS.categories) {
    throw new Error(`Select no more than ${MINIAPP_CAMPAIGN_LIMITS.categories} ad categories`);
  }
  return selected.length ? selected : ["General"];
}

export function validateMiniAppCampaignText(input: { campaignName: string; title: string; description: string }) {
  if (!input.campaignName || !input.title || !input.description) {
    throw new Error("Campaign name, ad title, and description are required");
  }
  if (input.campaignName.length > MINIAPP_CAMPAIGN_LIMITS.campaignName) {
    throw new Error(`Campaign name must be ${MINIAPP_CAMPAIGN_LIMITS.campaignName} characters or fewer`);
  }
  if (input.title.length > MINIAPP_CAMPAIGN_LIMITS.title) {
    throw new Error(`Ad title must be ${MINIAPP_CAMPAIGN_LIMITS.title} characters or fewer`);
  }
  if (input.description.length > MINIAPP_CAMPAIGN_LIMITS.description) {
    throw new Error(`Description must be ${MINIAPP_CAMPAIGN_LIMITS.description} characters or fewer`);
  }
}
