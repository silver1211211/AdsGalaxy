import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const isDev = process.env.MODE === "DEV";
    const [cronSettings]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'last_broadcast_cron_run'");
    const lastRun = parseInt(cronSettings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_BROADCAST_INTERVAL || "1"); // Default to 1 min if not set
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      return NextResponse.json({ success: false, message: "Too early" }, { status: 429 });
    }

    await pool.query("UPDATE settings SET value = ? WHERE \`key\` = 'last_broadcast_cron_run'", [now.toString()]);

    // Get reward percentage
    const [rewardSetting]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'broadcast_ad_reward_percentage'");
    const rewardPercentage = parseFloat(rewardSetting[0]?.value || "50") / 100;

    // 1. Find active broadcast campaigns with budget
    const [campaigns]: any = await pool.query(`
      SELECT * FROM campaigns 
      WHERE type = 'broadcast' AND status = 'active' AND budget > 0 
      ORDER BY cpm DESC
    `);

    let totalDispatched = 0;
    const limit = 20;
    const dispatches = [];

    for (const campaign of campaigns) {
      if (totalDispatched >= limit) break;

      // Find suitable bots
      const [bots]: any = await pool.query(`
        SELECT * FROM bots 
        WHERE status = 'active' AND is_deleted = FALSE
        AND user_id != ?
      `, [campaign.user_id]);

      const suitableBots = bots.filter((bot: any) => {
        // Category match
        const botCats = bot.categories ? (typeof bot.categories === 'string' ? JSON.parse(bot.categories) : bot.categories) : [];
        if (!botCats.includes(campaign.category)) return false;

        // Continent match
        const campConts = campaign.continents ? (typeof campaign.continents === 'string' ? JSON.parse(campaign.continents) : campaign.continents) : [];
        const botConts = bot.continents ? (typeof bot.continents === 'string' ? JSON.parse(bot.continents) : bot.continents) : [];
        if (campConts.length > 0) {
          const hasMatch = campConts.some((c: string) => botConts.includes(c) || botConts.includes("Global"));
          if (!hasMatch) return false;
        }
        return true;
      });

      for (const bot of suitableBots) {
        if (totalDispatched >= limit) break;

        // Find users for this bot that are eligible
        // posts_per_day logic:
        // 1: last_broadcast_at < 24h ago
        // 2: last_broadcast_at < 6h ago AND count in 24h < 2
        // Generalizing: last_broadcast_at < (24/posts_per_day) hours ago AND count in 24h < posts_per_day
        
        const hoursInterval = 24 / bot.posts_per_day;
        
        const [users]: any = await pool.query(`
          SELECT bu.* 
          FROM bot_users bu
          WHERE bu.bot_id = ? AND bu.is_active = TRUE
          AND (bu.last_broadcast_at IS NULL OR bu.last_broadcast_at < NOW() - INTERVAL ? HOUR)
          AND (
            SELECT COUNT(*) FROM broadcast_deliveries bd 
            WHERE bd.user_id = bu.id AND bd.created_at > NOW() - INTERVAL 1 DAY
          ) < ?
          LIMIT ?
        `, [bot.id, hoursInterval, bot.posts_per_day, limit - totalDispatched]);

        for (const user of users) {
          dispatches.push({ campaign, bot, user });
          totalDispatched++;
        }
      }
    }

    if (dispatches.length === 0) {
      return NextResponse.json({ success: true, processed: 0 });
    }

    // Execute dispatches "together"
    const results = await Promise.all(dispatches.map(async ({ campaign, bot, user }) => {
      try {
        const parseModeMap: any = { 'html': 'HTML', 'markdown': 'MarkdownV2', 'none': undefined };
        const parseMode = parseModeMap[campaign.parse_mode] || 'HTML';
        
        const replyMarkup = {
          inline_keyboard: [[
            { text: campaign.button_text, url: campaign.link }
          ]]
        };

        // We use the bot's token to send the message
        const res = await sendTelegramMessage(user.chat_id, campaign.message_text, {
          photo: campaign.image_url,
          parse_mode: parseMode,
          reply_markup: replyMarkup,
          token: bot.bot_token // Need to update sendTelegramMessage to support custom token
        });

        if (res && res.ok) {
          const cost = parseFloat(campaign.cpm) / 1000;
          const reward = cost * rewardPercentage;

          // Transactional updates
          const conn = await pool.getConnection();
          try {
            await conn.beginTransaction();
            
            // 1. Deduct budget
            await conn.query("UPDATE campaigns SET budget = budget - ? WHERE id = ?", [cost, campaign.id]);
            
            // 2. Add reward to publisher
            await conn.query("UPDATE users SET balance_available = balance_available + ? WHERE id = ?", [reward, bot.user_id]);
            
            // 3. Record delivery
            await conn.query(`
              INSERT INTO broadcast_deliveries (campaign_id, bot_id, user_id, chat_id, cost, publisher_reward)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [campaign.id, bot.id, user.id, user.chat_id, cost, reward]);
            
            // 4. Update last_broadcast_at
            await conn.query("UPDATE bot_users SET last_broadcast_at = NOW() WHERE id = ?", [user.id]);
            
            await conn.commit();
            return { status: 'success', user: user.id };
          } catch (e) {
            await conn.rollback();
            throw e;
          } finally {
            conn.release();
          }
        }
        return { status: 'failed', user: user.id, error: res?.description || 'Unknown error' };
      } catch (err: any) {
        return { status: 'error', user: user.id, error: err.message };
      }
    }));

    return NextResponse.json({
      success: true,
      processed: results.length,
      details: results
    });

  } catch (error: any) {
    console.error("Broadcast Cron Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
