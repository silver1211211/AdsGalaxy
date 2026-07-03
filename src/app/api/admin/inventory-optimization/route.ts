import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin, requireAdminPermission } from "@/lib/adminAuth";
import {
  getDeliveryOptimizationSettings,
  publicInventoryQuality,
  refreshAllInventoryOptimization
} from "@/lib/inventoryOptimization";

const SETTINGS = new Set([
  "delivery_optimization_mode",
  "delivery_exploration_allocation_percent",
  "delivery_elite_inventory_boost",
  "delivery_manual_quality_weight",
  "delivery_manual_revenue_weight",
  "delivery_manual_consistency_weight",
  "delivery_manual_exploration_weight",
  "delivery_manual_override_weight",
  "inventory_attention_threshold",
]);

const OVERRIDES = new Set(["none", "boost", "reduce", "pause", "whitelist", "blacklist"]);

async function leaderboard(entityType: "miniapp" | "channel" | "bot") {
  if (entityType === "miniapp") {
    const [rows]: any = await pool.query(`
      SELECT
        m.id, m.miniapp_name as name, m.inventory_score, m.inventory_rank, m.traffic_quality_score, m.traffic_risk_level,
        m.inventory_override, m.inventory_priority_multiplier,
        COALESCE((SELECT SUM(ds.publisher_revenue) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)), 0) as revenue_7d,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = m.id AND ds.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)), 0) as impressions_7d
      FROM miniapps m
      WHERE m.is_deleted = FALSE
      ORDER BY m.inventory_score DESC, revenue_7d DESC
      LIMIT 20
    `);
    return rows.map((row: any) => ({ ...row, inventory_quality: publicInventoryQuality(row.inventory_score) }));
  }

  if (entityType === "channel") {
    const [rows]: any = await pool.query(`
      SELECT
        c.id, c.title as name, c.inventory_score, c.inventory_rank, c.traffic_quality_score, c.traffic_risk_level,
        c.inventory_override, c.inventory_priority_multiplier,
        COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.channel_id = c.id AND cp.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as impressions_7d,
        COALESCE((SELECT SUM(asett.publisher_reward) FROM ad_settlements asett JOIN campaign_posts cp ON cp.id = asett.post_id WHERE cp.channel_id = c.id AND asett.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as revenue_7d
      FROM channels c
      WHERE c.is_deleted = FALSE
      ORDER BY c.inventory_score DESC, revenue_7d DESC
      LIMIT 20
    `);
    return rows.map((row: any) => ({ ...row, inventory_quality: publicInventoryQuality(row.inventory_score) }));
  }

  const [rows]: any = await pool.query(`
    SELECT
      b.id, b.bot_name as name, b.inventory_score, b.inventory_rank, b.traffic_quality_score, b.traffic_risk_level,
      b.inventory_override, b.inventory_priority_multiplier,
      COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as impressions_7d,
      COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) as revenue_7d
    FROM bots b
    WHERE b.is_deleted = FALSE
    ORDER BY b.inventory_score DESC, revenue_7d DESC
    LIMIT 20
  `);
  return rows.map((row: any) => ({ ...row, inventory_quality: publicInventoryQuality(row.inventory_score) }));
}

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const refreshed = await refreshAllInventoryOptimization(100);
    const settings = await getDeliveryOptimizationSettings();
    const [queue]: any = await pool.query(`
      SELECT *
      FROM inventory_attention_queue
      WHERE status IN ('open', 'monitor')
      ORDER BY inventory_score ASC, created_at DESC
      LIMIT 100
    `);

    return NextResponse.json({
      settings,
      refreshed,
      leaderboards: {
        miniapps: await leaderboard("miniapp"),
        channels: await leaderboard("channel"),
        bots: await leaderboard("bot"),
      },
      attention_queue: queue,
    });
  } catch (error: any) {
    console.error("Inventory optimization dashboard error:", error);
    return NextResponse.json({ error: error.message || "Failed to load inventory optimization" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "setting") {
      const key = String(body.key || "");
      if (!SETTINGS.has(key)) return NextResponse.json({ error: "Invalid optimization setting" }, { status: 400 });
      await pool.query(
        "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [key, String(body.value ?? "")]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "override") {
      const entityType = String(body.entity_type || "");
      const entityId = Number(body.entity_id);
      const override = String(body.override || "none");
      const multiplier = Number(body.multiplier || 1);
      if (!["miniapp", "channel", "bot"].includes(entityType) || !Number.isInteger(entityId) || entityId <= 0 || !OVERRIDES.has(override)) {
        return NextResponse.json({ error: "Invalid inventory override" }, { status: 400 });
      }
      const table = entityType === "miniapp" ? "miniapps" : entityType === "channel" ? "channels" : "bots";
      await pool.query(
        `UPDATE ${table} SET inventory_override = ?, inventory_priority_multiplier = ?, inventory_notes = ?, inventory_updated_at = NOW() WHERE id = ?`,
        [override, Number.isFinite(multiplier) ? multiplier : 1, String(body.notes || ""), entityId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "queue") {
      const id = Number(body.id);
      const status = String(body.status || "");
      if (!Number.isInteger(id) || id <= 0 || !["review", "monitor", "pause"].includes(status)) {
        return NextResponse.json({ error: "Invalid queue action" }, { status: 400 });
      }
      const [rows]: any = await pool.query("SELECT * FROM inventory_attention_queue WHERE id = ?", [id]);
      if (rows.length === 0) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
      const item = rows[0];
      const nextStatus = status === "review" ? "reviewed" : status;
      await pool.query("UPDATE inventory_attention_queue SET status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?", [nextStatus, admin.id, id]);
      if (status === "pause") {
        const table = item.entity_type === "miniapp" ? "miniapps" : item.entity_type === "channel" ? "channels" : "bots";
        await pool.query(`UPDATE ${table} SET inventory_override = 'pause', inventory_updated_at = NOW() WHERE id = ?`, [item.entity_id]);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update inventory optimization" }, { status: 500 });
  }
}
