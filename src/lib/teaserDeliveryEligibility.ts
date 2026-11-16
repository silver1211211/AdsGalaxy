import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;

/** Check the exact placement and current channel immediately before adding ad copy. */
export async function teaserPlacementStillEligible(
  db: Db,
  input: { placementId: number; channelId: number; campaignId: number },
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tp.id
       FROM teaser_placements tp
       JOIN channels ch ON ch.id=tp.channel_id
       JOIN users p ON p.id=ch.user_id
       JOIN campaigns c ON c.id=tp.campaign_id
      WHERE tp.id=? AND tp.channel_id=? AND tp.campaign_id=?
        AND tp.status IN ('inserting','active','awaiting_baseline')
        AND ch.is_deleted=0 AND ch.status IN ('active','approved')
        AND COALESCE(ch.marketplace_admin_status,'approved')='approved'
        AND (COALESCE(ch.channel_type,'public')<>'private'
             OR (ch.tracking_account_status='active'
                 AND ch.tracking_account_member_status IN ('member','already_member')))
        AND ch.teaser_enabled=1 AND ch.teaser_status='active'
        AND p.status='active' AND p.is_banned=0
        AND c.status='active' AND c.teaser_enabled=1
      LIMIT 1`,
    [input.placementId, input.channelId, input.campaignId],
  );
  return rows.length === 1;
}
