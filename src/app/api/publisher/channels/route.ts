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
    const { chat_id, username, title, posts_per_day, audience_continents } = body;

    // 1. Check if channel already exists
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
          posts_per_day = ?, 
          audience_continents = ?, 
          is_deleted = FALSE, 
          status = 'pending' 
         WHERE id = ?`,
        [username, title, posts_per_day, JSON.stringify(audience_continents), channel.id]
      );

      return NextResponse.json({ success: true, id: channel.id, message: "Channel reactivated and updated" });
    }

    // 2. Insert new channel
    const [result] = await pool.query(
      `INSERT INTO channels (user_id, chat_id, username, title, posts_per_day, audience_continents, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, chat_id, username, title, posts_per_day, JSON.stringify(audience_continents)]
    );

    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to add channel" }, { status: 500 });
  }
}
