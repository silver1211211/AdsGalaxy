import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeMarketplaceType } from "@/lib/publisherMarketplace";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const [rows]: any = await pool.query(
      `SELECT
        l.id,
        l.name,
        l.created_at,
        l.updated_at,
        COALESCE(JSON_ARRAYAGG(
          CASE WHEN i.id IS NULL THEN NULL ELSE JSON_OBJECT('type', i.inventory_type, 'id', i.inventory_id) END
        ), JSON_ARRAY()) as items
       FROM inventory_lists l
       LEFT JOIN inventory_list_items i ON i.list_id = l.id
       WHERE l.advertiser_id = ?
       GROUP BY l.id, l.name, l.created_at, l.updated_at
       ORDER BY l.updated_at DESC`,
      [user.id]
    );
    return NextResponse.json({ lists: rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load lists" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json();
    const name = String(body.name || "Inventory List").trim().slice(0, 120);
    const [result]: any = await pool.query(
      "INSERT INTO inventory_lists (advertiser_id, name) VALUES (?, ?)",
      [user.id, name || "Inventory List"]
    );
    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create list" }, { status: getAuthErrorStatus(error) });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json();
    const listId = Number(body.list_id);
    const inventoryType = normalizeMarketplaceType(body.inventory_type);
    const inventoryId = Number(body.inventory_id);
    if (!Number.isInteger(listId) || !Number.isInteger(inventoryId) || listId <= 0 || inventoryId <= 0) {
      return NextResponse.json({ error: "Invalid list item" }, { status: 400 });
    }

    const [[list]]: any = await pool.query("SELECT id FROM inventory_lists WHERE id = ? AND advertiser_id = ?", [listId, user.id]);
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    await pool.query(
      `INSERT INTO inventory_list_items (list_id, inventory_type, inventory_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [listId, inventoryType, inventoryId]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update list" }, { status: getAuthErrorStatus(error) });
  }
}
