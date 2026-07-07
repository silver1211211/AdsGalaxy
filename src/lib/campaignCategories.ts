export const ALL_CATEGORIES = "all";

export const CAMPAIGN_CATEGORIES = [
  ALL_CATEGORIES,
  "crypto",
  "finance",
  "nsfw_18",
  "tech",
  "gambling",
  "entertainment",
  "education",
  "shopping",
  "other",
] as const;

export type CampaignCategory = typeof CAMPAIGN_CATEGORIES[number];

export const CAMPAIGN_CATEGORY_OPTIONS: Array<{ value: CampaignCategory; label: string }> = [
  { value: "all", label: "All Categories" },
  { value: "crypto", label: "Crypto" },
  { value: "finance", label: "Finance" },
  { value: "nsfw_18", label: "NSFW +18" },
  { value: "tech", label: "Tech" },
  { value: "gambling", label: "Gambling" },
  { value: "entertainment", label: "Entertainment" },
  { value: "education", label: "Education" },
  { value: "shopping", label: "Shopping" },
  { value: "other", label: "Other" },
];

const CATEGORY_ALIASES = new Map<string, CampaignCategory>(
  CAMPAIGN_CATEGORY_OPTIONS.flatMap((option) => [
    [option.value, option.value],
    [option.label, option.value],
  ] as Array<[string, CampaignCategory]>).concat([
    ["", ALL_CATEGORIES],
    ["all", ALL_CATEGORIES],
    ["all categories", ALL_CATEGORIES],
    ["general", ALL_CATEGORIES],
    ["uncategorized", ALL_CATEGORIES],
    ["nsfw", "nsfw_18"],
    ["nsfw +18", "nsfw_18"],
    ["nsfw 18", "nsfw_18"],
    ["adult", "nsfw_18"],
  ])
);

function categoryKey(input: unknown) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function categorySlug(input: unknown) {
  return categoryKey(input).replace(/\s+/g, "_");
}

export function normalizeCampaignCategory(input: unknown) {
  const key = categoryKey(input);

  if (!key) {
    return ALL_CATEGORIES;
  }

  const normalized = CATEGORY_ALIASES.get(key)
    || CATEGORY_ALIASES.get(categorySlug(input))
    || (CAMPAIGN_CATEGORIES.includes(categorySlug(input) as CampaignCategory) ? categorySlug(input) as CampaignCategory : null);

  if (!normalized) {
    throw new Error("Invalid campaign category. Please select a valid category and try again.");
  }

  return normalized;
}

export function normalizeCampaignCategoryList(input: unknown): CampaignCategory[] {
  const values = Array.isArray(input) ? input : (() => {
    if (!input) return [];
    try {
      const parsed = JSON.parse(String(input));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return String(input).split(",");
  })();

  return Array.from(new Set(values.map((value) => {
    try {
      return normalizeCampaignCategory(value);
    } catch {
      return null;
    }
  }).filter((value): value is CampaignCategory => Boolean(value))));
}

export function campaignCategoryMatches(campaignCategory: unknown, inventoryCategories: unknown) {
  const campaign = normalizeCampaignCategory(campaignCategory);
  if (campaign === ALL_CATEGORIES) return true;
  return normalizeCampaignCategoryList(inventoryCategories).includes(campaign);
}

export function campaignCategoryLabel(input: unknown) {
  const category = normalizeCampaignCategory(input);
  return CAMPAIGN_CATEGORY_OPTIONS.find((option) => option.value === category)?.label || "All Categories";
}
