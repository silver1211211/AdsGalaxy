import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { markCampaignBudgetExhausted } from "@/lib/campaignLifecycle";

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

            // 5. Check if budget is exhausted
            const [updatedCampaign]: any = await conn.query("SELECT budget, status FROM campaigns WHERE id = ?", [campaign.id]);
            const remainingBudget = parseFloat(updatedCampaign[0]?.budget || "0");
            
            let budgetExhausted = false;
            if (remainingBudget <= 0 && updatedCampaign[0]?.status === 'active') {
              await markCampaignBudgetExhausted(campaign.id, conn);
              budgetExhausted = true;
            }
            
            await conn.commit();

            // 6. Notify advertiser if budget exhausted
            if (budgetExhausted) {
              try {
                const [advertiser]: any = await pool.query("SELECT chat_id FROM users WHERE id = ?", [campaign.user_id]);
                if (advertiser[0]?.chat_id) {
                  await sendTelegramMessage(advertiser[0].chat_id, `Campaign Budget Exhausted\n\nYour broadcast campaign "${campaign.name || 'Untitled'}" has exhausted its budget.\n\nPlease top up your budget to resume the broadcast.`, {
                    parse_mode: 'Markdown'
                  });
                }
              } catch (notifyErr) {
                console.error("Failed to notify advertiser:", notifyErr);
              }
            }

            return { 
              status: 'success', 
              user: user.id, 
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              cost: cost,
              remaining_budget: remainingBudget
            };
          } catch (e) {
            await conn.rollback();
            throw e;
          } finally {
            conn.release();
          }
        }
        if (!res?.ok && res?.description?.includes("Forbidden: bot was blocked by the user")) {
          await pool.query("UPDATE bot_users SET is_active = FALSE WHERE id = ?", [user.id]);
          return { 
            status: 'failed', 
            user: user.id, 
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            error: "Bot blocked by user - deactivated" 
          };
        }
        return { 
          status: 'failed', 
          user: user.id, 
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          error: res?.description || 'Unknown error' 
        };
      } catch (err: any) {
        if (err.message?.includes("Forbidden: bot was blocked by the user")) {
          await pool.query("UPDATE bot_users SET is_active = FALSE WHERE id = ?", [user.id]);
          return { 
            status: 'error', 
            user: user.id, 
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            error: "Bot blocked by user - deactivated" 
          };
        }
        return { 
          status: 'error', 
          user: user.id, 
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          error: err.message 
        };
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
