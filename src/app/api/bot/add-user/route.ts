import { NextResponse } from "next/server";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2/promise";

type BotRow = RowDataPacket & { id: number };

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET() {
  return NextResponse.json({ error: "Use authenticated POST body; tokens are not accepted in query strings" }, { status: 405 });
}

export async function POST(request: Request) {
  const secret = clean(process.env.BOT_ADD_USER_SECRET);
  const suppliedSecret = clean(request.headers.get("x-bot-add-user-secret"));
  if (!secret || suppliedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const botToken = clean(body.bot_token);
  const chatId = clean(body.chat_id);

  if (!botToken || !chatId) {
    return NextResponse.json({ error: "Missing bot_token or chat_id" }, { status: 400 });
  }

  try {
    // 1. Find bot by token
    const [bots] = await pool.query<BotRow[]>(
      "SELECT id FROM bots WHERE bot_token = ? AND is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') = 'active'",
      [botToken]
    );
    if (bots.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }
    const botId = bots[0].id;

    // 2. Verify chat_id using Telegram
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const tgData = await tgRes.json();
    if (!tgData.ok) {
      return NextResponse.json({ error: "Invalid chat_id for this bot" }, { status: 400 });
    }

    // 3. Add to bot_users (reactivate if already exists)
    await pool.query(
      `INSERT INTO bot_users (bot_id, user_id, chat_id, is_active, status)
       VALUES (?, ?, ?, TRUE, 'active')
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), is_active = TRUE, status = 'active', inactive_reason = NULL`,
      [botId, chatId, chatId]
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Public Bot Add User API Error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
