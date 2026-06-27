import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;

export type InventoryType = "miniapp" | "channel" | "bot";
export type InventoryTier = "standard" | "premium" | "elite" | "sponsored";
export type ExclusivityType = "non_exclusive" | "exclusive" | "category_exclusive" | "country_exclusive";

const inventoryTables = {
  miniapp: { table: "miniapps", name: "miniapp_name", username: "miniapp_username" },
  channel: { table: "channels", name: "title", username: "username" },
  bot: { table: "bots", name: "bot_name", username: "bot_username" },
};

export function normalizeInventoryType(value: unknown): InventoryType {
  const text = String(value || "").toLowerCase();
  if (text === "miniapp" || text === "channel" || text === "bot") return text;
  throw new Error("Invalid inventory type");
}

function normalizeTier(value: unknown): InventoryTier {
  const text = String(value || "").toLowerCase();
  if (["standard", "premium", "elite", "sponsored"].includes(text)) return text as InventoryTier;
  return "standard";
}

function normalizeExclusivity(value: unknown): ExclusivityType {
  const text = String(value || "").toLowerCase();
  if (["exclusive", "category_exclusive", "country_exclusive"].includes(text)) return text as ExclusivityType;
  return "non_exclusive";
}

function numberValue(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanDate(value: unknown) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Invalid date");
  return text;
}

function parseJson(value: unknown, fallback: any) {
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

export function deliveryProgress(row: any) {
  const reserved = numberValue(row.reserved_impressions);
  const delivered = numberValue(row.delivered_impressions);
  const spend = numberValue(row.spend);
  const budget = numberValue(row.total_budget);
  const remainingBudget = Math.max(0, budget - spend);
  const progress = reserved > 0 ? delivered / reserved : 0;
  const start = new Date(row.start_date);
  const end = new Date(row.end_date);
  const now = new Date();
  const totalMs = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / totalMs));
  const expected = reserved * elapsed;
  const shortfallRatio = expected > 0 ? Math.max(0, (expected - delivered) / expected) : 0;
  const atRisk = elapsed >= 0.2 && shortfallRatio >= 0.25 && progress < elapsed;
  return {
    reserved_impressions: reserved,
    delivered_impressions: delivered,
    spend,
    remaining_budget: remainingBudget,
    delivery_progress: Number(progress.toFixed(4)),
    time_elapsed: Number(elapsed.toFixed(4)),
    expected_impressions: Math.round(expected),
    underdelivery_status: atRisk ? "at_risk" : "on_track",
  };
}

