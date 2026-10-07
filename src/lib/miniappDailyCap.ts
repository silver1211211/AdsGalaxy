import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { enqueueMiniAppDailyCapNotification, markMiniAppCampaignBudgetExhausted } from "@/lib/miniappCampaignNotifications";
import { decimalToMoneyUnits, miniAppImpressionCostUnits } from "@/lib/miniappExternalDeliveryMath";

type QueryExecutor = Pick<PoolConnection, "query">;

export async function getMiniAppDailyAdvertiserSpend(conn: QueryExecutor, campaignId: number) {
  const [rows] = await conn.query<Array<RowDataPacket & { spend: string }>>(
    `SELECT
       COALESCE((SELECT SUM(advertiser_debit) FROM miniapp_internal_ad_impressions
                 WHERE campaign_id = ? AND created_at >= UTC_DATE()
                   AND created_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)), 0)
       +
       COALESCE((SELECT SUM(advertiser_debit) FROM miniapp_external_delivery_batches
                 WHERE campaign_id = ? AND created_at >= UTC_DATE()
                   AND created_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)), 0) AS spend`,
    [campaignId, campaignId],
  );
  return String(rows[0]?.spend || "0.00000000");
}

export async function markMiniAppDailyCapReached(conn: QueryExecutor, campaignId: number) {
  const [result] = await conn.query<import("mysql2/promise").ResultSetHeader>(
    `UPDATE miniapp_rewarded_campaigns
     SET daily_cap_cycle = daily_cap_cycle + 1,
         status = 'daily_cap_reached', pause_reason = 'daily_budget_limit',
         daily_cap_reached_at = UTC_TIMESTAMP(), daily_cap_billing_date = UTC_DATE()
     WHERE id = ? AND NOT (
       status = 'daily_cap_reached' AND pause_reason = 'daily_budget_limit'
       AND daily_cap_billing_date = UTC_DATE()
     )`,
    [campaignId],
  );
  if (result.affectedRows === 1) await enqueueMiniAppDailyCapNotification(conn, campaignId);
  return result.affectedRows === 1;
}

export async function reconcileMiniAppDailyCaps(limit = 100) {
  const conn = await pool.getConnection();
  let resumed = 0;
  let budgetExhausted = 0;
  let balanceBlocked = 0;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & {
      id: number; advertiser_id: number; remaining_budget: string; advertiser_cpm_bid: string;
      daily_budget_limit: string; end_at: Date | string | null;
    }>>(
      `SELECT id, advertiser_id, remaining_budget, advertiser_cpm_bid, daily_budget_limit, end_at
       FROM miniapp_rewarded_campaigns
       WHERE status = 'daily_cap_reached' AND pause_reason = 'daily_budget_limit'
         AND daily_cap_billing_date < UTC_DATE()
       ORDER BY id ASC LIMIT ? FOR UPDATE`,
      [Math.min(500, Math.max(1, Math.floor(limit)))],
    );
    for (const row of rows) {
      const unitCost = miniAppImpressionCostUnits(row.advertiser_cpm_bid);
      const remaining = decimalToMoneyUnits(row.remaining_budget);
      if (unitCost <= BigInt(0) || remaining < unitCost) {
        await markMiniAppCampaignBudgetExhausted(conn, Number(row.id));
        budgetExhausted += 1;
        continue;
      }
      const [[user]] = await conn.query<Array<RowDataPacket & { ad_balance: string }>>(
        "SELECT ad_balance FROM users WHERE id = ? FOR UPDATE", [row.advertiser_id],
      );
      if (!user || decimalToMoneyUnits(user.ad_balance) < unitCost) {
        await conn.query(
          `UPDATE miniapp_rewarded_campaigns SET status = 'paused', pause_reason = 'insufficient_balance'
           WHERE id = ? AND status = 'daily_cap_reached'`, [row.id],
        );
        await conn.query(
          `UPDATE miniapp_external_delivery_syncs
           SET status = 'insufficient_balance_paused', stop_reason = 'insufficient_advertiser_balance'
           WHERE campaign_id = ? AND status = 'daily_cap_paused' AND active_slot = 1`, [row.id],
        );
        balanceBlocked += 1;
        continue;
      }
      const spend = decimalToMoneyUnits(await getMiniAppDailyAdvertiserSpend(conn, Number(row.id)));
      if (decimalToMoneyUnits(row.daily_budget_limit) - spend < unitCost) continue;
      if (row.end_at && new Date(row.end_at).getTime() <= Date.now()) continue;
      await conn.query(
        `UPDATE miniapp_rewarded_campaigns
         SET status = 'approved', pause_reason = NULL,
             daily_cap_reached_at = NULL, daily_cap_billing_date = NULL
         WHERE id = ? AND status = 'daily_cap_reached' AND pause_reason = 'daily_budget_limit'`, [row.id],
      );
      await conn.query(
        `UPDATE miniapp_external_delivery_syncs
         SET status = 'running', stop_reason = NULL,
             total_paused_seconds = total_paused_seconds + GREATEST(TIMESTAMPDIFF(SECOND, paused_at, UTC_TIMESTAMP()), 0),
             ends_at = DATE_ADD(ends_at, INTERVAL GREATEST(TIMESTAMPDIFF(SECOND, paused_at, UTC_TIMESTAMP()), 0) SECOND),
             paused_at = NULL
         WHERE campaign_id = ? AND status = 'daily_cap_paused' AND active_slot = 1 AND paused_at IS NOT NULL`, [row.id],
      );
      resumed += 1;
    }
    await conn.commit();
    return { checked: rows.length, resumed, budget_exhausted: budgetExhausted, insufficient_balance: balanceBlocked };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
