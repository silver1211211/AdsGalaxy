import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { markCampaignBudgetExhausted } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 0. Throttling (Configurable from .env, default 20 min)
    const isDev = process.env.MODE === "DEV";
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'last_settlement_views_run'");
    const lastRun = parseInt(settings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_SETTLEMENT_INTERVAL || "20");
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      const minutesLeft = Math.ceil((intervalMs - (now - lastRun)) / 60000);
      return NextResponse.json({ success: false, message: `Too early. Wait ${minutesLeft} min.` }, { status: 429 });
    }

    // Update last run
    await pool.query("UPDATE settings SET value = ? WHERE \`key\` = 'last_settlement_views_run'", [now.toString()]);

    // 1. Get Reward Percentage
    const [rewardSetting]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'view_ad_reward_percentage'");
    const rewardPercent = parseFloat(rewardSetting[0]?.value || "50") / 100;

    // 2. Fetch all active posts for 'views' campaigns that have unsettled views
    // We compare cp.views with cp.settled_views
    const [postsToSettle]: any = await pool.query(`
      SELECT
        cp.id as post_id,
        cp.campaign_id,
        cp.channel_id,
        cp.settled_views,
        cp.views as current_total_views,
        c.cpm,
        c.name as campaign_name,
        c.user_id as advertiser_id,
        u_adv.telegram_id as advertiser_telegram_id,
        ch.user_id as publisher_id
      FROM campaign_posts cp
      JOIN campaigns c ON cp.campaign_id = c.id
      JOIN channels ch ON cp.channel_id = ch.id
      JOIN users u_adv ON c.user_id = u_adv.id
      WHERE c.type = 'views' AND c.status = 'active'
      AND cp.views > cp.settled_views
    `);

    const results = [];
    const conn = await pool.getConnection();
    const exhaustedCampaigns = new Map<number, { id: number; name: string; advertiser_telegram_id: string | number }>();

    try {
      for (const post of postsToSettle) {
        const newViews = post.current_total_views - post.settled_views;
        if (newViews <= 0) continue;

        const advertiserPaid = (newViews * post.cpm) / 1000;
        const publisherReward = advertiserPaid * rewardPercent;

        await conn.beginTransaction();
        try {
          // A. Deduct from campaign budget
          await conn.query(
            "UPDATE campaigns SET budget = budget - ? WHERE id = ?",
            [advertiserPaid, post.campaign_id]
          );

          // Check if budget is exhausted
          const [campaignCheck]: any = await conn.query(
            "SELECT budget, name FROM campaigns WHERE id = ?",
            [post.campaign_id]
          );
          const currentBudget = parseFloat(campaignCheck[0].budget);

          if (currentBudget <= 0) {
            await markCampaignBudgetExhausted(post.campaign_id, conn);
            exhaustedCampaigns.set(post.campaign_id, {
              id: post.campaign_id,
              name: post.campaign_name,
              advertiser_telegram_id: post.advertiser_telegram_id,
            });
          }

          // B. Add to publisher's locked balance
          await conn.query(
            "UPDATE users SET balance_locked = balance_locked + ? WHERE id = ?",
            [publisherReward, post.publisher_id]
          );

          // C. Log settlement
          await conn.query(`
            INSERT INTO ad_settlements_views (post_id, campaign_id, advertiser_id, channel_id, publisher_id, views_count, advertiser_paid, publisher_reward, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'locked')
          `, [post.post_id, post.campaign_id, post.advertiser_id, post.channel_id, post.publisher_id, newViews, advertiserPaid, publisherReward]);

          // D. Update settled_views tracker
          await conn.query(
            "UPDATE campaign_posts SET settled_views = ? WHERE id = ?",
            [post.current_total_views, post.post_id]
          );

          await conn.commit();
          results.push({ post_id: post.post_id, settled_views: newViews, paid: advertiserPaid, reward: publisherReward });
        } catch (err) {
          await conn.rollback();
          console.error(`Views settlement failed for post ${post.post_id}:`, err);
        }
      }
    } finally {
      conn.release();
    }

    for (const campaign of exhaustedCampaigns.values()) {
      await deleteActiveCampaignPosts(campaign.id);
      const notifyMsg = `Campaign Budget Exhausted\n\nYour campaign "${campaign.name}" has exhausted its budget.\n\nPlease add more funds to reactivate ad distribution.`;
      await sendTelegramMessage(campaign.advertiser_telegram_id, notifyMsg);
    }

    return NextResponse.json({
      success: true,
      processed_posts: results.length,
      details: results
    });

  } catch (error: any) {
    console.error("Views Settlement Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