export async function logEnterpriseEvent(input: {
  dealId?: number | null;
  eventType: string;
  message: string;
  actorType?: string;
  actorId?: number | null;
  metadata?: Record<string, unknown>;
}, db: Db = pool) {
  await db.query(
    `INSERT INTO enterprise_deal_audit_logs (deal_id, event_type, actor_type, actor_id, message, metadata)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [input.dealId || null, input.eventType, input.actorType || "admin", input.actorId || null, input.message, JSON.stringify(input.metadata || {})]
  );
}

export async function listEnterpriseInventory(input: { type?: string; search?: string; tier?: string } = {}, db: Db = pool) {
  const requested = input.type && input.type !== "all" ? [normalizeInventoryType(input.type)] : ["miniapp", "channel", "bot"] as InventoryType[];
  const params: any[] = [];
  const parts = requested.map((type) => {
    const cfg = inventoryTables[type];
    const where = ["i.is_deleted = FALSE"];
    if (input.search) {
      where.push(`(i.${cfg.name} LIKE ? OR i.${cfg.username} LIKE ? OR i.marketplace_category LIKE ?)`);
      const q = `%${input.search}%`;
      params.push(q, q, q);
    }
    if (input.tier && input.tier !== "all") {
      where.push("COALESCE(i.enterprise_inventory_tier, 'standard') = ?");
      params.push(normalizeTier(input.tier));
    }
    return `
      SELECT '${type}' as inventory_type, i.id, i.${cfg.name} as name, i.${cfg.username} as username,
             i.status, COALESCE(i.enterprise_inventory_tier, 'standard') as enterprise_inventory_tier,
             COALESCE(i.enterprise_priority_score, 0) as enterprise_priority_score,
             COALESCE(i.enterprise_sponsorship_enabled, 0) as enterprise_sponsorship_enabled,
             COALESCE(i.marketplace_monthly_impressions, 0) as estimated_monthly_impressions,
             COALESCE(i.marketplace_average_cpm, 0) as estimated_cpm,
             COALESCE(i.marketplace_category, 'General') as category,
             COALESCE(i.marketplace_country, '') as country,
             COALESCE(i.traffic_quality_score, 60) as traffic_quality_score,
             (SELECT COUNT(*) FROM enterprise_inventory_reservations r
              WHERE r.inventory_type = '${type}' AND r.inventory_id = i.id
                AND r.status IN ('reserved', 'active')) as reservation_count
      FROM ${cfg.table} i
      WHERE ${where.join(" AND ")}
    `;
  });
  const [rows]: any = await db.query(`${parts.join(" UNION ALL ")} ORDER BY FIELD(enterprise_inventory_tier, 'sponsored', 'elite', 'premium', 'standard'), enterprise_priority_score DESC, id DESC LIMIT 200`, params);
  return rows;
}

export async function updateInventoryTier(input: {
  inventoryType: string;
  inventoryId: number;
  tier: string;
  priorityScore?: number;
  sponsorshipEnabled?: boolean;
}, db: Db = pool) {
  const type = normalizeInventoryType(input.inventoryType);
  const cfg = inventoryTables[type];
  await db.query(
    `UPDATE ${cfg.table}
     SET enterprise_inventory_tier = ?, enterprise_priority_score = ?, enterprise_sponsorship_enabled = ?
     WHERE id = ?`,
    [normalizeTier(input.tier), Math.max(0, Math.min(100, numberValue(input.priorityScore))), input.sponsorshipEnabled ? 1 : 0, input.inventoryId]
  );
}

export async function detectReservationConflicts(input: {
  inventory: Array<{ inventory_type: string; inventory_id: number }>;
  startDate: string;
  endDate: string;
  exclusivityType: string;
  category?: string | null;
  country?: string | null;
  excludeDealId?: number;
}, db: Db = pool) {
  const start = cleanDate(input.startDate);
  const end = cleanDate(input.endDate);
  const exclusivity = normalizeExclusivity(input.exclusivityType);
  const conflicts: any[] = [];

  for (const item of input.inventory) {
    const type = normalizeInventoryType(item.inventory_type);
    const id = Number(item.inventory_id);
    const params: any[] = [type, id, start, end];
    let exclude = "";
    if (input.excludeDealId) {
      exclude = "AND r.deal_id != ?";
      params.push(input.excludeDealId);
    }
    const [rows]: any = await db.query(
      `SELECT r.*, d.approval_status, d.status as deal_status
       FROM enterprise_inventory_reservations r
       JOIN enterprise_direct_deals d ON d.id = r.deal_id
       WHERE r.inventory_type = ? AND r.inventory_id = ?
         AND r.status IN ('reserved', 'active')
         AND d.status NOT IN ('cancelled', 'completed')
         AND r.start_date <= ? AND r.end_date >= ?
         ${exclude}
         AND (
           r.exclusivity_type = 'exclusive'
           OR ? = 'exclusive'
           OR (r.exclusivity_type = 'category_exclusive' AND r.exclusive_category IS NOT NULL AND r.exclusive_category = ?)
           OR (? = 'category_exclusive' AND ? IS NOT NULL AND r.exclusive_category = ?)
           OR (r.exclusivity_type = 'country_exclusive' AND r.exclusive_country IS NOT NULL AND r.exclusive_country = ?)
           OR (? = 'country_exclusive' AND ? IS NOT NULL AND r.exclusive_country = ?)
         )`,
      [
        ...params,
        exclusivity,
        input.category || null,
        exclusivity,
        input.category || null,
        input.category || null,
        input.country || null,
        exclusivity,
        input.country || null,
        input.country || null,
      ]
    );
    conflicts.push(...rows);
  }

  if (conflicts.length > 0) {
    await logEnterpriseEvent({
      eventType: "conflict_detected",
      message: "Reservation conflict detected.",
      metadata: { start_date: start, end_date: end, conflicts: conflicts.length },
    }, db);
  }
  return conflicts;
}

export async function createDirectDeal(body: any, db: Db = pool) {
  const advertiserId = Number(body.advertiser_id);
  if (!Number.isInteger(advertiserId) || advertiserId <= 0) throw new Error("Advertiser is required");
  const startDate = cleanDate(body.start_date);
  const endDate = cleanDate(body.end_date);
  if (new Date(endDate) < new Date(startDate)) throw new Error("End date must be after start date");
  const inventory = Array.isArray(body.selected_inventory) ? body.selected_inventory : [];
  if (inventory.length === 0) throw new Error("Select at least one inventory item");

  const exclusivity = normalizeExclusivity(body.exclusivity_type);
  const conflicts = await detectReservationConflicts({
    inventory,
    startDate,
    endDate,
    exclusivityType: exclusivity,
    category: body.exclusive_category,
    country: body.exclusive_country,
  }, db);
  if (conflicts.length > 0) {
    throw new Error(`Reservation conflict detected for ${conflicts.length} inventory item(s)`);
  }

  const [result]: any = await db.query(
    `INSERT INTO enterprise_direct_deals
      (advertiser_id, campaign_type, campaign_id, package_id, inventory_type, selected_inventory, start_date, end_date,
       fixed_cpm, total_budget, daily_cap, status, approval_status, exclusivity_type, exclusive_category, exclusive_country,
       reserved_impressions, overdelivery_allowed, priority_delivery, admin_notes)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, 1, ?)`,
    [
      advertiserId,
      String(body.campaign_type || "campaign"),
      body.campaign_id ? Number(body.campaign_id) : null,
      body.package_id ? Number(body.package_id) : null,
      String(body.inventory_type || "mixed"),
      JSON.stringify(inventory),
      startDate,
      endDate,
      numberValue(body.fixed_cpm),
      numberValue(body.total_budget),
      numberValue(body.daily_cap),
      exclusivity,
      body.exclusive_category || null,
      String(body.exclusive_country || "").toUpperCase().slice(0, 2) || null,
      Math.max(0, Math.round(numberValue(body.reserved_impressions))),
      body.overdelivery_allowed ? 1 : 0,
      String(body.admin_notes || "").trim() || null,
    ]
  );
  const dealId = Number(result.insertId);

  for (const item of inventory) {
    await db.query(
      `INSERT INTO enterprise_inventory_reservations
        (deal_id, campaign_type, campaign_id, inventory_type, inventory_id, start_date, end_date, reserved_impressions,
         exclusivity_type, exclusive_category, exclusive_country, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved')`,
      [
        dealId,
        String(body.campaign_type || "campaign"),
        body.campaign_id ? Number(body.campaign_id) : null,
        normalizeInventoryType(item.inventory_type),
        Number(item.inventory_id),
        startDate,
        endDate,
        Math.max(0, Math.round(numberValue(item.reserved_impressions, numberValue(body.reserved_impressions) / inventory.length))),
        exclusivity,
        body.exclusive_category || null,
        String(body.exclusive_country || "").toUpperCase().slice(0, 2) || null,
      ]
    );
  }

  await logEnterpriseEvent({ dealId, eventType: "deal_created", message: "Enterprise direct deal created.", metadata: { inventory_count: inventory.length } }, db);
  await logEnterpriseEvent({ dealId, eventType: "inventory_reserved", message: "Inventory reserved for enterprise deal.", metadata: { inventory_count: inventory.length } }, db);
  return dealId;
}

