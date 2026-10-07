import "server-only";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { invalidateAdvertiserCaches } from "@/lib/redisCache";
import { channelUnitPriceSql } from "@/lib/channelBilling";
import { resumeAutomaticallyPausedChannel } from "@/lib/channelResumeEligibility";
import { withFinancialTransactionRetry } from "@/lib/dbResilience";

export async function reactivateInsufficientBalanceCampaigns(advertiserId: number) {
  const channelCount = await withFinancialTransactionRetry(async conn => {
    const [rows] = await conn.query<Array<import("mysql2/promise").RowDataPacket & { id: number }>>(
      `SELECT id FROM campaigns WHERE user_id=? AND funding_model='direct_debit'
       AND type IN ('views','clicks') AND COALESCE(teaser_mode,'none')='none'
       AND status='paused' AND pause_reason='insufficient_balance'`, [advertiserId]);
    let resumed = 0;
    for (const row of rows) if (await resumeAutomaticallyPausedChannel(conn, Number(row.id))) resumed++;
    return resumed;
  }, { operation: "channel_wallet_funding_reactivation" });
  const [classic] = await pool.query<ResultSetHeader>(
    `UPDATE campaigns c JOIN users u ON u.id=c.user_id
     SET c.status='active',c.pause_reason=NULL,c.paused_at=NULL,c.resume_locked_until=NULL
     WHERE c.user_id=? AND c.funding_model='direct_debit'
       AND c.status='paused' AND c.pause_reason='insufficient_balance'
       AND (c.type NOT IN ('views','clicks') OR COALESCE(c.teaser_mode,'none')<>'none')
       AND c.budget >= (${channelUnitPriceSql()})
       AND u.ad_balance >= (${channelUnitPriceSql()})`,
    [advertiserId],
  );
  const [miniapp] = await pool.query<ResultSetHeader>(
    `UPDATE miniapp_rewarded_campaigns c JOIN users u ON u.id=c.advertiser_id
     SET c.status='active',c.pause_reason=NULL
     WHERE c.advertiser_id=? AND c.funding_model='direct_debit'
       AND c.status='paused' AND c.pause_reason='insufficient_balance'
       AND c.remaining_budget>=GREATEST(c.advertiser_cpm_bid,0.01)/1000
       AND u.ad_balance>=GREATEST(c.advertiser_cpm_bid,0.01)/1000`,
    [advertiserId],
  );
  if (channelCount || classic.affectedRows || miniapp.affectedRows) await invalidateAdvertiserCaches(advertiserId);
  return { classic: channelCount + classic.affectedRows, miniapp: miniapp.affectedRows };
}
