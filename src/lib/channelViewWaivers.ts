import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Queryable = Pick<PoolConnection, "query"> | typeof pool;

export const waivedViewsForPostSql = (postAlias = "cp") =>
  `COALESCE((SELECT SUM(cvw.waived_views) FROM channel_view_waivers cvw WHERE cvw.post_id=${postAlias}.id),0)`;

export function outstandingViewsSql(postAlias = "cp") {
  return `GREATEST(COALESCE(${postAlias}.views,0)-COALESCE(${postAlias}.settled_views,0)-${waivedViewsForPostSql(postAlias)},0)`;
}

export async function getCampaignViewWaiverSummary(campaignId: number, db: Queryable = pool) {
  const [[row]] = await db.query<Array<RowDataPacket & { waived_views: string | number; waiver_rows: string | number }>>(
    `SELECT COALESCE(SUM(waived_views),0) waived_views,COUNT(*) waiver_rows
     FROM channel_view_waivers WHERE campaign_id=?`,
    [campaignId],
  );
  return { waivedViews: Number(row?.waived_views || 0), waiverRows: Number(row?.waiver_rows || 0) };
}
