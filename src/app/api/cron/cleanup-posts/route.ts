import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new Error("BOT_TOKEN is missing");

    // Fetch active posts older than 24 hours
    const [postsToCleanup]: any = await pool.query(`
      SELECT id, message_id, channel_username 
      FROM campaign_posts 
      WHERE status = 'active' AND created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    const results = [];
    
    for (const post of postsToCleanup) {
      if (!post.channel_username || !post.message_id) {
        // Just mark as deleted if invalid data
        await pool.query("UPDATE campaign_posts SET status = 'deleted' WHERE id = ?", [post.id]);
        results.push({ id: post.id, status: "marked_deleted_invalid_data" });
        continue;
      }

      const chatId = post.channel_username.startsWith("@") ? post.channel_username : `@${post.channel_username}`;

      // Try deleting message from the channel
      let deleteSuccess = false;
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: post.message_id })
        });
        const data = await res.json();
        deleteSuccess = data.ok;
        if (!data.ok) {
          console.warn(`Failed to delete msg ${post.message_id} on ${chatId}:`, data.description);
        }
      } catch (err: any) {
        console.error(`Error deleting msg ${post.message_id}:`, err.message);
      }

      // Mark as deleted regardless of success (if bot was removed from channel, etc., we still want to mark it deleted)
      await pool.query("UPDATE campaign_posts SET status = 'deleted' WHERE id = ?", [post.id]);
      results.push({ id: post.id, telegram_deleted: deleteSuccess });
    }

    return NextResponse.json({ success: true, processed: results.length, details: results });
  } catch (error: any) {
    console.error("Cron Cleanup Posts Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
