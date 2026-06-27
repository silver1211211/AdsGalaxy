import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id: botId } = await params;

    // Verify ownership
    const [bots]: any = await pool.query("SELECT id FROM bots WHERE id = ? AND user_id = ?", [botId, user.id]);
    if (bots.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    // Get detailed counts
    const [counts]: any = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = TRUE AND status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_active = FALSE OR status != 'active' THEN 1 ELSE 0 END) as blocked
       FROM bot_users WHERE bot_id = ?`, 
      [botId]
    );
    
    return NextResponse.json({ 
      total: counts[0].total || 0,
      active: counts[0].active || 0,
      blocked: counts[0].blocked || 0
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id: botId } = await params;

    const { chat_ids } = await request.json(); // Array of chat_ids

    if (!Array.isArray(chat_ids)) {
      return NextResponse.json({ error: "chat_ids must be an array" }, { status: 400 });
    }

    // 1. Verify ownership and get token
    const [bots]: any = await pool.query("SELECT id, bot_token FROM bots WHERE id = ? AND user_id = ?", [botId, user.id]);
    if (bots.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }
    const botToken = bots[0].bot_token;

    // 2. Filter out already added users
    const [existing]: any = await pool.query(
      "SELECT chat_id FROM bot_users WHERE bot_id = ? AND chat_id IN (?)",
      [botId, chat_ids]
    );
    const existingIds = new Set(existing.map((row: any) => row.chat_id.toString()));
    
    const alreadyAddedCount = existingIds.size;
    
    // Reactivate existing users if they were blocked
    if (alreadyAddedCount > 0) {
      await pool.query(
        "UPDATE bot_users SET is_active = TRUE, status = 'active', inactive_reason = NULL WHERE bot_id = ? AND chat_id IN (?)",
        [botId, Array.from(existingIds)]
      );
    }

    const newChatIds = chat_ids.filter(id => !existingIds.has(id.toString()));

    if (newChatIds.length === 0) {
      return NextResponse.json({
        newlyAdded: 0,
        alreadyAdded: alreadyAddedCount,
        invalid: 0
      });
    }

    // 3. Verify users using Telegram getChat
    // User said: "using their bot token, get user to see if they are real user"
    // We'll process in chunks of 10
    let newlyAddedCount = 0;
    let invalidCount = 0;

    const CHUNK_SIZE = 10;
    for (let i = 0; i < newChatIds.length; i += CHUNK_SIZE) {
      const chunk = newChatIds.slice(i, i + CHUNK_SIZE);
      
      const promises = chunk.map(async (chatId) => {
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`);
          const tgData = await tgRes.json();
          if (tgData.ok) {
            return chatId;
          }
        } catch (e) {}
        return null;
      });

      const results = await Promise.all(promises);
      const validIds = results.filter(id => id !== null);
      invalidCount += (chunk.length - validIds.length);

      if (validIds.length > 0) {
        // Bulk insert valid IDs
        const values = validIds.map(id => [botId, id, true, "active"]);
        await pool.query("INSERT IGNORE INTO bot_users (bot_id, chat_id, is_active, status) VALUES ?", [values]);
        newlyAddedCount += validIds.length;
      }
    }

    return NextResponse.json({
      newlyAdded: newlyAddedCount,
      alreadyAdded: alreadyAddedCount,
      invalid: invalidCount
    });
  } catch (error: any) {
    console.error("Bulk Add Bot Users Error:", error);
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}
