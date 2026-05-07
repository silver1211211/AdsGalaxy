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

      if (remainingPostsToday <= 0) {
        continue;
      }

      // C. Limit to 5 per cron run
      const postsToCreateThisRun = Math.min(remainingPostsToday, 5);

      // D. Find suitable channels
      const [channels]: any = await pool.query(`
        SELECT c.*, 
        (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id = c.id AND cp.created_at > NOW() - INTERVAL 1 DAY) as daily_posts,
        (SELECT MAX(created_at) FROM campaign_posts cp WHERE cp.channel_id = c.id) as last_post_at
        FROM channels c
        WHERE c.status = 'active' AND c.is_deleted = FALSE
        AND c.user_id != ?
      `, [campaign.user_id]);

      const suitableChannels = channels.filter((channel: any) => {
        // 1. Category Matching (Campaign category must be in channel categories)
        const campaignCategory = campaign.category;
        const channelCategories = channel.categories ? (typeof channel.categories === 'string' ? JSON.parse(channel.categories) : channel.categories) : [];
        
        if (!channelCategories.includes(campaignCategory)) return false;

        // 2. Continent Matching
        const campaignConts = campaign.continents ? (typeof campaign.continents === 'string' ? JSON.parse(campaign.continents) : campaign.continents) : [];
        const channelConts = channel.audience_continents ? (typeof channel.audience_continents === 'string' ? JSON.parse(channel.audience_continents) : channel.audience_continents) : [];

        if (campaignConts.length > 0) {
          const hasMatch = campaignConts.some((cont: string) => channelConts.includes(cont) || channelConts.includes("Global"));
          if (!hasMatch) return false;
        }

        if (channel.daily_posts >= channel.posts_per_day) return false;

        if (channel.last_post_at) {
          const lastPost = new Date(channel.last_post_at).getTime();
          const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
          if (lastPost > sixHoursAgo) return false;
        }

        return true;
      }).slice(0, postsToCreateThisRun);



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
          results.push({ campaign: campaign.id, channel: channel.username, status: 'success', post_id: postId });
        } else {
          // If sending fails, delete the placeholder post
          await pool.query("DELETE FROM campaign_posts WHERE id = ?", [postId]);
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed_campaigns: campaigns.length,
      posts_created: results.length,
      details: results
    });

  } catch (error) {
    console.error("Cron Processing Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
