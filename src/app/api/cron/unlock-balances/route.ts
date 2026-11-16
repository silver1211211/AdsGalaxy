import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { unlockUserBalance, isZeroOrdinaryLockEnabled } from "@/lib/earnings";
import { createHash } from "node:crypto";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;
  if (isZeroOrdinaryLockEnabled()) return NextResponse.json({ success: true, message: "Ordinary earnings are available immediately; legacy unlock is retired" });

  const lock = await acquireCronLock("unlock-balances", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Balance unlock cron is already running" }, { status: 409 });
  }

  try {
    // 0. Throttling (Default once a day, but can be run more often)
    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours

    await pool.query(
      "INSERT IGNORE INTO settings (`key`, value, description) VALUES ('last_unlock_cron_run', '0', 'Timestamp of the last balance unlock cron run')"
    );
    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_unlock_cron_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      const hoursLeft = 24;
      return NextResponse.json({ success: false, message: `Too early. Next run in ~${hoursLeft} hours.` }, { status: 429 });
    }

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
        WHERE ad_settlements.status = 'locked' AND ad_settlements.fraud_adjusted_at IS NULL AND ad_settlements.created_at < NOW() - INTERVAL 30 DAY
        GROUP BY ad_settlements.publisher_id
      `);

      // 2. Process View Settlements
      const [viewRewards]: any = await conn.query(`
        SELECT 
          ad_settlements_views.publisher_id as user_id,
          GROUP_CONCAT(ad_settlements_views.id) as settlement_ids,
          SUM(ad_settlements_views.publisher_reward) as total_reward
        FROM ad_settlements_views
        WHERE ad_settlements_views.status = 'locked' AND ad_settlements_views.fraud_adjusted_at IS NULL AND ad_settlements_views.created_at < NOW() - INTERVAL 30 DAY
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
            const sourceIds = [...data.clickIds.map(id => `c:${id}`), ...data.viewIds.map(id => `v:${id}`)].sort().join(",");
            const sourceHash = createHash("sha256").update(sourceIds).digest("hex");
            const unlockedPublisher = await unlockUserBalance(conn, userId, amountToTransfer, {
              sourceKey: `channel:legacy-unlock:${userId}:${sourceHash}`,
              sourceSystem: "channel_legacy_unlock",
              sourceRecordId: String(userId),
              policyVersion: "legacy-30-day-unlock",
            });
            if (!unlockedPublisher) {
              await conn.rollback();
              continue;
            }

            // Historical locked publisher earnings are unlocked without creating
            // another referral reward. New 10% commissions are generated only
            // by the canonical publisher settlement and deposit transactions.

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
  } finally {
    await releaseCronLock(lock);
  }
}
