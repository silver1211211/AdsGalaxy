import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { channelFinancialEventsSql } from "@/lib/channelReporting";

/** Optional admin/operator repair. No balances, ledger entries or view snapshots are changed.
 * Call inside an explicit transaction. Default is inspection only; safe to repeat.
 * Missing daily analytics rows are reported, never invented from current cumulative views.
 */
export async function reconcileChannelFinancialRollups(conn: PoolConnection, from: string, to: string, apply = false) {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
  if (!valid(from) || !valid(to) || from > to) throw new Error("invalid_reconciliation_date_range");
  const source = `SELECT f.post_id,DATE(f.event_at) stat_date,
      SUM(CASE WHEN f.billable_views>0 OR f.subscribers>0 THEN f.spend ELSE 0 END) view_spend,
      SUM(CASE WHEN f.billable_clicks>0 THEN f.spend ELSE 0 END) click_spend,SUM(f.spend) spend
    FROM (${channelFinancialEventsSql()}) f JOIN campaigns c ON c.id=f.campaign_id
    WHERE f.event_at>=? AND f.event_at<DATE_ADD(?,INTERVAL 1 DAY)
      AND COALESCE(c.teaser_mode,'none')='none' GROUP BY f.post_id,DATE(f.event_at)`;
  const [missing] = await conn.query<RowDataPacket[]>(`SELECT f.* FROM (${source}) f
    LEFT JOIN channel_post_daily_stats ps ON ps.post_id=f.post_id AND ps.stat_date=f.stat_date
    WHERE ps.post_id IS NULL`, [from,to]);
  let updated = 0;
  if (apply) {
    const [result] = await conn.query<ResultSetHeader>(`UPDATE channel_post_daily_stats ps
      JOIN campaigns c ON c.id=ps.campaign_id LEFT JOIN (${source}) f ON f.post_id=ps.post_id AND f.stat_date=ps.stat_date
      SET ps.view_spend=COALESCE(f.view_spend,0),ps.click_spend=COALESCE(f.click_spend,0),ps.spend=COALESCE(f.spend,0)
      WHERE ps.stat_date>=? AND ps.stat_date<=? AND COALESCE(c.teaser_mode,'none')='none'`,[from,to,from,to]);
    updated=result.affectedRows;
    await conn.query(`UPDATE channel_daily_stats ds JOIN (
      SELECT stat_date,channel_id,SUM(view_spend) view_spend,SUM(click_spend) click_spend,SUM(spend) spend
      FROM channel_post_daily_stats WHERE stat_date>=? AND stat_date<=? GROUP BY stat_date,channel_id
    ) ps ON ps.stat_date=ds.stat_date AND ps.channel_id=ds.channel_id
    SET ds.view_spend=ps.view_spend,ds.click_spend=ps.click_spend,ds.spend=ps.spend
    WHERE ds.stat_date>=? AND ds.stat_date<=?`,[from,to,from,to]);
  }
  return { applied:apply,updated,missing_analytics_rows:missing };
}
