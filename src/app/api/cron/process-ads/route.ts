import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {

  try {
    const isDev = process.env.MODE === "DEV";
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'last_cron_run'");
    const lastRun = parseInt(settings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_POSTS_INTERVAL || "10");
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      const minutesLeft = Math.ceil((intervalMs - (now - lastRun)) / 60000);
      return NextResponse.json({
        success: false,
        message: `Too early. Please wait ${minutesLeft} more minutes.`
      }, { status: 429 });
    }


    await pool.query("UPDATE settings SET value = ? WHERE \`key\` = 'last_cron_run'", [now.toString()]);


    // 1. Get Campaign Limits rules
    const [limitRules]: any = await pool.query("SELECT * FROM campaign_limits ORDER BY budget_threshold ASC");

    const [campaigns]: any = await pool.query(`
      SELECT * FROM campaigns 
      WHERE status = 'active' AND budget > 0 AND type != 'broadcast'
      ORDER BY cpm DESC
    `);

    const results = [];

    for (const campaign of campaigns) {
      // A. Determine Daily Limit based on Budget
      let dailyLimit = 5; // Default fallback
      if (limitRules.length > 0) {
        const campaignBudget = parseFloat(campaign.budget);
        const matchedRule = limitRules.find((r: any) => campaignBudget <= parseFloat(r.budget_threshold));

        if (matchedRule) {
          dailyLimit = matchedRule.daily_placement_limit;
        } else {
          // If budget is higher than all thresholds, use the highest threshold's limit
          dailyLimit = limitRules[limitRules.length - 1].daily_placement_limit;
        }
      }

      // B. Count posts in last 24 hours
      const [postCountRow]: any = await pool.query(`
        SELECT COUNT(*) as count FROM campaign_posts 
        WHERE campaign_id = ? AND created_at > NOW() - INTERVAL 1 DAY
      `, [campaign.id]);

      const postedInLast24h = postCountRow[0].count;
      const remainingPostsToday = Math.max(0, dailyLimit - postedInLast24h);

      const postsToCreateThisRun = Math.min(remainingPostsToday, 5);

      // C. Find suitable channels
      const [suitableChannels]: any = await pool.query(`
        SELECT c.*
        FROM channels c
        WHERE c.status = 'active' AND c.is_deleted = FALSE
        AND c.user_id != ?
        -- Category Match
        AND JSON_CONTAINS(c.categories, JSON_QUOTE(?))
        -- Continent Match (Global or matches campaign continent)
        AND (
          JSON_CONTAINS(c.audience_continents, '"Global"')
          OR EXISTS (
            SELECT 1 FROM JSON_TABLE(?, '$[*]' COLUMNS (continent VARCHAR(50) PATH '$')) AS jt
            WHERE JSON_CONTAINS(LOWER(c.audience_continents), JSON_QUOTE(LOWER(jt.continent)))
          )
        )
        -- Daily limit check (24h)
        AND (
          SELECT COUNT(*) FROM campaign_posts cp 
          WHERE cp.channel_id = c.id AND cp.created_at > NOW() - INTERVAL 1 DAY
        ) < c.posts_per_day
        -- 6 hour cooldown check
        AND (
          NOT EXISTS (
            SELECT 1 FROM campaign_posts cp 
            WHERE cp.channel_id = c.id AND cp.created_at > NOW() - INTERVAL 6 HOUR
          )
        )
        ORDER BY RAND() 
        LIMIT ?
      `, [
        campaign.user_id,
        campaign.category,
        campaign.continents,
        postsToCreateThisRun
      ]);

      // E. Track results for this campaign
      const campaignInfo = {
        id: campaign.id,
        name: campaign.name,
        daily_limit: dailyLimit,
        remaining_today: remainingPostsToday,
        suitable_channels_found: suitableChannels.length,
        posts_created: 0,
        status: 'processed'
      };

      if (remainingPostsToday <= 0) {
        campaignInfo.status = 'daily_limit_reached';
        results.push(campaignInfo);
        continue;
      }

      if (suitableChannels.length === 0) {
        campaignInfo.status = 'no_suitable_channels_found';
        results.push(campaignInfo);
        continue;
      }

      let postsInThisRun = 0;
      for (const channel of suitableChannels) {
        if (postsInThisRun >= remainingPostsToday) break;

        // Create the post record FIRST to get the ID for the URL
        const [insertPost]: any = await pool.query(`
          INSERT INTO campaign_posts (campaign_id, channel_id, channel_username, status)
          VALUES (?, ?, ?, 'active')
        `, [campaign.id, channel.id, channel.username]);

        const postId = insertPost.insertId;

        const parseModeMap: any = { 'html': 'HTML', 'markdown': 'MarkdownV2', 'none': undefined };
        const parseMode = parseModeMap[campaign.parse_mode] || 'HTML';

        const domain = process.env.DOMAIN;
        const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin);
        const buttonUrl = campaign.type === 'clicks'
          ? `${host}/api/clicks/${campaign.id}/${postId}`
          : campaign.link;

        const replyMarkup = {
          inline_keyboard: [
            [{ text: campaign.button_text, url: buttonUrl }],
            [{ text: "Advertise with Ads galaxy", url: "https://t.me/Ads_Galaxy_bot?start=advertise" }]
          ]
        };

        const result = await sendTelegramMessage(channel.chat_id, campaign.message_text, {
          photo: campaign.image_url,
          parse_mode: parseMode,
          reply_markup: replyMarkup
        });

        if (result && result.ok) {
          const messageId = result.result.message_id;

          await pool.query(
            "UPDATE campaign_posts SET message_id = ? WHERE id = ?",
            [messageId, postId]
          );

          postsInThisRun++;
          campaignInfo.posts_created++;
        } else {
          // If sending fails, delete the placeholder post
          await pool.query("DELETE FROM campaign_posts WHERE id = ?", [postId]);
        }
      }
      results.push(campaignInfo);
    }

    const successfulResults = results.filter((r: any) => r.posts_created > 0);

    return NextResponse.json({
      success: true,
      processed_campaigns: successfulResults.length,
      posts_created: successfulResults.reduce((acc: number, curr: any) => acc + (curr.posts_created || 0), 0),
      details: successfulResults
    });

  } catch (error) {
    console.error("Cron Processing Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
