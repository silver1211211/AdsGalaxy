import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [rows] = await pool.query(
      "SELECT * FROM channels WHERE user_id = ? AND is_deleted = FALSE ORDER BY created_at DESC", 
      [user.id]
    );
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch channels" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const body = await request.json();
    const { chat_id, username, title, posts_per_day, audience_continents, categories } = body;

    // 1. Get minimum subscribers requirement from settings
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'min_subscribers'");
    const minSubscribers = parseInt(settings[0]?.value || "0");

    // 2. Fetch current member count from Telegram
    const botToken = process.env.BOT_TOKEN;
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${chat_id}`);
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return NextResponse.json({ error: "Failed to verify channel member count. Make sure the bot is an admin." }, { status: 400 });
    }

    const subscriberCount = tgData.result;

    if (subscriberCount < minSubscribers) {
      return NextResponse.json({ 
        error: `Channel must have at least ${minSubscribers} subscribers. Current: ${subscriberCount}` 
      }, { status: 400 });
    }

    // 3. Check if channel already exists
    const [existing]: any = await pool.query(
      "SELECT id, user_id, is_deleted FROM channels WHERE chat_id = ?",
      [chat_id]
    );

    if (existing.length > 0) {
      const channel = existing[0];
      
      if (channel.user_id !== user.id) {
        return NextResponse.json({ error: "This channel is already registered by another user" }, { status: 400 });
      }

      // If it exists and NOT deleted, don't allow adding again
      if (!channel.is_deleted) {
        return NextResponse.json({ error: "This channel is already active in your dashboard." }, { status: 400 });
      }

      // If it belongs to same user and IS deleted, reactivate/update it
      await pool.query(
        `UPDATE channels SET 
          username = ?, 
          title = ?, 
          subscriber_count = ?,
          posts_per_day = ?, 
          audience_continents = ?, 
          categories = ?,
          is_deleted = FALSE, 
          status = 'pending' 
         WHERE id = ?`,
        [username, title, subscriberCount, posts_per_day, JSON.stringify(audience_continents), JSON.stringify(categories || []), channel.id]
      );

      return NextResponse.json({ success: true, id: channel.id, message: "Channel reactivated and updated" });
    }

    // 4. Insert new channel
    const [result] = await pool.query(
      `INSERT INTO channels (user_id, chat_id, username, title, subscriber_count, posts_per_day, audience_continents, categories, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, chat_id, username, title, subscriberCount, posts_per_day, JSON.stringify(audience_continents), JSON.stringify(categories || [])]
    );

    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to add channel" }, { status: 500 });
  }
}
