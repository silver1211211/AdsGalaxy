const ADVERTISER_INVENTORY_FIELDS = [
  "id", "type", "type_label", "name", "username", "category", "country", "language",
  "monthly_impressions", "average_completion_rate", "average_cpm", "direct_min_cpm",
  "premium_cpm", "featured_cpm", "active_status", "featured", "pinned", "highlighted",
  "favorite", "favorites_count", "selection_count",
] as const;

export function publicAdvertiserInventory(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(ADVERTISER_INVENTORY_FIELDS.map((field) => [field, source[field]]));
}
