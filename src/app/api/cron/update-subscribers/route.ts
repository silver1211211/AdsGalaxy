import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const isDev = process.env.MODE === "DEV";
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json({ error: "BOT_TOKEN not configured" }, { status: 500 });
    }

    // 1. Get Interval Bypass/Check (Cron Run Interval)
    const [cronSettings]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'last_subscriber_cron_run'");
    const lastRun = parseInt(cronSettings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_SUBSCRIBER_ADD_INTERVAL || "10");
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      const minutesLeft = Math.ceil((intervalMs - (now - lastRun)) / 60000);
      return NextResponse.json({
        success: false,
        message: `Too early. Please wait ${minutesLeft} more minutes.`
      }, { status: 429 });
    }

    // Update last run time
    await pool.query("UPDATE settings SET value = ? WHERE `key` = 'last_subscriber_cron_run'", [now.toString()]);
    
    // 2. Get Bot Info (to check its own status in channels)
    const botMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const botMeData = await botMeRes.json();
    if (!botMeData.ok) {
      return NextResponse.json({ error: "Failed to fetch bot info" }, { status: 500 });
    }
    const botId = botMeData.result.id;

    // 3. Find channels to process (exactly 5 per run)
    // - Not deleted
    // - Not paused
    // - Not updated in the last 24 hours (STRICT)
    const [channels]: any = await pool.query(`
      SELECT c.*, u.telegram_id as owner_telegram_id
      FROM channels c
      JOIN users u ON c.user_id = u.id
      WHERE c.is_deleted = FALSE 
      AND c.status = 'active'
      AND (c.last_subscriber_update_at IS NULL OR c.last_subscriber_update_at < NOW() - INTERVAL 1 DAY)
      ORDER BY c.last_subscriber_update_at ASC 
      LIMIT 5
    `);

    const results = [];

    for (const channel of channels) {
      try {
        // A. Check Member Count
        const countRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${channel.chat_id}`);
        const countData = await countRes.json();

        // B. Check Bot Status (is it still an admin?)
        const memberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channel.chat_id}&user_id=${botId}`);
        const memberData = await memberRes.json();

        let isBotActive = true;
        let reason = "";

        if (!countData.ok || !memberData.ok) {
          isBotActive = false;
          reason = countData.description || memberData.description || "Bot was removed or lost access";
        } else {
          const status = memberData.result.status;
          // Status must be administrator or creator
          if (status !== 'administrator' && status !== 'creator') {
            isBotActive = false;
            reason = "Bot is no longer an administrator";
          }
        }

        if (!isBotActive) {
          // Pause channel and notify publisher
          await pool.query(
            "UPDATE channels SET status = 'paused', last_subscriber_update_at = NOW() WHERE id = ?",
            [channel.id]
          );

          const notification = `⚠️ <b>Channel Paused</b>\n\nYour channel <b>${channel.title}</b> (@${channel.username}) has been paused because our bot was removed from admins or lost access.\n\nReason: <i>${reason}</i>\n\nPlease restore the bot's admin permissions and resume the channel from your dashboard.`;
          
          // Send notification safely (do not error if it fails)
          try {
            await sendTelegramMessage(channel.owner_telegram_id, notification);
          } catch (notifyErr) {
            console.error(`Failed to notify publisher for channel ${channel.id}:`, notifyErr);
          }

          results.push({ id: channel.id, username: channel.username, status: 'paused', reason });
        } else {
          // Update subscriber count
          const subscriberCount = countData.result;
          await pool.query(
            "UPDATE channels SET subscriber_count = ?, last_subscriber_update_at = NOW() WHERE id = ?",
            [subscriberCount, channel.id]
          );
          results.push({ id: channel.id, username: channel.username, status: 'updated', subscribers: subscriberCount });
        }
      } catch (channelErr: any) {
        console.error(`Error processing channel ${channel.id}:`, channelErr);
        results.push({ id: channel.id, username: channel.username, status: 'error', error: channelErr.message });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      details: results
    });

  } catch (error: any) {
    console.error("Subscriber Update Cron Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
