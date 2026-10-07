import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export async function getGrowthLiveImpressions(db: Pick<PoolConnection, "query">, campaignId: number) {
  const [[row]] = await db.query<Array<RowDataPacket & { views: number | string }>>(
    `SELECT COALESCE(SUM(cp.views),0) views FROM campaign_posts cp
     WHERE cp.campaign_id=? AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.delivery_failed_at IS NULL`, [campaignId],
  );
  return Math.max(0, Number(row?.views || 0));
}

/** Only the preceding UTC day's snapshot is a valid daily baseline.
 * With a missing baseline, do not assign several days of cumulative views to today. */
export async function getGrowthTodayImpressions(db: Pick<PoolConnection, "query">, campaignId: number) {
  const [[row]] = await db.query<Array<RowDataPacket & { views: number | string }>>(
    `SELECT COALESCE(SUM(GREATEST(COALESCE(cp.views,0)-COALESCE(
       (SELECT ps.total_views FROM channel_post_daily_stats ps
        WHERE ps.post_id=cp.id AND ps.stat_date=DATE_SUB(UTC_DATE(),INTERVAL 1 DAY) LIMIT 1),
       CASE WHEN cp.delivery_confirmed_at>=UTC_DATE() THEN 0 ELSE COALESCE(cp.views,0) END
     ),0)),0) views FROM campaign_posts cp
     WHERE cp.campaign_id=? AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.delivery_failed_at IS NULL`, [campaignId],
  );
  return Math.max(0, Number(row?.views || 0));
}
