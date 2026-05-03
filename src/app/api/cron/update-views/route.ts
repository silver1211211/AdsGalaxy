import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = 'force-dynamic';

async function getChat(chatId: string | number) {
  const token = process.env.BOT_TOKEN;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    // 0. Throttling (1 minute)
    const isDev = process.env.MODE === "DEV";
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'last_views_check'");
    const lastRun = parseInt(settings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_VIEWS_INTERVAL || "1");
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      const minutesLeft = Math.ceil((intervalMs - (now - lastRun)) / 60000);
      return NextResponse.json({ success: false, message: `Too early. Wait ${minutesLeft} min.` }, { status: 429 });
    }

    // Update last run immediately
    await pool.query("UPDATE settings SET value = ? WHERE \`key\` = 'last_views_check'", [now.toString()]);

    // 1. Get up to 10 active/non-deleted posts
    const [posts]: any = await pool.query(`
      SELECT cp.*, ch.chat_id, ch.username as channel_username, ch.user_id as owner_id, u.telegram_id as owner_telegram_id
      FROM campaign_posts cp
      JOIN channels ch ON cp.channel_id = ch.id
      JOIN users u ON ch.user_id = u.id
      WHERE cp.status = 'active'
      ORDER BY cp.created_at ASC
      LIMIT 10
    `);

    if (posts.length === 0) {
      return NextResponse.json({ success: true, message: "No active posts to check." });
    }

    const results = [];

    for (const post of posts) {
      try {
        const apiUrl = `https://php.arijitiyan.cc/tgview/api.php?channel=${post.channel_username}&post=${post.message_id}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (data.status === "success") {
          const views = parseInt(data.views || "0");
          const lastViews = post.views || 0;

          // Always update post views (Manual team will validate later)
          await pool.query("UPDATE campaign_posts SET views = ? WHERE id = ?", [views, post.id]);

          // Save to audit (defaults to 'valid')
          await pool.query(`
            INSERT INTO campaign_views_audit (post_id, channel_id, total_views, last_views_count, status)
            VALUES (?, ?, ?, ?, 'valid')
          `, [post.id, post.channel_id, views, lastViews]);

          results.push({ post_id: post.id, views: views, prev_views: lastViews });
        } 
        else if (data.status === "post-not-found") {
          // Mark as deleted
          await pool.query("UPDATE campaign_posts SET status = 'deleted' WHERE id = ?", [post.id]);
          results.push({ post_id: post.id, status: 'deleted' });
        } 
        else if (data.status === "channel-not-found") {
          // Attempt to update username
          const chatInfo = await getChat(post.chat_id);
          
          if (chatInfo?.ok && chatInfo.result.username) {
            const newUsername = chatInfo.result.username;
            await pool.query("UPDATE channels SET username = ? WHERE id = ?", [newUsername, post.channel_id]);
            results.push({ post_id: post.id, status: 'username_updated', new_username: newUsername });
          } else {
            // Pause channel and notify owner
            await pool.query("UPDATE channels SET status = 'paused' WHERE id = ?", [post.channel_id]);
            
            const notifyMsg = `⚠️ <b>Action Required: Channel Access Lost</b>\n\nHello! Your channel (ID: ${post.chat_id}) has no public username or has changed. We have temporarily paused your channel's status.\n\nPlease add a public username to your channel and resume it from your dashboard to continue earning.`;
            
            await sendTelegramMessage(post.owner_telegram_id, notifyMsg);
            results.push({ post_id: post.id, status: 'channel_paused_owner_notified' });
          }
        }
      } catch (err: any) {
        console.error(`Error checking views for post ${post.id}:`, err.message);
        results.push({ post_id: post.id, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      details: results
    });

  } catch (error: any) {
    console.error("Views Update Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
