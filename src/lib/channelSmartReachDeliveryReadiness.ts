import type {Pool,RowDataPacket} from "mysql2/promise";
import {decimalToUnits} from "@/lib/channelAllocationMath";
import {calculateSmartReachImpressionCharge} from "@/lib/channelSmartReachImpressionMath";
import {SMART_REACH_POLICY_VERSION} from "@/lib/channelSmartReachConfiguration";

// Code readiness is separate from the default-off release gates below.
export const SMART_REACH_CPC_CLICK_SETTLEMENT_IMPLEMENTED=true;
const REQUIRED_TABLES=["channel_smart_reach_impression_billings","channel_smart_reach_funding_allocations",
  "channel_smart_reach_view_claims","advertiser_direct_debits","publisher_balance_events",
  "channel_smart_reach_reserve_fundings","channel_smart_reach_reserve_allocations",
  "channel_smart_reach_cpm_evaluations","channel_unified_settlement_events",
  "channel_reserve_treasury_ledger"] as const;
type Campaign=RowDataPacket&{id:number;status:string;pause_reason:string|null;
  approved_creative_revision_id:number|null;pending_creative_revision_id:number|null;
  rejection_reason:string|null;financial_policy_version:string|null;financial_billing_mode:string|null;
  type:string;campaign_kind:string|null;funding_model:string|null;
  smart_reach_effective_cpm:string;smart_reach_max_cpm:string;
  budget:string;daily_budget_limit:string|null;ad_balance:string;resume_locked_until:Date|null};

export function evaluateSmartReachDeliveryReadiness(input:{campaign:Campaign;dailySpent:string;schemaReady:boolean;
  explicitManualResume?:boolean;now?:Date;env?:Record<string,string|undefined>}){
  const c=input.campaign,env=input.env??process.env;
  const reasons:string[]=[];
  if(c.financial_policy_version!==SMART_REACH_POLICY_VERSION||c.financial_billing_mode!=="smart_reach"||
    c.type!=="clicks"||![null,"standard","channel"].includes(c.campaign_kind)||c.funding_model!=="direct_debit")
    reasons.push("invalid_smart_reach_policy");
  if(!c.approved_creative_revision_id||c.pending_creative_revision_id||c.rejection_reason)
    reasons.push("admin_approval_required");
  if(!["paused","active"].includes(c.status))reasons.push("campaign_restricted");
  if(c.pause_reason==="user_paused"){
    if(!input.explicitManualResume)reasons.push("manual_pause_requires_explicit_resume");
    if(c.resume_locked_until&&new Date(c.resume_locked_until).getTime()>(input.now??new Date()).getTime())
      reasons.push("manual_pause_cooldown");
  }else if(c.pause_reason&&! ["smart_reach_billing_pending","insufficient_balance","daily_cap_reached"].includes(c.pause_reason))
    reasons.push("campaign_restricted");
  if(env.CHANNEL_PHASE1_FINANCIAL_ENABLED!=="true"||env.CHANNEL_SMART_REACH_CONFIG_ENABLED!=="true"||
    env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED!=="true")reasons.push("impression_billing_disabled");
  if(!input.schemaReady)reasons.push("impression_billing_schema_unavailable");
  if(env.CHANNEL_SMART_REACH_CPC_CLICK_SETTLEMENT_ENABLED!=="true"||!SMART_REACH_CPC_CLICK_SETTLEMENT_IMPLEMENTED)
    reasons.push("click_settlement_incomplete");
  if(env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED!=="true"||
    env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED!=="true")reasons.push("smart_reach_backend_disabled");
  if(env.CHANNEL_SMART_REACH_COMPLETE_SETTLEMENT_READY!=="true")reasons.push("complete_settlement_gate_disabled");
  try{
    const oneView=calculateSmartReachImpressionCharge({previouslyBilledViews:0,verifiedEligibleViews:1,
      effectiveCpm:String(c.smart_reach_effective_cpm),maximumCpm:String(c.smart_reach_max_cpm)}).chargeUnits;
    if(decimalToUnits(String(c.ad_balance))<oneView)reasons.push("advertiser_wallet_insufficient");
    if(decimalToUnits(String(c.budget))<oneView)reasons.push("campaign_budget_insufficient");
    const daily=decimalToUnits(String(c.daily_budget_limit??"0"));
    if(daily>BigInt(0)&&daily-decimalToUnits(input.dailySpent)<oneView)reasons.push("daily_budget_insufficient");
  }catch{reasons.push("invalid_smart_reach_funding_state");}
  return {ready:reasons.length===0,reasons};
}

/** Preliminary check only; settlement transactions must revalidate current facts. */
export async function checkSmartReachDeliveryReadiness(pool:Pool,campaignId:number,
  options:{explicitManualResume?:boolean}={}){
  const [rows]=await pool.query<Campaign[]>(`SELECT c.id,c.status,c.pause_reason,c.approved_creative_revision_id,
    c.pending_creative_revision_id,c.rejection_reason,c.financial_policy_version,c.financial_billing_mode,
    c.type,c.campaign_kind,c.funding_model,c.smart_reach_effective_cpm,c.smart_reach_max_cpm,
    c.budget,c.daily_budget_limit,c.resume_locked_until,u.ad_balance
    FROM campaigns c JOIN users u ON u.id=c.user_id WHERE c.id=?`,[campaignId]);
  if(!rows[0])return {ready:false,reasons:["campaign_not_found"]};
  const [tables]=await pool.query<Array<RowDataPacket&{table_name:string}>>(`SELECT TABLE_NAME table_name
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)`,[REQUIRED_TABLES]);
  const schemaReady=REQUIRED_TABLES.every(table=>tables.some(row=>row.table_name===table));
  let dailySpent="0";
  if(schemaReady){
    const [spent]=await pool.query<Array<RowDataPacket&{amount:string}>>(`SELECT COALESCE(SUM(advertiser_charge),0) amount
      FROM channel_smart_reach_impression_billings WHERE campaign_id=?
        AND created_at>=UTC_DATE() AND created_at<UTC_DATE()+INTERVAL 1 DAY`,[campaignId]);
    dailySpent=String(spent[0]?.amount??"0");
  }
  return evaluateSmartReachDeliveryReadiness({campaign:rows[0],dailySpent,schemaReady,...options});
}
