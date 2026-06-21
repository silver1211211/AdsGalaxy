import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [rows] = await pool.query(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id) as subscriber_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = TRUE) as active_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = FALSE) as blocked_count
       FROM bots b 
       WHERE b.user_id = ? AND b.is_deleted = FALSE 
       ORDER BY b.created_at DESC`, 
      [user.id]
    );
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch bots" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
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
    const [existing]: any = await pool.query(
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
          status = 'pending' 
         WHERE id = ?`,
        [bot_username, bot_name, posts_per_day, JSON.stringify(continents), JSON.stringify(categories || []), bot.id]
      );

      return NextResponse.json({ success: true, id: bot.id, message: "Bot reactivated and updated" });
    }

    // 3. Insert new bot
    const [result] = await pool.query(
      `INSERT INTO bots (user_id, bot_token, bot_username, bot_name, posts_per_day, continents, categories, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, bot_token, bot_username, bot_name, posts_per_day, JSON.stringify(continents), JSON.stringify(categories || [])]
    );

    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to add bot" }, { status: getAuthErrorStatus(error) });
  }
}
