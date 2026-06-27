import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeMarketplaceType, recordMarketplaceEvent } from "@/lib/publisherMarketplace";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const [favorites]: any = await pool.query(
      "SELECT inventory_type, inventory_id, created_at FROM inventory_favorites WHERE advertiser_id = ? ORDER BY created_at DESC",
      [user.id]
    );
    const [lists]: any = await pool.query(
      `SELECT l.id, l.name, l.created_at, l.updated_at, COUNT(i.id) as item_count
       FROM inventory_lists l
       LEFT JOIN inventory_list_items i ON i.list_id = l.id
       WHERE l.advertiser_id = ?
       GROUP BY l.id, l.name, l.created_at, l.updated_at
       ORDER BY l.updated_at DESC`,
      [user.id]
    );
    return NextResponse.json({ favorites, lists });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load favorites" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json();
    const inventoryType = normalizeMarketplaceType(body.inventory_type);
    const inventoryId = Number(body.inventory_id);
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      return NextResponse.json({ error: "Invalid inventory" }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO inventory_favorites (advertiser_id, inventory_type, inventory_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [user.id, inventoryType, inventoryId]
    );
    await recordMarketplaceEvent({ advertiserId: user.id, inventoryType, inventoryId, eventType: "favorite" });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save favorite" }, { status: getAuthErrorStatus(error) });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { searchParams } = new URL(request.url);
    const inventoryType = normalizeMarketplaceType(searchParams.get("inventory_type"));
    const inventoryId = Number(searchParams.get("inventory_id"));
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      return NextResponse.json({ error: "Invalid inventory" }, { status: 400 });
    }

    await pool.query(
      "DELETE FROM inventory_favorites WHERE advertiser_id = ? AND inventory_type = ? AND inventory_id = ?",
      [user.id, inventoryType, inventoryId]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to remove favorite" }, { status: getAuthErrorStatus(error) });
  }
}
