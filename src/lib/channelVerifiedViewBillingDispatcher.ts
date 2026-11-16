import type {Pool,RowDataPacket} from "mysql2/promise";
import {SMART_REACH_POLICY_VERSION} from "@/lib/channelSmartReachConfiguration";
import {settleSmartReachImpressions} from "@/lib/channelSmartReachImpressionSettlement";
import {fundPendingSmartReachClaimsFromReserve} from "@/lib/channelSmartReachReserveFunding";
import {evaluateSmartReachDynamicCpm} from "@/lib/channelSmartReachDynamicCpm";
import {debitConfirmedChannelViews} from "@/lib/channelFastBilling";

type ViewRow=RowDataPacket&{campaign_id:number;publisher_id:number;status:string;financial_policy_version:string|null};
type AuditRow=RowDataPacket&{id:number;total_views:number};

/** Internal verified-view dispatcher. The financial service revalidates every fact under locks. */
export async function dispatchVerifiedChannelViewBilling(pool:Pool,input:{postId:number;viewAuditId:number|null;confirmedViews:number}){
  if(!Number.isSafeInteger(input.postId)||input.postId<=0||!Number.isSafeInteger(input.confirmedViews)||input.confirmedViews<0)
    throw new Error("invalid_verified_view_dispatch");
  const [rows]=await pool.query<ViewRow[]>(`SELECT cp.campaign_id,ch.user_id publisher_id,c.status,c.financial_policy_version
    FROM campaign_posts cp JOIN campaigns c ON c.id=cp.campaign_id
    JOIN channels ch ON ch.id=cp.channel_id WHERE cp.id=?`,[input.postId]);
  const row=rows[0];
  if(!row)return {status:"post_missing" as const};
  if(row.financial_policy_version!==SMART_REACH_POLICY_VERSION)
    return debitConfirmedChannelViews(input.postId,input.confirmedViews);
  if(process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED!=="true"||process.env.CHANNEL_SMART_REACH_CONFIG_ENABLED!=="true"||
    process.env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED!=="true")return {status:"disabled" as const};
  if(row.status!=="active")return {status:"paused" as const};
  if(!Number.isSafeInteger(input.viewAuditId)||Number(input.viewAuditId)<=0)
    throw new Error("smart_reach_qualified_view_audit_required");
  const billed=await settleSmartReachImpressions(pool,{campaignId:Number(row.campaign_id),postId:input.postId,
    publisherId:Number(row.publisher_id),viewAuditId:Number(input.viewAuditId),
    idempotencyKey:`smart_reach_view_audit_${input.viewAuditId}`});
  if(billed.status==="settled"||billed.status==="duplicate"){
    await fundPendingSmartReachClaimsFromReserve(pool,Number(row.campaign_id),Number(row.publisher_id));
    await evaluateSmartReachDynamicCpm(pool,Number(row.campaign_id));
  }
  return billed;
}

/** A failed payment leaves a valid audit to retry on the next ordinary view check. */
export async function retryLatestUnsettledSmartReachAudit(pool:Pool,postId:number,confirmedViews:number){
  const [rows]=await pool.query<AuditRow[]>(`SELECT a.id,a.total_views FROM campaign_views_audit a
    WHERE a.post_id=? AND a.status='valid' AND a.total_views<=?
    ORDER BY a.total_views DESC,a.id DESC LIMIT 1`,[postId,confirmedViews]);
  if(!rows[0])return {status:"audit_missing" as const};
  return dispatchVerifiedChannelViewBilling(pool,{postId,viewAuditId:Number(rows[0].id),confirmedViews});
}
