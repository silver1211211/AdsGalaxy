import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { creditUserAvailableBalance, unlockUserBalance } from "@/lib/earnings";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 0. Throttling (Default once a day, but can be run more often)
    const isDev = process.env.MODE === "DEV";
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'last_unlock_cron_run'");
    const lastRun = parseInt(settings[0]?.value || "0");
    const now = Date.now();
    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours

    if (!isDev && now - lastRun < intervalMs) {
      const hoursLeft = Math.ceil((intervalMs - (now - lastRun)) / (60 * 60 * 1000));
      return NextResponse.json({ success: false, message: `Too early. Next run in ~${hoursLeft} hours.` }, { status: 429 });
    }

    // Update last run
    await pool.query("INSERT INTO settings (\`key\`, value) VALUES ('last_unlock_cron_run', ?) ON DUPLICATE KEY UPDATE value = ?", [now.toString(), now.toString()]);

    // Get Referral Percentage
    const [refSetting]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'referral_reward_percentage'");
    const referralPercent = parseFloat(refSetting[0]?.value || "5") / 100;

    const results: any = { clicks: 0, views: 0, users_updated: 0, total_unlocked: 0, referral_rewards_sent: 0 };
    const conn = await pool.getConnection();

    try {
      // 1. Process Click Settlements
      const [clickRewards]: any = await conn.query(`
        SELECT 
          ad_settlements.publisher_id as user_id,
          GROUP_CONCAT(ad_settlements.id) as settlement_ids,
          SUM(ad_settlements.publisher_reward) as total_reward
        FROM ad_settlements
        WHERE ad_settlements.status = 'locked' AND ad_settlements.created_at < NOW() - INTERVAL 30 DAY
        GROUP BY ad_settlements.publisher_id
      `);

      // 2. Process View Settlements
      const [viewRewards]: any = await conn.query(`
        SELECT 
          ad_settlements_views.publisher_id as user_id,
          GROUP_CONCAT(ad_settlements_views.id) as settlement_ids,
          SUM(ad_settlements_views.publisher_reward) as total_reward
        FROM ad_settlements_views
        WHERE ad_settlements_views.status = 'locked' AND ad_settlements_views.created_at < NOW() - INTERVAL 30 DAY
        GROUP BY ad_settlements_views.publisher_id
      `);

      // Combine rewards by user
      const userMap = new Map<number, { clickIds: string[], viewIds: string[], total: number }>();

      clickRewards.forEach((r: any) => {
        userMap.set(r.user_id, { 
          clickIds: r.settlement_ids.split(','), 
          viewIds: [], 
          total: parseFloat(r.total_reward) 
        });
      });

      viewRewards.forEach((r: any) => {
        const existing = userMap.get(r.user_id);
        if (existing) {
          existing.viewIds = r.settlement_ids.split(',');
          existing.total += parseFloat(r.total_reward);
        } else {
          userMap.set(r.user_id, { 
            clickIds: [], 
            viewIds: r.settlement_ids.split(','), 
            total: parseFloat(r.total_reward) 
          });
        }
      });

      // 3. Execute Balance Transfers
      for (const [userId, data] of userMap.entries()) {
        await conn.beginTransaction();
        try {
          // Get current locked balance to avoid over-deducting
          const [userRow]: any = await conn.query("SELECT balance_locked FROM users WHERE id = ?", [userId]);
          if (userRow.length === 0) {
            await conn.rollback();
            continue;
          }

          const currentLocked = parseFloat(userRow[0].balance_locked);
          const amountToTransfer = Math.min(data.total, currentLocked);

          if (amountToTransfer > 0) {
            // A. Transfer balance for the publisher
            const unlockedPublisher = await unlockUserBalance(conn, userId, amountToTransfer);
            if (!unlockedPublisher) {
              await conn.rollback();
              continue;
            }

            // B. Reward the Referrer (if any)
            const [referralRow]: any = await conn.query(
              "SELECT invited_by FROM referrals WHERE user_id = ?",
              [userId]
            );

            if (referralRow.length > 0) {
              const referrerId = referralRow[0].invited_by;
              const referralReward = amountToTransfer * referralPercent;

              if (referralReward > 0) {
                const creditedReferrer = await creditUserAvailableBalance(conn, referrerId, referralReward);
                if (creditedReferrer) {
                  await conn.query(
                    "UPDATE users SET total_referral_earnings = total_referral_earnings + ? WHERE id = ?",
                    [referralReward, referrerId]
                  );
                  results.referral_rewards_sent += referralReward;
                }
              }
            }

            // C. Mark click settlements as unlocked
            if (data.clickIds.length > 0) {
              await conn.query(`UPDATE ad_settlements SET status = 'unlocked' WHERE id IN (${data.clickIds.join(',')})`);
              results.clicks += data.clickIds.length;
            }

            // D. Mark view settlements as unlocked
            if (data.viewIds.length > 0) {
              await conn.query(`UPDATE ad_settlements_views SET status = 'unlocked' WHERE id IN (${data.viewIds.join(',')})`);
              results.views += data.viewIds.length;
            }

            results.users_updated++;
            results.total_unlocked += amountToTransfer;
          }

          await conn.commit();
        } catch (err) {
          await conn.rollback();
          console.error(`Balance unlocking failed for user ${userId}:`, err);
        }
      }
    } finally {
      conn.release();
    }

    return NextResponse.json({
      success: true,
      results
    });

  } catch (error: any) {
    console.error("Balance Unlocker Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
