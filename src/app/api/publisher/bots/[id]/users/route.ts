import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import type { RowDataPacket } from "mysql2/promise";
import { requireUserWritesAllowed } from "@/lib/productionSafety";

type OwnerBotRow = RowDataPacket & { id: number; bot_token?: string; bot_token_encrypted?: string | null };
type CountRow = RowDataPacket & { total: number; active: number | null; blocked: number | null; integration_users: number | null; manually_imported: number | null; pending_verification: number | null };
type ExistingUserRow = RowDataPacket & { chat_id: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal Server Error";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id: botId } = await params;

    // Verify ownership
    const [bots] = await pool.query<OwnerBotRow[]>("SELECT id FROM bots WHERE id = ? AND user_id = ?", [botId, user.id]);
    if (bots.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    // Get detailed counts
    const [counts] = await pool.query<CountRow[]>(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = TRUE AND status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_active = FALSE OR status IN ('inactive','blocked_bot','user_not_found','chat_not_found','unreachable') THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN source = 'integration' THEN 1 ELSE 0 END) as integration_users,
        SUM(CASE WHEN source <> 'integration' THEN 1 ELSE 0 END) as manually_imported,
        SUM(CASE WHEN status = 'pending_verification' THEN 1 ELSE 0 END) as pending_verification
       FROM bot_users WHERE bot_id = ?`, 
      [botId]
    );
    
    return NextResponse.json({ 
      total: counts[0].total || 0,
      active: counts[0].active || 0,
      blocked: counts[0].blocked || 0,
      integration_users: counts[0].integration_users || 0,
      manually_imported: counts[0].manually_imported || 0,
      verified_reachable: counts[0].active || 0,
      pending_verification: counts[0].pending_verification || 0
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id: botId } = await params;

    const { chat_ids } = await request.json(); // Array of chat_ids

    if (!Array.isArray(chat_ids)) {
      return NextResponse.json({ error: "chat_ids must be an array" }, { status: 400 });
    }
    const normalizedIds = [...new Set(chat_ids.map((value) => String(value).trim()).filter(Boolean))];
    if (normalizedIds.length === 0 || normalizedIds.length > 5000 || normalizedIds.some((value) => !/^[1-9]\d{4,19}$/.test(value))) {
      return NextResponse.json({ error: "Provide 1 to 5,000 unique numeric Telegram user IDs" }, { status: 400 });
    }

    const [bots] = await pool.query<OwnerBotRow[]>("SELECT id FROM bots WHERE id = ? AND user_id = ? AND is_deleted = FALSE", [botId, user.id]);
    if (bots.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }
    // Existing users remain untouched, including users registered through /start integration.
    const [existing] = await pool.query<ExistingUserRow[]>(
      "SELECT chat_id FROM bot_users WHERE bot_id = ? AND chat_id IN (?)",
      [botId, normalizedIds]
    );
    const existingIds = new Set(existing.map((row) => row.chat_id.toString()));
    
    const alreadyAddedCount = existingIds.size;
    
    const newChatIds = normalizedIds.filter(id => !existingIds.has(id));

    if (newChatIds.length === 0) {
      return NextResponse.json({
        newlyAdded: 0,
        alreadyAdded: alreadyAddedCount,
        invalid: 0
      });
    }

    let newlyAddedCount = 0;
    for (let i = 0; i < newChatIds.length; i += 1000) {
      const values = newChatIds.slice(i, i + 1000).map((id) => [botId, id, id, "manual_publisher", true, "pending_verification"]);
      const [insert] = await pool.query<import("mysql2/promise").ResultSetHeader>(
        "INSERT IGNORE INTO bot_users (bot_id, user_id, chat_id, source, is_active, status) VALUES ?", [values]
      );
      newlyAddedCount += insert.affectedRows;
    }

    return NextResponse.json({
      newlyAdded: newlyAddedCount,
      alreadyAdded: alreadyAddedCount,
      invalid: 0,
      pendingVerification: newlyAddedCount
    });
  } catch (error: unknown) {
    console.error("Bulk Add Bot Users Error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: getAuthErrorStatus(error) });
  }
}
