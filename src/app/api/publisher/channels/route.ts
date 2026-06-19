import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { normalizePostingTimes, normalizePostsPerDay } from "@/lib/postingTimes";

async function hasPostingTimesColumn() {
  const [rows]: any = await pool.query(`
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channels'
      AND COLUMN_NAME = 'posting_times'
    LIMIT 1
  `);

  return rows.length > 0;
}

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
    const { chat_id, username, title, posts_per_day, audience_continents, categories, posting_times } = body;
    const normalizedPostsPerDay = normalizePostsPerDay(posts_per_day);
    const normalizedPostingTimes = normalizePostingTimes(posting_times, normalizedPostsPerDay);
    const canStorePostingTimes = await hasPostingTimesColumn();

    if (!canStorePostingTimes) {
      console.warn("channels.posting_times column is missing; channel posting times will use runtime defaults");
    }

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
      const updateColumns = [
        "username = ?",
        "title = ?",
        "subscriber_count = ?",
        "posts_per_day = ?",
        "audience_continents = ?",
        "categories = ?",
        "is_deleted = FALSE",
        "status = 'pending'"
      ];
      const updateParams = [
        username,
        title,
        subscriberCount,
        normalizedPostsPerDay,
        JSON.stringify(audience_continents),
        JSON.stringify(categories || [])
      ];

      if (canStorePostingTimes) {
        updateColumns.splice(6, 0, "posting_times = ?");
        updateParams.push(JSON.stringify(normalizedPostingTimes));
      }

      updateParams.push(channel.id);

      await pool.query(
        `UPDATE channels SET ${updateColumns.join(", ")} WHERE id = ?`,
        updateParams
      );

      return NextResponse.json({ success: true, id: channel.id, message: "Channel reactivated and updated" });
    }

    // 4. Insert new channel
    const insertColumns = [
      "user_id",
      "chat_id",
      "username",
      "title",
      "subscriber_count",
      "posts_per_day",
      "audience_continents",
      "categories",
      "status"
    ];
    const insertParams = [
      user.id,
      chat_id,
      username,
      title,
      subscriberCount,
      normalizedPostsPerDay,
      JSON.stringify(audience_continents),
      JSON.stringify(categories || []),
      "pending"
    ];

    if (canStorePostingTimes) {
      insertColumns.splice(8, 0, "posting_times");
      insertParams.splice(8, 0, JSON.stringify(normalizedPostingTimes));
    }

    const placeholders = insertColumns.map(() => "?").join(", ");
    const [result] = await pool.query(
      `INSERT INTO channels (${insertColumns.join(", ")}) VALUES (${placeholders})`,
      insertParams
    );

    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to add channel" }, { status: 500 });
  }
}
