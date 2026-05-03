import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // Telegram sends various updates. 
    // Note: Bot API does NOT natively send a webhook when a message is deleted by a user.
    // However, we can handle other status changes here.

    if (update.my_chat_member) {
      const { chat, new_chat_member } = update.my_chat_member;
      if (new_chat_member.status === 'left' || new_chat_member.status === 'kicked') {
        // Bot was removed from channel, mark all posts as deleted for this channel
        await pool.query(
          "UPDATE campaign_posts SET status = 'deleted' WHERE channel_id = (SELECT id FROM channels WHERE chat_id = ?)",
          [chat.id]
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
