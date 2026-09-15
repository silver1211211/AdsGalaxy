import "server-only";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { invalidateAdvertiserCaches } from "@/lib/redisCache";

export async function reactivateInsufficientBalanceCampaigns(advertiserId: number) {
  const [classic] = await pool.query<ResultSetHeader>(
    `UPDATE campaigns c JOIN users u ON u.id=c.user_id
     SET c.status='active',c.pause_reason=NULL,c.paused_at=NULL,c.resume_locked_until=NULL
     WHERE c.user_id=? AND c.funding_model='direct_debit'
       AND c.status='paused' AND c.pause_reason='insufficient_balance'
       AND c.budget >= CASE
         WHEN c.campaign_kind='channel_growth' THEN c.cost_per_subscriber
         WHEN c.type='clicks' THEN GREATEST(c.cpc,0.01)/1000
         ELSE GREATEST(c.cpm,0.01)/1000 END
       AND u.ad_balance >= CASE
         WHEN c.campaign_kind='channel_growth' THEN c.cost_per_subscriber
         WHEN c.type='clicks' THEN GREATEST(c.cpc,0.01)/1000
         ELSE GREATEST(c.cpm,0.01)/1000 END`,
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
  if (classic.affectedRows || miniapp.affectedRows) await invalidateAdvertiserCaches(advertiserId);
  return { classic: classic.affectedRows, miniapp: miniapp.affectedRows };
}
