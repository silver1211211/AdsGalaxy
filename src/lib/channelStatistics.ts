import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { ensureClassicSettlementColumns } from "@/lib/schemaGuards";
import { channelFinancialEventsSql } from "@/lib/channelReporting";

type AggregateResult = {
  statDate: string;
  postRows: number;
  channelRows: number;
};

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function databaseDate() {
  const [rows] = await pool.query<Array<RowDataPacket & { today: string }>>(
    "SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') AS today"
  );
  return String(rows[0].today);
}

export async function aggregateChannelStatistics(requestedDate?: string): Promise<AggregateResult> {
  const today = await databaseDate();
  const statDate = requestedDate || today;
  if (!validDateKey(statDate)) throw new Error("invalid_statistics_date");
  if (statDate > today) throw new Error("future_statistics_date");

  await ensureClassicSettlementColumns();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Never overwrite a completed day's observed counters with today's cumulative views.
    const [postResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO channel_post_daily_stats
         (stat_date, channel_id, post_id, campaign_id, total_views, views, total_clicks, clicks,
          view_earnings, click_earnings, earnings, ctr, average_cpm, average_cpc, active_post)
       SELECT ?, cp.channel_id, cp.id, cp.campaign_id,
         GREATEST(COALESCE(cp.views, 0), 0) AS total_views,
         GREATEST(COALESCE(cp.views, 0) - COALESCE(
           (SELECT previous.total_views
              FROM channel_post_daily_stats previous
             WHERE previous.post_id = cp.id AND previous.stat_date < ?
               AND (previous.stat_date = DATE_SUB(?, INTERVAL 1 DAY) OR COALESCE(campaign_scope.teaser_mode,'none')<>'none')
             ORDER BY previous.stat_date DESC LIMIT 1),
           CASE WHEN DATE(cp.delivery_confirmed_at) = ? THEN 0 ELSE COALESCE(cp.views, 0) END
         ), 0) AS daily_views,
         (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) AS total_clicks,
         (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id AND cc.created_at >= ? AND cc.created_at < DATE_ADD(?, INTERVAL 1 DAY)) AS daily_clicks,
         COALESCE((SELECT SUM(sv.publisher_reward) FROM ad_settlements_views sv WHERE sv.post_id = cp.id AND sv.fraud_adjusted_at IS NULL AND sv.created_at >= ? AND sv.created_at < DATE_ADD(?, INTERVAL 1 DAY)), 0) AS view_earnings,
         COALESCE((SELECT SUM(sc.publisher_reward) FROM ad_settlements sc WHERE sc.post_id = cp.id AND sc.fraud_adjusted_at IS NULL AND sc.created_at >= ? AND sc.created_at < DATE_ADD(?, INTERVAL 1 DAY)), 0) AS click_earnings,
         COALESCE((SELECT SUM(sv.publisher_reward) FROM ad_settlements_views sv WHERE sv.post_id = cp.id AND sv.fraud_adjusted_at IS NULL AND sv.created_at >= ? AND sv.created_at < DATE_ADD(?, INTERVAL 1 DAY)), 0)
           + COALESCE((SELECT SUM(sc.publisher_reward) FROM ad_settlements sc WHERE sc.post_id = cp.id AND sc.fraud_adjusted_at IS NULL AND sc.created_at >= ? AND sc.created_at < DATE_ADD(?, INTERVAL 1 DAY)), 0) AS earnings,
         0, 0, 0,
         IF(cp.status = 'active' AND cp.deleted_at IS NULL AND cp.delivery_failed_at IS NULL, 1, 0)
       FROM campaign_posts cp
       LEFT JOIN campaigns campaign_scope ON campaign_scope.id=cp.campaign_id
       WHERE cp.channel_id IS NOT NULL
         AND cp.delivery_confirmed_at IS NOT NULL
         AND (cp.delivery_failed_at IS NULL OR COALESCE(campaign_scope.teaser_mode,'none')<>'none')
         AND cp.delivery_confirmed_at < DATE_ADD(?, INTERVAL 1 DAY)
         AND (?=? OR COALESCE(campaign_scope.teaser_mode,'none')<>'none')
       ON DUPLICATE KEY UPDATE
         channel_id = VALUES(channel_id), campaign_id = VALUES(campaign_id), total_views = VALUES(total_views),
         views = VALUES(views), total_clicks = VALUES(total_clicks), clicks = VALUES(clicks),
         view_earnings = VALUES(view_earnings), click_earnings = VALUES(click_earnings), earnings = VALUES(earnings),
         active_post = VALUES(active_post), updated_at = CURRENT_TIMESTAMP`,
      [statDate, statDate, statDate, statDate, statDate, statDate, statDate, statDate, statDate,
        statDate, statDate, statDate, statDate, statDate, statDate, statDate, today]
    );

    await connection.query(
      `UPDATE channel_post_daily_stats ps
       LEFT JOIN (
         SELECT post_id, SUM(view_spend) AS view_spend, SUM(click_spend) AS click_spend
         FROM (
           SELECT post_id,CASE WHEN billable_views>0 OR subscribers>0 THEN spend ELSE 0 END view_spend,
             CASE WHEN billable_clicks>0 THEN spend ELSE 0 END click_spend
           FROM (${channelFinancialEventsSql()}) financial JOIN campaigns c ON c.id=financial.campaign_id
           WHERE event_at >= ? AND event_at < DATE_ADD(?, INTERVAL 1 DAY) AND COALESCE(c.teaser_mode,'none')='none'
           UNION ALL
           SELECT sv.post_id,sv.advertiser_paid,0 FROM ad_settlements_views sv
           JOIN campaign_posts cp ON cp.id=sv.post_id JOIN campaigns c ON c.id=cp.campaign_id
           WHERE sv.fraud_adjusted_at IS NULL AND sv.created_at>=? AND sv.created_at<DATE_ADD(?,INTERVAL 1 DAY)
             AND COALESCE(c.teaser_mode,'none')<>'none'
           UNION ALL
           SELECT sc.post_id,0,sc.advertiser_paid FROM ad_settlements sc
           JOIN campaign_posts cp ON cp.id=sc.post_id JOIN campaigns c ON c.id=cp.campaign_id
           WHERE sc.fraud_adjusted_at IS NULL AND sc.created_at>=? AND sc.created_at<DATE_ADD(?,INTERVAL 1 DAY)
             AND COALESCE(c.teaser_mode,'none')<>'none'
         ) settlement_spend GROUP BY post_id
       ) source ON source.post_id = ps.post_id
       SET ps.view_spend = COALESCE(source.view_spend, 0),
           ps.click_spend = COALESCE(source.click_spend, 0),
           ps.spend = COALESCE(source.view_spend, 0) + COALESCE(source.click_spend, 0)
       WHERE ps.stat_date = ?`,
      [statDate, statDate, statDate, statDate, statDate, statDate, statDate]
    );

    await connection.query(
      `UPDATE channel_post_daily_stats ps
       LEFT JOIN (
         SELECT l.post_id,
           SUM(CASE WHEN a.id IS NULL THEN l.platform_revenue ELSE 0 END) AS platform_revenue,
           SUM(CASE WHEN a.id IS NULL THEN l.reserve_amount ELSE 0 END) AS reserve_amount
         FROM channel_settlement_ledger l
         LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
         WHERE l.created_at >= ? AND l.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY l.post_id
       ) ledger ON ledger.post_id = ps.post_id
       SET ps.platform_revenue = COALESCE(ledger.platform_revenue, 0),
           ps.reserve_amount = COALESCE(ledger.reserve_amount, 0)
       WHERE ps.stat_date = ?`,
      [statDate, statDate, statDate]
    );

    await connection.query(
      `UPDATE channel_post_daily_stats
       SET ctr = IF(views > 0, (clicks / views) * 100, 0),
           average_cpm = IF(views > 0, (view_spend / views) * 1000, 0),
           average_cpc = IF(clicks > 0, click_spend / clicks, 0),
           effective_publisher_cpm = IF(views > 0, (view_earnings / views) * 1000, 0),
           effective_publisher_cpc = IF(clicks > 0, click_earnings / clicks, 0)
       WHERE stat_date = ?`,
      [statDate]
    );

    const [channelResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO channel_daily_stats
         (stat_date, channel_id, views, clicks, earnings, view_earnings, click_earnings,
          view_spend, click_spend, spend, platform_revenue, reserve_amount,
          ctr, average_cpm, average_cpc, effective_publisher_cpm, effective_publisher_cpc, active_posts)
       SELECT ?, ch.id,
         COALESCE(SUM(ps.views), 0), COALESCE(SUM(ps.clicks), 0), COALESCE(SUM(ps.earnings), 0),
         COALESCE(SUM(ps.view_earnings), 0), COALESCE(SUM(ps.click_earnings), 0),
         COALESCE(SUM(ps.view_spend), 0), COALESCE(SUM(ps.click_spend), 0), COALESCE(SUM(ps.spend), 0),
         COALESCE(SUM(ps.platform_revenue), 0), COALESCE(SUM(ps.reserve_amount), 0),
         IF(COALESCE(SUM(ps.views), 0) > 0, (SUM(ps.clicks) / SUM(ps.views)) * 100, 0),
         IF(COALESCE(SUM(ps.views), 0) > 0, (SUM(ps.view_spend) / SUM(ps.views)) * 1000, 0),
         IF(COALESCE(SUM(ps.clicks), 0) > 0, SUM(ps.click_spend) / SUM(ps.clicks), 0),
         IF(COALESCE(SUM(ps.views), 0) > 0, (SUM(ps.view_earnings) / SUM(ps.views)) * 1000, 0),
         IF(COALESCE(SUM(ps.clicks), 0) > 0, SUM(ps.click_earnings) / SUM(ps.clicks), 0),
         COALESCE(SUM(ps.active_post), 0)
       FROM channels ch
       LEFT JOIN channel_post_daily_stats ps ON ps.channel_id = ch.id AND ps.stat_date = ?
       GROUP BY ch.id
       ON DUPLICATE KEY UPDATE
         views = VALUES(views), clicks = VALUES(clicks), earnings = VALUES(earnings),
         view_earnings = VALUES(view_earnings), click_earnings = VALUES(click_earnings),
         view_spend = VALUES(view_spend), click_spend = VALUES(click_spend), spend = VALUES(spend),
         platform_revenue = VALUES(platform_revenue), reserve_amount = VALUES(reserve_amount),
         ctr = VALUES(ctr), average_cpm = VALUES(average_cpm), average_cpc = VALUES(average_cpc),
         effective_publisher_cpm = VALUES(effective_publisher_cpm), effective_publisher_cpc = VALUES(effective_publisher_cpc),
         active_posts = VALUES(active_posts), updated_at = CURRENT_TIMESTAMP`,
      [statDate, statDate]
    );

    await connection.commit();
    return { statDate, postRows: postResult.affectedRows, channelRows: channelResult.affectedRows };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
