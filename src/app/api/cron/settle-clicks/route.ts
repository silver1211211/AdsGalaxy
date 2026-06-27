import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { markCampaignBudgetExhausted } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";
import { creditUserLockedBalance } from "@/lib/earnings";
import { recordPayoutSafetyCheck } from "@/lib/revenueProtection";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { ensureClassicSettlementColumns } from "@/lib/schemaGuards";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("settle-clicks", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Click settlement cron is already running" }, { status: 409 });
  }

  try {
    await ensureClassicSettlementColumns();

    // 0. Throttling (Configurable from .env, default 20 min)
    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_SETTLEMENT_INTERVAL || "20");
    const intervalMs = intervalMinutes * 60 * 1000;

    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_settlement_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      const minutesLeft = intervalMinutes;
      return NextResponse.json({ success: false, message: `Too early. Wait ${minutesLeft} min.` }, { status: 429 });
    }

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
    const exhaustedCampaigns = new Map<number, { id: number; name: string; advertiser_telegram_id: string | number }>();

    try {
      for (let post of postsToSettle) {
        const newClicks = post.current_total_clicks - post.settled_clicks;
        if (newClicks <= 0) continue;

        const advertiserPaid = (newClicks * post.cpm) / 1000;
        const publisherReward = advertiserPaid * rewardPercent;
        const platformShare = advertiserPaid - publisherReward;

        await conn.beginTransaction();
        try {
          const [lockedRows]: any = await conn.query(`
            SELECT
              cp.id as post_id,
              cp.campaign_id,
              cp.channel_id,
              cp.settled_clicks,
              c.cpm,
              c.name as campaign_name,
              c.user_id as advertiser_id,
              c.budget,
              c.status as campaign_status,
              u_adv.telegram_id as advertiser_telegram_id,
              ch.user_id as publisher_id,
              (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) as current_total_clicks
            FROM campaign_posts cp
            JOIN campaigns c ON cp.campaign_id = c.id
            JOIN channels ch ON cp.channel_id = ch.id
            JOIN users u_adv ON c.user_id = u_adv.id
            WHERE cp.id = ?
            FOR UPDATE
          `, [post.post_id]);
          const lockedPost = lockedRows[0];
          if (!lockedPost || lockedPost.campaign_status !== "active") {
            await conn.rollback();
            continue;
          }
          post = lockedPost;
          const lockedNewClicks = Number(post.current_total_clicks || 0) - Number(post.settled_clicks || 0);
          if (lockedNewClicks <= 0) {
            await conn.rollback();
            continue;
          }
          const lockedAdvertiserPaid = (lockedNewClicks * Number(post.cpm || 0)) / 1000;
          const lockedPublisherReward = lockedAdvertiserPaid * rewardPercent;
          const lockedPlatformShare = lockedAdvertiserPaid - lockedPublisherReward;

          const safetyCheck = await recordPayoutSafetyCheck({
            settlementType: "click",
            campaignId: Number(post.campaign_id),
            publisherId: Number(post.publisher_id),
            advertiserPaid: lockedAdvertiserPaid,
            publisherShare: lockedPublisherReward,
            platformShare: lockedPlatformShare,
            reserveShare: 0,
            expectedPublisherShare: lockedAdvertiserPaid * rewardPercent,
            expectedPlatformShare: lockedAdvertiserPaid * (1 - rewardPercent),
            expectedReserveShare: 0,
            metadata: { post_id: post.post_id, clicks: lockedNewClicks },
          });
          if (safetyCheck.status !== "passed") {
            await conn.rollback();
            continue;
          }

          // A. Deduct from campaign budget
          const [budgetResult]: any = await conn.query(
            "UPDATE campaigns SET budget = budget - ? WHERE id = ? AND budget >= ? AND status = 'active'",
            [lockedAdvertiserPaid, post.campaign_id, lockedAdvertiserPaid]
          );
          if (budgetResult.affectedRows !== 1) {
            await conn.rollback();
            continue;
          }

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
          const creditedPublisher = await creditUserLockedBalance(conn, post.publisher_id, lockedPublisherReward);
          if (!creditedPublisher) {
            await conn.rollback();
            continue;
          }

          // C. Log settlement
          await conn.query(`
            INSERT INTO ad_settlements (post_id, campaign_id, advertiser_id, channel_id, publisher_id, clicks_count, advertiser_paid, publisher_reward)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [post.post_id, post.campaign_id, post.advertiser_id, post.channel_id, post.publisher_id, lockedNewClicks, lockedAdvertiserPaid, lockedPublisherReward]);

          // D. Update settled_clicks tracker
          await conn.query(
            "UPDATE campaign_posts SET settled_clicks = ? WHERE id = ?",
            [post.current_total_clicks, post.post_id]
          );

          await conn.commit();
          results.push({ post_id: post.post_id, settled: lockedNewClicks, paid: lockedAdvertiserPaid, reward: lockedPublisherReward });
        } catch (err) {
          await conn.rollback();
          console.error(`Settlement failed for post ${post.post_id}:`, err);
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
    console.error("Settlement Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
