import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const botToken = searchParams.get("bot_token");
  const chatId = searchParams.get("chat_id");

  if (!botToken || !chatId) {
    return NextResponse.json({ error: "Missing bot_token or chat_id" }, { status: 400 });
  }

  try {
    // 1. Find bot by token
    const [bots]: any = await pool.query("SELECT id FROM bots WHERE bot_token = ? AND is_deleted = FALSE", [botToken]);
    if (bots.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }
    const botId = bots[0].id;

    // 2. Verify chat_id using Telegram
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`);
    const tgData = await tgRes.json();
    if (!tgData.ok) {
      return NextResponse.json({ error: "Invalid chat_id for this bot" }, { status: 400 });
    }

    // 3. Add to bot_users (reactivate if already exists)
    await pool.query(
      "INSERT INTO bot_users (bot_id, chat_id, is_active) VALUES (?, ?, TRUE) ON DUPLICATE KEY UPDATE is_active = TRUE", 
      [botId, chatId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Public Bot Add User API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
