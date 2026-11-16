import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { evaluateUnifiedChannelEligibility } from "@/lib/channelEligibility";

type Db = Pool | PoolConnection;

/**
 * Re-read the current channel and the exact pending placement immediately before
 * Telegram posting. A selection or reservation made earlier is not authorization
 * to post after the channel is rejected, deleted, or loses private tracking access.
 */
export async function checkPendingChannelPostEligibility(
  db: Db,
  input: { postId: number; campaignId: number; channelId: number },
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const [rows] = await db.query<Array<RowDataPacket & {
    status: string; is_deleted: number | boolean | null;
  }>>(
    `SELECT c.*, u.status AS publisher_status, u.is_banned AS publisher_is_banned,
            ti.next_retry_at AS identity_next_retry_at, ti.last_failure_code AS identity_last_failure_code,
            ti.bot_member_status, ti.bot_can_post, ti.verification_state,
            ti.telegram_chat_id AS identity_telegram_chat_id
       FROM campaign_posts cp
       JOIN channels c ON c.id=cp.channel_id
       JOIN users u ON u.id=c.user_id
       LEFT JOIN channel_telegram_identities ti ON ti.channel_id=c.id
      WHERE cp.id=? AND cp.campaign_id=? AND cp.channel_id=?
        AND cp.status='pending_delivery'
        AND cp.delivery_confirmed_at IS NULL
        AND cp.delivery_failed_at IS NULL
      LIMIT 1`,
    [input.postId, input.campaignId, input.channelId],
  );
  const channel = rows[0];
  if (!channel || channel.status !== "active" || Boolean(channel.is_deleted)) {
    return { allowed: false, reason: "channel_no_longer_active" };
  }
  const eligibility = evaluateUnifiedChannelEligibility({ ...channel, context: "ad_delivery" });
  return eligibility.eligible
    ? { allowed: true }
    : { allowed: false, reason: eligibility.code || "channel_delivery_ineligible" };
}

