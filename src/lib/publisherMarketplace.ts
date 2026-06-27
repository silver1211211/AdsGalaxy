import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

export type MarketplaceInventoryType = "miniapp" | "channel" | "bot";

export type MarketplaceFilters = {
  type?: MarketplaceInventoryType | "all";
  search?: string;
  category?: string;
  country?: string;
  language?: string;
  inventory_rank?: string;
  traffic_quality?: string;
  publisher_trust?: string;
  min_cpm?: string;
  max_cpm?: string;
  min_impressions?: string;
  leaderboard?: string;
  trending?: string;
  featured?: string;
  limit?: number;
};

const TYPE_LABELS: Record<MarketplaceInventoryType, string> = {
  miniapp: "Mini App",
  channel: "Channel",
  bot: "Bot",
};

const TABLES: Record<MarketplaceInventoryType, string> = {
  miniapp: "miniapps",
  channel: "channels",
  bot: "bots",
};

const ACTIVE_STATUS: Record<MarketplaceInventoryType, string[]> = {
  miniapp: ["approved", "monetized"],
  channel: ["active"],
  bot: ["active"],
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function firstListValue(value: unknown) {
  return parseJsonArray(value)[0] || "";
}

export function publicMarketplaceQuality(score: unknown) {
  const normalized = toNumber(score) || 60;
  if (normalized >= 90) return "Excellent";
  if (normalized >= 75) return "Very Good";
  if (normalized >= 60) return "Good";
  if (normalized >= 40) return "Average";
  return "Poor";
}

export function publicInventoryRank(rank: unknown) {
  const value = String(rank || "standard").replace(/_/g, " ");
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function baseSelect(type: MarketplaceInventoryType) {
  if (type === "miniapp") {
    return `
      SELECT
        'miniapp' as inventory_type,
        m.id,
        m.miniapp_name as name,
        m.miniapp_username as username,
        m.status,
        m.created_at,
        m.marketplace_category,
        m.marketplace_country,
        m.marketplace_language,
        m.marketplace_average_cpm,
        m.marketplace_direct_min_cpm,
        m.marketplace_premium_cpm,
        m.marketplace_featured_cpm,
        m.marketplace_monthly_impressions,
        m.marketplace_avg_completion_rate,
        m.marketplace_featured,
        m.marketplace_pinned,
        m.marketplace_highlighted,
        COALESCE(m.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(m.inventory_score, 50) as inventory_score,
        COALESCE(m.inventory_rank, 'standard') as inventory_rank,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0) as calculated_monthly_impressions,
        COALESCE((SELECT AVG(ce.completion_rate) FROM miniapp_internal_ad_completion_events ce WHERE ce.miniapp_id = m.id AND ce.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0) as calculated_completion_rate,
        COALESCE((SELECT COUNT(*) FROM inventory_favorites f WHERE f.inventory_type = 'miniapp' AND f.inventory_id = m.id), 0) as favorites_count,
        COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'miniapp' AND a.inventory_id = m.id AND a.event_type = 'selection'), 0) as selection_count,
        COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'miniapp' AND a.inventory_id = m.id AND a.event_type = 'profile_view'), 0) as profile_views,
        COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'miniapp' AND a.inventory_id = m.id AND a.event_type = 'advertiser_interest'), 0) as advertiser_interest,
        NULL as categories
      FROM miniapps m
    `;
  }

  if (type === "channel") {
    return `
      SELECT
        'channel' as inventory_type,
        c.id,
        c.title as name,
        c.username,
        c.status,
        c.created_at,
        c.marketplace_category,
        c.marketplace_country,
        c.marketplace_language,
        c.marketplace_average_cpm,
        c.marketplace_direct_min_cpm,
        c.marketplace_premium_cpm,
        c.marketplace_featured_cpm,
        c.marketplace_monthly_impressions,
        c.marketplace_avg_completion_rate,
        c.marketplace_featured,
        c.marketplace_pinned,
        c.marketplace_highlighted,
        COALESCE(c.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(c.inventory_score, 50) as inventory_score,
        COALESCE(c.inventory_rank, 'standard') as inventory_rank,
        COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.channel_id = c.id AND cp.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0) as calculated_monthly_impressions,
        0 as calculated_completion_rate,
        COALESCE((SELECT COUNT(*) FROM inventory_favorites f WHERE f.inventory_type = 'channel' AND f.inventory_id = c.id), 0) as favorites_count,
        COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'channel' AND a.inventory_id = c.id AND a.event_type = 'selection'), 0) as selection_count,
        COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'channel' AND a.inventory_id = c.id AND a.event_type = 'profile_view'), 0) as profile_views,
        COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'channel' AND a.inventory_id = c.id AND a.event_type = 'advertiser_interest'), 0) as advertiser_interest,
        c.categories
      FROM channels c
    `;
  }

  return `
    SELECT
      'bot' as inventory_type,
      b.id,
      b.bot_name as name,
      b.bot_username as username,
      b.status,
      b.created_at,
      b.marketplace_category,
      b.marketplace_country,
      b.marketplace_language,
      b.marketplace_average_cpm,
      b.marketplace_direct_min_cpm,
      b.marketplace_premium_cpm,
      b.marketplace_featured_cpm,
      b.marketplace_monthly_impressions,
      b.marketplace_avg_completion_rate,
      b.marketplace_featured,
      b.marketplace_pinned,
      b.marketplace_highlighted,
      COALESCE(b.traffic_quality_score, 60) as traffic_quality_score,
      COALESCE(b.inventory_score, 50) as inventory_score,
      COALESCE(b.inventory_rank, 'standard') as inventory_rank,
      COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0) as calculated_monthly_impressions,
      0 as calculated_completion_rate,
      COALESCE((SELECT COUNT(*) FROM inventory_favorites f WHERE f.inventory_type = 'bot' AND f.inventory_id = b.id), 0) as favorites_count,
      COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'bot' AND a.inventory_id = b.id AND a.event_type = 'selection'), 0) as selection_count,
      COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'bot' AND a.inventory_id = b.id AND a.event_type = 'profile_view'), 0) as profile_views,
      COALESCE((SELECT COUNT(*) FROM inventory_marketplace_analytics a WHERE a.inventory_type = 'bot' AND a.inventory_id = b.id AND a.event_type = 'advertiser_interest'), 0) as advertiser_interest,
      b.categories
    FROM bots b
  `;
}

function alias(type: MarketplaceInventoryType) {
  return type === "miniapp" ? "m" : type === "channel" ? "c" : "b";
}

function marketplaceWhere(type: MarketplaceInventoryType, filters: MarketplaceFilters, params: Array<string | number>) {
  const a = alias(type);
  const statusPlaceholders = ACTIVE_STATUS[type].map(() => "?").join(", ");
  params.push(...ACTIVE_STATUS[type]);
  let where = ` WHERE ${a}.is_deleted = FALSE AND ${a}.status IN (${statusPlaceholders}) AND ${a}.marketplace_visible = 1 AND ${a}.marketplace_admin_status = 'approved'`;

  if (filters.search) {
    const q = `%${filters.search}%`;
    if (type === "miniapp") {
      where += ` AND (${a}.miniapp_name LIKE ? OR ${a}.miniapp_username LIKE ? OR ${a}.marketplace_category LIKE ? OR ${a}.marketplace_country LIKE ? OR ${a}.marketplace_language LIKE ? OR ${a}.inventory_rank LIKE ?)`;
      params.push(q, q, q, q, q, q);
    } else if (type === "channel") {
      where += ` AND (${a}.title LIKE ? OR ${a}.username LIKE ? OR ${a}.categories LIKE ? OR ${a}.marketplace_category LIKE ? OR ${a}.marketplace_country LIKE ? OR ${a}.marketplace_language LIKE ? OR ${a}.inventory_rank LIKE ?)`;
      params.push(q, q, q, q, q, q, q);
    } else {
      where += ` AND (${a}.bot_name LIKE ? OR ${a}.bot_username LIKE ? OR ${a}.categories LIKE ? OR ${a}.marketplace_category LIKE ? OR ${a}.marketplace_country LIKE ? OR ${a}.marketplace_language LIKE ? OR ${a}.inventory_rank LIKE ?)`;
      params.push(q, q, q, q, q, q, q);
    }
  }

  if (filters.category) {
    where += ` AND (COALESCE(${a}.marketplace_category, '') = ? OR ${type === "miniapp" ? `${a}.miniapp_name` : `${a}.categories`} LIKE ?)`;
    params.push(filters.category, `%${filters.category}%`);
  }
  if (filters.country) {
    where += ` AND UPPER(COALESCE(${a}.marketplace_country, '')) = ?`;
    params.push(filters.country.toUpperCase());
  }
  if (filters.language) {
    where += ` AND LOWER(COALESCE(${a}.marketplace_language, '')) = ?`;
    params.push(filters.language.toLowerCase());
  }
  if (filters.inventory_rank) {
    where += ` AND ${a}.inventory_rank = ?`;
    params.push(filters.inventory_rank);
  }
  if (filters.traffic_quality) {
    const qualityMinimums: Record<string, number> = { excellent: 90, very_good: 75, good: 60, average: 40, poor: 0 };
    where += ` AND COALESCE(${a}.traffic_quality_score, 60) >= ?`;
    params.push(qualityMinimums[filters.traffic_quality] ?? 0);
  }
  if (filters.publisher_trust) {
    const rankMinimums: Record<string, number> = { elite: 81, advanced: 61, standard: 41, basic: 21, starter: 0 };
    where += ` AND COALESCE(${a}.inventory_score, 50) >= ?`;
    params.push(rankMinimums[filters.publisher_trust] ?? 0);
  }
  if (filters.min_cpm) {
    where += ` AND COALESCE(${a}.marketplace_average_cpm, ${a}.marketplace_direct_min_cpm, 0) >= ?`;
    params.push(Number(filters.min_cpm) || 0);
  }
  if (filters.max_cpm) {
    where += ` AND COALESCE(${a}.marketplace_average_cpm, ${a}.marketplace_direct_min_cpm, 0) <= ?`;
    params.push(Number(filters.max_cpm) || 0);
  }
  if (filters.min_impressions) {
    where += ` AND ${a}.marketplace_monthly_impressions >= ?`;
    params.push(Number(filters.min_impressions) || 0);
  }
  if (filters.featured === "1") {
    where += ` AND (${a}.marketplace_featured = 1 OR ${a}.marketplace_pinned = 1 OR ${a}.marketplace_highlighted = 1)`;
  }

  return where;
}

function orderBy(filters: MarketplaceFilters) {
  if (filters.trending === "1") {
    return " ORDER BY (selection_count * 4 + advertiser_interest * 3 + favorites_count * 2 + profile_views + inventory_score) DESC";
  }
  if (filters.leaderboard === "1") {
    return " ORDER BY inventory_score DESC, calculated_monthly_impressions DESC";
  }
  return " ORDER BY marketplace_pinned DESC, marketplace_featured DESC, marketplace_highlighted DESC, inventory_score DESC, calculated_monthly_impressions DESC";
}

export function serializeMarketplaceRow(row: Record<string, unknown>, favorite = false) {
  const monthlyImpressions = Math.max(toNumber(row.marketplace_monthly_impressions), toNumber(row.calculated_monthly_impressions));
  const completionRate = Math.max(toNumber(row.marketplace_avg_completion_rate), toNumber(row.calculated_completion_rate));
  const category = String(row.marketplace_category || firstListValue(row.categories) || "General");
  return {
    id: Number(row.id),
    type: row.inventory_type as MarketplaceInventoryType,
    type_label: TYPE_LABELS[row.inventory_type as MarketplaceInventoryType],
    name: String(row.name || "Untitled"),
    username: String(row.username || "").replace(/^@/, ""),
    category,
    country: String(row.marketplace_country || "Global").toUpperCase(),
    language: String(row.marketplace_language || "All"),
    inventory_rank: publicInventoryRank(row.inventory_rank),
    inventory_rank_key: String(row.inventory_rank || "standard"),
    traffic_quality_rating: publicMarketplaceQuality(row.traffic_quality_score),
    publisher_trust: publicMarketplaceQuality(row.inventory_score),
    monthly_impressions: Math.round(monthlyImpressions),
    average_completion_rate: completionRate > 1 ? completionRate : completionRate * 100,
    average_cpm: row.marketplace_average_cpm === null ? null : toNumber(row.marketplace_average_cpm),
    direct_min_cpm: row.marketplace_direct_min_cpm === null ? null : toNumber(row.marketplace_direct_min_cpm),
    premium_cpm: row.marketplace_premium_cpm === null ? null : toNumber(row.marketplace_premium_cpm),
    featured_cpm: row.marketplace_featured_cpm === null ? null : toNumber(row.marketplace_featured_cpm),
    active_status: ACTIVE_STATUS[row.inventory_type as MarketplaceInventoryType].includes(String(row.status)) ? "Active" : "Inactive",
    featured: Boolean(row.marketplace_featured),
    pinned: Boolean(row.marketplace_pinned),
    highlighted: Boolean(row.marketplace_highlighted),
    favorite,
    favorites_count: Number(row.favorites_count || 0),
    selection_count: Number(row.selection_count || 0),
    profile_views: Number(row.profile_views || 0),
    advertiser_interest: Number(row.advertiser_interest || 0),
  };
}

export async function listMarketplaceInventory(filters: MarketplaceFilters, advertiserId?: number, conn?: PoolConnection) {
  const db = conn || pool;
  const types: MarketplaceInventoryType[] = filters.type && filters.type !== "all" ? [filters.type] : ["miniapp", "channel", "bot"];
  const limit = Math.max(1, Math.min(Number(filters.limit || 24), 100));

  const results = [];
  for (const type of types) {
    const params: Array<string | number> = [];
    const query = `${baseSelect(type)} ${marketplaceWhere(type, filters, params)} ${orderBy(filters)} LIMIT ?`;
    const [rows]: any = await db.query(query, [...params, limit]);
    const favorites = advertiserId ? await favoriteSet(advertiserId, type, rows.map((row: any) => Number(row.id)), db) : new Set<number>();
    results.push(...rows.map((row: any) => serializeMarketplaceRow(row, favorites.has(Number(row.id)))));
  }

  return results.sort((a, b) => {
    if (filters.trending === "1") return b.selection_count + b.advertiser_interest + b.favorites_count - (a.selection_count + a.advertiser_interest + a.favorites_count);
    if (filters.leaderboard === "1") return rankWeight(b.inventory_rank_key) - rankWeight(a.inventory_rank_key) || b.monthly_impressions - a.monthly_impressions;
    return Number(b.pinned) - Number(a.pinned) || Number(b.featured) - Number(a.featured) || b.monthly_impressions - a.monthly_impressions;
  }).slice(0, limit);
}

function rankWeight(rank: string) {
  return { elite: 5, advanced: 4, standard: 3, basic: 2, starter: 1 }[rank] || 0;
}

async function favoriteSet(advertiserId: number, type: MarketplaceInventoryType, ids: number[], db: PoolConnection | typeof pool) {
  if (ids.length === 0) return new Set<number>();
  const placeholders = ids.map(() => "?").join(", ");
  const [rows]: any = await db.query(
    `SELECT inventory_id FROM inventory_favorites WHERE advertiser_id = ? AND inventory_type = ? AND inventory_id IN (${placeholders})`,
    [advertiserId, type, ...ids]
  );
  return new Set<number>(rows.map((row: any) => Number(row.inventory_id)));
}

export async function getMarketplaceProfile(type: MarketplaceInventoryType, id: number, advertiserId?: number, conn?: PoolConnection) {
  const db = conn || pool;
  const params: Array<string | number> = [];
  const query = `${baseSelect(type)} ${marketplaceWhere(type, {}, params)} AND ${alias(type)}.id = ? LIMIT 1`;
  const [rows]: any = await db.query(query, [...params, id]);
  if (!rows[0]) return null;
  const favorites = advertiserId ? await favoriteSet(advertiserId, type, [id], db) : new Set<number>();
  return serializeMarketplaceRow(rows[0], favorites.has(id));
}

export function normalizeMarketplaceType(value: unknown): MarketplaceInventoryType {
  const type = String(value || "").toLowerCase();
  if (type === "miniapp" || type === "channel" || type === "bot") return type;
  throw new Error("Invalid inventory type");
}

export function publicSelectionMetadata(input: Record<string, unknown>) {
  return {
    mode: String(input.direct_placement_mode || "network") === "direct" ? "direct" : "network",
    scope: String(input.direct_inventory_scope || "network"),
    categories: parseJsonArray(input.direct_categories),
    countries: parseJsonArray(input.direct_countries).map((item) => item.toUpperCase()),
    languages: parseJsonArray(input.direct_languages).map((item) => item.toLowerCase()),
  };
}

export async function validateDirectPlacementTargets(input: {
  mode: string;
  scope: string;
  inventoryType: MarketplaceInventoryType;
  inventoryIds: number[];
  cpm: number;
}, conn?: PoolConnection) {
  if (input.mode !== "direct") return { ids: [], requiredCpm: 0 };
  const db = conn || pool;
  const ids = [...new Set(input.inventoryIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const [[settingRow]]: any = await db.query("SELECT value FROM settings WHERE `key` = 'direct_placement_min_cpm' LIMIT 1");
  let requiredCpm = toNumber(settingRow?.value);
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const table = TABLES[input.inventoryType];
    const [rows]: any = await db.query(
      `SELECT COALESCE(MAX(marketplace_direct_min_cpm), 0) as required_cpm FROM ${table} WHERE id IN (${placeholders})`,
      ids
    );
    requiredCpm = Math.max(requiredCpm, toNumber(rows[0]?.required_cpm));
  }
  if (requiredCpm > 0 && input.cpm < requiredCpm) {
    throw new Error(`Direct placement CPM must be at least $${requiredCpm.toFixed(2)} for the selected inventory.`);
  }
  return { ids, requiredCpm };
}

export async function recordMarketplaceEvent(input: {
  advertiserId?: number | null;
  inventoryType: MarketplaceInventoryType;
  inventoryId: number;
  eventType: "profile_view" | "favorite" | "selection" | "advertiser_interest";
  metadata?: Record<string, unknown>;
}, conn?: PoolConnection) {
  const db = conn || pool;
  await db.query(
    "INSERT INTO inventory_marketplace_analytics (advertiser_id, inventory_type, inventory_id, event_type, metadata) VALUES (?, ?, ?, ?, ?)",
    [input.advertiserId || null, input.inventoryType, input.inventoryId, input.eventType, JSON.stringify(input.metadata || {})]
  );
}
