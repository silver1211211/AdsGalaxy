import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";
import { getMiniAppPublisherCpmSettings } from "@/lib/miniappPublisherCpmEngine";

export const MINIAPP_ALL_CATEGORIES = "All Categories";

export const MINIAPP_CREATIVE_CATEGORIES = [
  "General",
  "Utilities",
  "Education",
  "AI",
  "Gaming",
  "Finance",
  "Crypto",
  "Trading",
  "Shopping",
  "Entertainment",
  "Other",
] as const;

export type MiniAppCreativeCategory = typeof MINIAPP_CREATIVE_CATEGORIES[number];

const CATEGORY_KEYS: Record<MiniAppCreativeCategory, string> = {
  General: "miniapp_category_cpm_adjustment_general",
  Utilities: "miniapp_category_cpm_adjustment_utilities",
  Education: "miniapp_category_cpm_adjustment_education",
  AI: "miniapp_category_cpm_adjustment_ai",
  Gaming: "miniapp_category_cpm_adjustment_gaming",
  Finance: "miniapp_category_cpm_adjustment_finance",
  Crypto: "miniapp_category_cpm_adjustment_crypto",
  Trading: "miniapp_category_cpm_adjustment_trading",
  Shopping: "miniapp_category_cpm_adjustment_shopping",
  Entertainment: "miniapp_category_cpm_adjustment_entertainment",
  Other: "miniapp_category_cpm_adjustment_other",
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

export function normalizeMiniAppCategories(value: unknown): MiniAppCreativeCategory[] {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  if (raw.length === 0 || raw.includes(MINIAPP_ALL_CATEGORIES)) return [];

  const normalized: MiniAppCreativeCategory[] = [];
  for (const item of raw) {
    const match = MINIAPP_CREATIVE_CATEGORIES.find((category) => category.toLowerCase() === String(item).trim().toLowerCase());
    if (!match) throw new Error("Please select valid campaign categories.");
    if (!normalized.includes(match)) normalized.push(match);
  }
  return normalized;
}

export function displayMiniAppCategories(categories: unknown) {
  const normalized = normalizeMiniAppCategories(categories);
  return normalized.length > 0 ? normalized : [MINIAPP_ALL_CATEGORIES];
}

export async function getMiniAppCategoryCpmAdjustments(conn?: PoolConnection) {
  const db = conn || pool;
  const [rows]: any = await db.query(
    "SELECT `key`, value FROM settings WHERE `key` IN (?)",
    [Object.values(CATEGORY_KEYS)]
  );
  const map = new Map<string, number>(rows.map((row: any) => [String(row.key), toNumber(row.value)]));
  return Object.fromEntries(
    MINIAPP_CREATIVE_CATEGORIES.map((category) => [category, Math.max(0, map.get(CATEGORY_KEYS[category]) || 0)])
  ) as Record<MiniAppCreativeCategory, number>;
}

export async function requiredMiniAppCategoryCpm(categories: MiniAppCreativeCategory[], conn?: PoolConnection) {
  const settings = await getMiniAppPublisherCpmSettings(conn);
  const adjustments = await getMiniAppCategoryCpmAdjustments(conn);
  const selected = categories.length > 0 ? categories : [];
  const adjustment = selected.length > 0 ? Math.max(...selected.map((category) => adjustments[category] || 0)) : 0;
  return {
    base_min_cpm: settings.min_cpm,
    category_adjustment: adjustment,
    required_cpm: settings.min_cpm + adjustment,
    adjustments,
  };
}

export function categorySettingKey(category: MiniAppCreativeCategory) {
  return CATEGORY_KEYS[category];
}
