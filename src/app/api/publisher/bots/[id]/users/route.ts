import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import type { RowDataPacket } from "mysql2/promise";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { getBotAudienceStats } from "@/lib/botAudience";

type OwnerBotRow = RowDataPacket & { id: number; bot_token?: string; bot_token_encrypted?: string | null };
type ExistingUserRow = RowDataPacket & { chat_id: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal Server Error";
}

async function columnExists(tableName: string, columnName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
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
    const counts = await getBotAudienceStats(botId);
    
    return NextResponse.json({ 
      total: counts.total_users,
      active: counts.active_users,
      blocked: counts.blocked_users,
      integration_users: counts.integration_users,
      manually_imported: counts.manually_imported,
      verified_reachable: counts.reachable_users,
      pending_verification: counts.pending_verification
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
    const hasBotUserSource = await columnExists("bot_users", "source");
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
      const values = newChatIds.slice(i, i + 1000).map((id) => (
        hasBotUserSource
          ? [botId, id, id, "manual_publisher", false, "pending_verification"]
          : [botId, id, id, false, "pending_verification"]
      ));
      const [insert] = await pool.query<import("mysql2/promise").ResultSetHeader>(
        hasBotUserSource
          ? "INSERT IGNORE INTO bot_users (bot_id, user_id, chat_id, source, is_active, status) VALUES ?"
          : "INSERT IGNORE INTO bot_users (bot_id, user_id, chat_id, is_active, status) VALUES ?",
        [values]
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
