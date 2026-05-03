import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 0. Throttling (Configurable from .env, default 20 min)
    const isDev = process.env.MODE === "DEV";
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'last_settlement_run'");
    const lastRun = parseInt(settings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_SETTLEMENT_INTERVAL || "20");
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      const minutesLeft = Math.ceil((intervalMs - (now - lastRun)) / 60000);
      return NextResponse.json({ success: false, message: `Too early. Wait ${minutesLeft} min.` }, { status: 429 });
    }

    // Update last run
    await pool.query("UPDATE settings SET value = ? WHERE \`key\` = 'last_settlement_run'", [now.toString()]);

    // 1. Get Reward Percentage
    const [rewardSetting]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'click_ad_reward_percentage'");
    const rewardPercent = parseFloat(rewardSetting[0]?.value || "50") / 100;

    // 2. Fetch all active posts for 'clicks' campaigns that have unsettled clicks
    const [postsToSettle]: any = await pool.query(`
      SELECT 
        cp.id as post_id, 
        cp.campaign_id, 
        cp.channel_id, 
        cp.settled_clicks,
        c.cpm,
        c.name as campaign_name,
        c.user_id as advertiser_id,
        u_adv.telegram_id as advertiser_telegram_id,
        ch.user_id as publisher_id,
        (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) as current_total_clicks
      FROM campaign_posts cp
      JOIN campaigns c ON cp.campaign_id = c.id
      JOIN channels ch ON cp.channel_id = ch.id
      JOIN users u_adv ON c.user_id = u_adv.id
      WHERE c.type = 'clicks' AND c.status = 'active'
      HAVING current_total_clicks > settled_clicks
    `);

    const results = [];
    const conn = await pool.getConnection();

    try {
      for (const post of postsToSettle) {
        const newClicks = post.current_total_clicks - post.settled_clicks;
        if (newClicks <= 0) continue;

        const advertiserPaid = (newClicks * post.cpm) / 1000;
        const publisherReward = advertiserPaid * rewardPercent;

        await conn.beginTransaction();
        try {
          // A. Deduct from campaign budget
          const [updateResult]: any = await conn.query(
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
            // Pause campaign
            await conn.query(
              "UPDATE campaigns SET status = 'paused' WHERE id = ?",
              [post.campaign_id]
            );
            
            // Notify advertiser
            const notifyMsg = `🔴 <b>Campaign Paused: Out of Funds</b>\n\nYour campaign "<b>${post.campaign_name}</b>" has exhausted its budget and has been automatically paused.\n\nPlease add more funds to your campaign budget to resume ad distribution.`;
            await sendTelegramMessage(post.advertiser_telegram_id, notifyMsg);
          }

          // B. Add to publisher's locked balance
          await conn.query(
            "UPDATE users SET balance_locked = balance_locked + ? WHERE id = ?",
            [publisherReward, post.publisher_id]
          );

          // C. Log settlement
          await conn.query(`
            INSERT INTO ad_settlements (post_id, campaign_id, advertiser_id, channel_id, publisher_id, clicks_count, advertiser_paid, publisher_reward)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [post.post_id, post.campaign_id, post.advertiser_id, post.channel_id, post.publisher_id, newClicks, advertiserPaid, publisherReward]);

          // D. Update settled_clicks tracker
          await conn.query(
            "UPDATE campaign_posts SET settled_clicks = ? WHERE id = ?",
            [post.current_total_clicks, post.post_id]
          );

          await conn.commit();
          results.push({ post_id: post.post_id, settled: newClicks, paid: advertiserPaid, reward: publisherReward });
        } catch (err) {
          await conn.rollback();
          console.error(`Settlement failed for post ${post.post_id}:`, err);
        }
      }
    } finally {
      conn.release();
    }

    return NextResponse.json({
      success: true,
      processed_posts: results.length,
      details: results
    });

  } catch (error: any) {
    console.error("Settlement Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