export async function updateDealStatus(id: number, action: string, db: Db = pool) {
  const dealId = Number(id);
  if (!Number.isInteger(dealId) || dealId <= 0) throw new Error("Invalid deal");
  const cleanAction = String(action || "");
  if (cleanAction === "approve") {
    await db.query("UPDATE enterprise_direct_deals SET approval_status = 'approved', status = 'active', approved_at = NOW() WHERE id = ?", [dealId]);
    await db.query("UPDATE enterprise_inventory_reservations SET status = 'active' WHERE deal_id = ?", [dealId]);
    await logEnterpriseEvent({ dealId, eventType: "deal_approved", message: "Enterprise deal approved." }, db);
    return;
  }
  if (cleanAction === "pause") {
    await db.query("UPDATE enterprise_direct_deals SET status = 'paused', paused_at = NOW() WHERE id = ?", [dealId]);
    await db.query("UPDATE enterprise_inventory_reservations SET status = 'paused' WHERE deal_id = ?", [dealId]);
    await logEnterpriseEvent({ dealId, eventType: "deal_paused", message: "Enterprise deal paused." }, db);
    return;
  }
  if (cleanAction === "resume") {
    await db.query("UPDATE enterprise_direct_deals SET status = 'active', resumed_at = NOW() WHERE id = ? AND approval_status = 'approved'", [dealId]);
    await db.query("UPDATE enterprise_inventory_reservations SET status = 'active' WHERE deal_id = ?", [dealId]);
    await logEnterpriseEvent({ dealId, eventType: "deal_resumed", message: "Enterprise deal resumed." }, db);
    return;
  }
  throw new Error("Invalid deal action");
}

export async function listDeals(db: Db = pool) {
  const [rows]: any = await db.query(
    `SELECT d.*, u.first_name, u.username, p.name as package_name,
            (SELECT COUNT(*) FROM enterprise_inventory_reservations r WHERE r.deal_id = d.id) as reservation_count
     FROM enterprise_direct_deals d
     LEFT JOIN users u ON u.id = d.advertiser_id
     LEFT JOIN sponsorship_packages p ON p.id = d.package_id
     ORDER BY d.updated_at DESC
     LIMIT 100`
  );
  return rows.map((row: any) => ({ ...row, selected_inventory: parseJson(row.selected_inventory, []), reporting: deliveryProgress(row) }));
}

