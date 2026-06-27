import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { normalizeMarketplaceType, publicMarketplaceQuality, publicInventoryRank } from "@/lib/publisherMarketplace";

const tables = {
  miniapp: { table: "miniapps", name: "miniapp_name", username: "miniapp_username" },
  channel: { table: "channels", name: "title", username: "username" },
  bot: { table: "bots", name: "bot_name", username: "bot_username" },
};

function serialize(row: any) {
  return {
    ...row,
    traffic_quality_rating: publicMarketplaceQuality(row.traffic_quality_score),
    inventory_rank_label: publicInventoryRank(row.inventory_rank),
  };
}

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all";
  const search = searchParams.get("search") || "";
  const params: Array<string | number> = [];

  const selectedTypes = type === "all" ? ["miniapp", "channel", "bot"] : [normalizeMarketplaceType(type)];
  const parts = selectedTypes.map((kind) => {
    const cfg = tables[kind as keyof typeof tables];
    let where = `WHERE i.is_deleted = FALSE`;
    if (search) {
      where += ` AND (i.${cfg.name} LIKE ? OR i.${cfg.username} LIKE ? OR i.marketplace_category LIKE ? OR i.marketplace_country LIKE ? OR i.marketplace_language LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q, q, q);
    }
    return `
      SELECT
        '${kind}' as inventory_type,
        i.id,
        i.${cfg.name} as name,
        i.${cfg.username} as username,
        i.status,
        i.marketplace_visible,
        i.marketplace_admin_status,
        i.marketplace_featured,
        i.marketplace_pinned,
        i.marketplace_highlighted,
        i.marketplace_category,
        i.marketplace_country,
        i.marketplace_language,
        i.marketplace_average_cpm,
        i.marketplace_direct_min_cpm,
        i.marketplace_premium_cpm,
        i.marketplace_featured_cpm,
        i.marketplace_monthly_impressions,
        i.marketplace_avg_completion_rate,
        COALESCE(i.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(i.inventory_rank, 'standard') as inventory_rank
      FROM ${cfg.table} i
      ${where}
    `;
  });

  const [rows]: any = await pool.query(`${parts.join(" UNION ALL ")} ORDER BY marketplace_pinned DESC, marketplace_featured DESC, id DESC LIMIT 200`, params);
  return NextResponse.json({ inventory: rows.map(serialize) });
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const type = normalizeMarketplaceType(body.inventory_type);
  const id = Number(body.inventory_id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid inventory" }, { status: 400 });
  }

  const cfg = tables[type];
  const adminStatus = ["approved", "hidden", "removed", "pending"].includes(String(body.marketplace_admin_status))
    ? String(body.marketplace_admin_status)
    : "approved";

  await pool.query(
    `UPDATE ${cfg.table}
     SET marketplace_visible = ?,
         marketplace_admin_status = ?,
         marketplace_featured = ?,
         marketplace_pinned = ?,
         marketplace_highlighted = ?,
         marketplace_category = ?,
         marketplace_country = ?,
         marketplace_language = ?,
         marketplace_average_cpm = ?,
         marketplace_direct_min_cpm = ?,
         marketplace_premium_cpm = ?,
         marketplace_featured_cpm = ?,
         marketplace_monthly_impressions = ?,
         marketplace_avg_completion_rate = ?
     WHERE id = ?`,
    [
      body.marketplace_visible ? 1 : 0,
      adminStatus,
      body.marketplace_featured ? 1 : 0,
      body.marketplace_pinned ? 1 : 0,
      body.marketplace_highlighted ? 1 : 0,
      String(body.marketplace_category || "").trim() || null,
      String(body.marketplace_country || "").trim().toUpperCase().slice(0, 2) || null,
      String(body.marketplace_language || "").trim().toLowerCase().slice(0, 16) || null,
      body.marketplace_average_cpm === "" ? null : Number(body.marketplace_average_cpm || 0),
      body.marketplace_direct_min_cpm === "" ? null : Number(body.marketplace_direct_min_cpm || 0),
      body.marketplace_premium_cpm === "" ? null : Number(body.marketplace_premium_cpm || 0),
      body.marketplace_featured_cpm === "" ? null : Number(body.marketplace_featured_cpm || 0),
      Number(body.marketplace_monthly_impressions || 0),
      Number(body.marketplace_avg_completion_rate || 0),
      id,
    ]
  );

  return NextResponse.json({ success: true });
}
