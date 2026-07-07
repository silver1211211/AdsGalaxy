export const ALL_CATEGORIES = "All Categories";

export const CAMPAIGN_CATEGORIES = [
  ALL_CATEGORIES,
  "Crypto",
  "Finance",
  "NSFW +18",
  "Tech",
  "Gambling",
  "Entertainment",
  "Education",
  "Shopping",
  "Other"
];

export function normalizeCampaignCategory(input: unknown) {
  const category = String(input || "").trim();

  if (!category) {
    return ALL_CATEGORIES;
  }

  if (!CAMPAIGN_CATEGORIES.includes(category)) {
    throw new Error("Please select a valid campaign category");
  }

  return category;
}