export async function enterpriseSummary(db: Db = pool) {
  const [[dealSummary]]: any = await db.query(
    `SELECT
       COUNT(*) as total_deals,
       SUM(approval_status = 'pending') as pending_approvals,
       SUM(status = 'active') as active_deals,
       COALESCE(SUM(reserved_impressions), 0) as reserved_impressions,
       COALESCE(SUM(delivered_impressions), 0) as delivered_impressions,
       COALESCE(SUM(spend), 0) as spend
     FROM enterprise_direct_deals`
  );
  const [tierRows]: any = await db.query(
    `(SELECT COALESCE(enterprise_inventory_tier, 'standard') as tier, COUNT(*) as count FROM miniapps WHERE is_deleted = FALSE GROUP BY tier)
     UNION ALL
     (SELECT COALESCE(enterprise_inventory_tier, 'standard') as tier, COUNT(*) as count FROM channels WHERE is_deleted = FALSE GROUP BY tier)
     UNION ALL
     (SELECT COALESCE(enterprise_inventory_tier, 'standard') as tier, COUNT(*) as count FROM bots WHERE is_deleted = FALSE GROUP BY tier)`
  );
  const tiers = tierRows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.tier] = (acc[row.tier] || 0) + Number(row.count || 0);
    return acc;
  }, {});
  return { ...dealSummary, tiers };
}

export async function listPackages(db: Db = pool, publicOnly = false) {
  const [rows]: any = await db.query(
    `SELECT * FROM sponsorship_packages ${publicOnly ? "WHERE status = 'active'" : ""} ORDER BY package_price ASC, id ASC`
  );
  return rows;
}

export async function upsertPackage(body: any, db: Db = pool) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Package name is required");
  const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "").slice(0, 140);
  if (body.id) {
    await db.query(
      `UPDATE sponsorship_packages
       SET name = ?, slug = ?, description = ?, miniapp_impressions = ?, channel_posts = ?, bot_broadcasts = ?,
           featured_marketplace_days = ?, priority_support = ?, estimated_reach = ?, estimated_cpm = ?,
           package_price = ?, status = ?
       WHERE id = ?`,
      [
        name,
        slug,
        body.description || null,
        Math.round(numberValue(body.miniapp_impressions)),
        Math.round(numberValue(body.channel_posts)),
        Math.round(numberValue(body.bot_broadcasts)),
        Math.round(numberValue(body.featured_marketplace_days)),
        body.priority_support ? 1 : 0,
        Math.round(numberValue(body.estimated_reach)),
        numberValue(body.estimated_cpm),
        numberValue(body.package_price),
        ["active", "draft", "archived"].includes(String(body.status)) ? String(body.status) : "active",
        Number(body.id),
      ]
    );
    return Number(body.id);
  }
  const [result]: any = await db.query(
    `INSERT INTO sponsorship_packages
      (name, slug, description, miniapp_impressions, channel_posts, bot_broadcasts, featured_marketplace_days,
       priority_support, estimated_reach, estimated_cpm, package_price, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      slug,
      body.description || null,
      Math.round(numberValue(body.miniapp_impressions)),
      Math.round(numberValue(body.channel_posts)),
      Math.round(numberValue(body.bot_broadcasts)),
      Math.round(numberValue(body.featured_marketplace_days)),
      body.priority_support ? 1 : 0,
      Math.round(numberValue(body.estimated_reach)),
      numberValue(body.estimated_cpm),
      numberValue(body.package_price),
      ["active", "draft", "archived"].includes(String(body.status)) ? String(body.status) : "active",
    ]
  );
  return Number(result.insertId);
}

export async function createFeaturedListing(body: any, db: Db = pool) {
  const subjectType = String(body.subject_type || "");
  if (!["advertiser", "campaign", "inventory", "package"].includes(subjectType)) throw new Error("Invalid featured listing type");
  await db.query(
    `INSERT INTO enterprise_featured_marketplace_listings (subject_type, subject_id, title, placement, start_date, end_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      subjectType,
      Number(body.subject_id),
      String(body.title || "").trim() || null,
      String(body.placement || "marketplace"),
      cleanDate(body.start_date),
      cleanDate(body.end_date),
      ["active", "paused", "expired"].includes(String(body.status)) ? String(body.status) : "active",
    ]
  );
}
