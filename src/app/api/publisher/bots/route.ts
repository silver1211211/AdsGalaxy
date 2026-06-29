import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

type ExistingBotRow = RowDataPacket & { id: number; user_id: number; is_deleted: boolean | number };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function tableExists(tableName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
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

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const [hasBroadcastDeliveries, hasWebhookTimestamp] = await Promise.all([
      tableExists("broadcast_deliveries"),
      columnExists("bots", "webhook_last_update_at"),
    ]);
    const botImpressionsExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id), 0)"
      : "0";
    const botRevenueExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id), 0)"
      : "0";
    const webhookTimestampExpr = hasWebhookTimestamp
      ? "b.webhook_last_update_at,"
      : "NULL as webhook_last_update_at,";

    const [rows] = await pool.query(
      `SELECT
        b.id,
        b.created_at,
        b.bot_name,
        b.bot_username,
        b.status,
        b.paused_reason,
        b.suggested_fix,
        b.health_status,
        b.health_checked_at,
        b.last_successful_broadcast_at,
        b.last_failure_at,
        b.failure_reason,
        ${webhookTimestampExpr}
        b.posts_per_day,
        b.categories,
        b.continents,
        b.marketplace_visible,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id) as subscriber_count,
        CASE
          WHEN b.status = 'active' AND COALESCE(b.health_status, 'active') = 'active'
            THEN (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = TRUE AND status = 'active')
          ELSE 0
        END as active_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND (is_active = FALSE OR status != 'active')) as blocked_count,
        ${botImpressionsExpr} as total_impressions,
        0 as total_clicks,
        ${botRevenueExpr} as total_revenue
       FROM bots b 
       WHERE b.user_id = ? AND b.is_deleted = FALSE 
       ORDER BY b.created_at DESC`, 
      [user.id]
    );
    return NextResponse.json(rows);
  } catch (error: unknown) {
    console.error("API Error:", error);
    return NextResponse.json({ error: errorMessage(error, "Failed to fetch bots") }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const body = await request.json();
    const { bot_token, posts_per_day, continents, categories } = body;

    if (!bot_token) {
      return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
    }

    // 1. Validate bot token with Telegram
    const tgRes = await fetch(`https://api.telegram.org/bot${bot_token}/getMe`);
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return NextResponse.json({ error: "Invalid bot token or Telegram API error" }, { status: 400 });
    }

    const { username: bot_username, first_name: bot_name } = tgData.result;

    // 2. Check if bot already exists
    const [existing] = await pool.query<ExistingBotRow[]>(
      "SELECT id, user_id, is_deleted FROM bots WHERE bot_token = ?",
      [bot_token]
    );

    if (existing.length > 0) {
      const bot = existing[0];
      
      if (bot.user_id !== user.id) {
        return NextResponse.json({ error: "This bot is already registered by another user" }, { status: 400 });
      }

      if (!bot.is_deleted) {
        return NextResponse.json({ error: "This bot is already active in your dashboard." }, { status: 400 });
      }

      // Reactivate soft-deleted bot
      await pool.query(
        `UPDATE bots SET 
          bot_username = ?, 
          bot_name = ?, 
          posts_per_day = ?, 
          continents = ?, 
          categories = ?,
          is_deleted = FALSE,
          status = 'pending',
          paused_reason = NULL,
          suggested_fix = NULL,
          health_status = NULL,
          failure_reason = NULL,
          reactivated_at = NOW()
         WHERE id = ?`,
        [bot_username, bot_name, posts_per_day, JSON.stringify(continents), JSON.stringify(categories || []), bot.id]
      );

      return NextResponse.json({ success: true, id: bot.id, message: "Bot reactivated and updated" });
    }

    // 3. Insert new bot
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO bots (user_id, bot_token, bot_username, bot_name, posts_per_day, continents, categories, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, bot_token, bot_username, bot_name, posts_per_day, JSON.stringify(continents), JSON.stringify(categories || [])]
    );

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error: unknown) {
    console.error("API Error:", error);
    return NextResponse.json({ error: errorMessage(error, "Failed to add bot") }, { status: getAuthErrorStatus(error) });
  }
}
