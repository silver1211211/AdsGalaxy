import type {Pool,PoolConnection,RowDataPacket,ResultSetHeader} from "mysql2/promise";
import {decimalToUnits,unitsToDecimal,calculateCpcZeroClickEntitlementUnits} from "@/lib/channelAllocationMath";
import {calculateSmartReachImpressionCharge} from "@/lib/channelSmartReachImpressionMath";
import {SMART_REACH_POLICY_VERSION} from "@/lib/channelSmartReachConfiguration";
import {isEligibleChannelViewFetchSource,isEligibleChannelViewTrackingStatus} from "@/lib/channelViewPersistence";
import {claimAdvertiserDirectDebit} from "@/lib/advertiserDirectDebit";
import {creditSettledPublisherBalance} from "@/lib/earnings";
import {waivedViewsForPostSql} from "@/lib/channelViewWaivers";
import {validateViewReserveEligibility} from "@/lib/channelTrustFraudStability";

const ZERO=BigInt(0);
const CAP=decimalToUnits("0.10000000");
type Input={campaignId:number;postId:number;publisherId:number;viewAuditId:number;idempotencyKey:string};
type Row=RowDataPacket&Record<string,any>;
const dec=(value:unknown)=>decimalToUnits(String(value));
const bounded=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;

/** Called directly by a future billing adapter. Owns one complete financial transaction. */
export async function settleSmartReachImpressions(pool:Pool,input:Input){
  if(process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED!=="true"||process.env.CHANNEL_SMART_REACH_CONFIG_ENABLED!=="true"||
    process.env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED!=="true")return {status:"disabled" as const};
  if(!bounded(input.campaignId)||!bounded(input.postId)||!bounded(input.publisherId)||!bounded(input.viewAuditId)||
    !/^[A-Za-z0-9:_-]{1,160}$/.test(input.idempotencyKey))throw new Error("invalid_smart_reach_settlement_request");
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const result=await settleInTransaction(conn,input);
    await conn.commit();
    return result;
  }catch(error){await conn.rollback();throw error;}
  finally{conn.release();}
}

async function settleInTransaction(conn:PoolConnection,input:Input){
  // Campaign is the stable first lock for every Smart Reach settlement.
  const [campaignRows]=await conn.query<Row[]>(`SELECT id,user_id,status,type,campaign_kind,funding_model,
    financial_policy_version,financial_billing_mode,smart_reach_effective_cpm,smart_reach_max_cpm,
    budget,daily_budget_limit FROM campaigns WHERE id=? FOR UPDATE`,[input.campaignId]);
  const c=campaignRows[0];
  if(!c||c.financial_policy_version!==SMART_REACH_POLICY_VERSION||c.financial_billing_mode!=="smart_reach"||
    c.type!=="clicks"||!["standard","channel",null].includes(c.campaign_kind)||c.funding_model!=="direct_debit")
    throw new Error("smart_reach_campaign_policy_mismatch");
  if(c.status!=="active")throw new Error("smart_reach_campaign_not_delivering");
  const [replayRows]=await conn.query<Row[]>(
    "SELECT id,campaign_id,publisher_id,post_id,view_audit_id,advertiser_charge FROM channel_smart_reach_impression_billings WHERE idempotency_key=? FOR UPDATE",
    [input.idempotencyKey]);
  if(replayRows.length){
    const e=replayRows[0];
    if(Number(e.campaign_id)!==input.campaignId||Number(e.publisher_id)!==input.publisherId||
      Number(e.post_id)!==input.postId||Number(e.view_audit_id)!==input.viewAuditId)
      throw new Error("smart_reach_idempotency_conflict");
    return {status:"duplicate" as const,billingEventId:Number(e.id),chargeDecimal:String(e.advertiser_charge)};
  }
  const [postRows]=await conn.query<Row[]>(`SELECT cp.id,cp.campaign_id,cp.channel_id,cp.status,cp.views,
    cp.delivery_confirmed_at,cp.delivery_failed_at,cp.deleted_at,cp.view_fetch_status,cp.view_fetch_source,
    ${waivedViewsForPostSql("cp")} waived_views,ch.user_id publisher_id,ch.status channel_status,
    ch.view_tracking_status,ch.subscriber_count,ch.under_review,ch.is_deleted,
    ch.revenue_protection_status,ch.settlement_excluded_until,
    u.is_banned publisher_banned
    FROM campaign_posts cp JOIN channels ch ON ch.id=cp.channel_id JOIN users u ON u.id=ch.user_id
    WHERE cp.id=? AND cp.campaign_id=? FOR UPDATE`,[input.postId,input.campaignId]);
  const p=postRows[0];
  if(!p||Number(p.publisher_id)!==input.publisherId||p.status!=="active"||!p.delivery_confirmed_at||
    p.delivery_failed_at||p.deleted_at||p.view_fetch_status!=="success"||
    !isEligibleChannelViewFetchSource(p.view_fetch_source)||!isEligibleChannelViewTrackingStatus(p.view_tracking_status)||
    p.channel_status!=="active"||Number(p.under_review)!==0||Number(p.is_deleted)!==0||
    ["blocked","confirmed_fraud"].includes(String(p.revenue_protection_status||""))||
    (p.settlement_excluded_until&&new Date(p.settlement_excluded_until).getTime()>Date.now())||
    Number(p.publisher_banned)!==0||Number(p.subscriber_count)<100)
    throw new Error("smart_reach_view_evidence_ineligible");
  const [auditRows]=await conn.query<Row[]>(`SELECT id,post_id,channel_id,total_views,status
    FROM campaign_views_audit WHERE id=? FOR UPDATE`,[input.viewAuditId]);
  const a=auditRows[0];
  const rawViews=Number(p.views),waived=Number(p.waived_views),auditViews=Number(a?.total_views);
  if(!a||a.status!=="valid"||Number(a.post_id)!==input.postId||Number(a.channel_id)!==Number(p.channel_id)||
    !Number.isSafeInteger(rawViews)||!Number.isSafeInteger(auditViews)||!Number.isSafeInteger(waived)||
    waived<0||auditViews>rawViews||auditViews-waived<=0)
    throw new Error("smart_reach_audit_mismatch");
  const [fraudRows]=await conn.query<Row[]>(`SELECT id FROM channel_fraud_events WHERE channel_id=?
    AND (post_id=? OR post_id IS NULL) AND (campaign_id=? OR campaign_id IS NULL)
    AND billing_state IN ('suspicious','confirmed_fraud','critical_fraud') AND false_positive_at IS NULL
    LIMIT 1 LOCK IN SHARE MODE`,[p.channel_id,input.postId,input.campaignId]);
  if(fraudRows.length)throw new Error("smart_reach_fraud_hold");
  const viewRule=validateViewReserveEligibility({views:auditViews-waived,clicks:0,
    subscriberCount:Number(p.subscriber_count),channelStatus:String(p.channel_status)});
  if(!viewRule.isEligible)throw new Error("smart_reach_view_policy_ineligible");
  const [priorRows]=await conn.query<Row[]>(`SELECT id,through_view_count FROM channel_smart_reach_impression_billings
    WHERE post_id=? ORDER BY through_view_count DESC LIMIT 1 FOR UPDATE`,[input.postId]);
  const prior=Number(priorRows[0]?.through_view_count||0);
  const [segmentRows]=await conn.query<Row[]>(`SELECT through_view_count FROM channel_smart_reach_impression_billings
    WHERE post_id=? AND effective_cpm<>? ORDER BY through_view_count DESC LIMIT 1 FOR UPDATE`,
    [input.postId,c.smart_reach_effective_cpm]);
  const segmentStart=Number(segmentRows[0]?.through_view_count||0);
  const eligible=auditViews-waived;
  await conn.query("INSERT IGNORE INTO channel_smart_reach_publisher_accounts(campaign_id,publisher_id) VALUES (?,?)",
    [input.campaignId,input.publisherId]);
  const [accountRows]=await conn.query<Row[]>(`SELECT * FROM channel_smart_reach_publisher_accounts
    WHERE campaign_id=? AND publisher_id=? FOR UPDATE`,[input.campaignId,input.publisherId]);
  const account=accountRows[0];
  const [claimRows]=await conn.query<Row[]>(`SELECT * FROM channel_smart_reach_view_claims
    WHERE campaign_id=? AND publisher_id=? ORDER BY id FOR UPDATE`,[input.campaignId,input.publisherId]);
  const claimEntitled=claimRows.reduce((sum,row)=>sum+dec(row.entitled_amount),ZERO);
  const claimFunded=claimRows.reduce((sum,row)=>sum+dec(row.funded_amount),ZERO);
  if(claimEntitled!==dec(account.entitled_amount)||claimFunded!==dec(account.funded_amount)||
    dec(account.pending_amount)!==claimEntitled-claimFunded)
    throw new Error("smart_reach_account_claim_reconciliation_failed");
  const priorClaim=claimRows.find(row=>Number(row.post_id)===input.postId);
  const oldPostViews=BigInt(priorClaim?.observed_views||0);
  const oldTotalViews=claimRows.reduce((sum,row)=>sum+BigInt(row.observed_views),ZERO);
  const oldEntitled=dec(account.entitled_amount);
  if(oldEntitled>CAP)throw new Error("smart_reach_entitlement_cap_exceeded");
  const oldCurve=calculateCpcZeroClickEntitlementUnits(oldTotalViews);
  if(oldEntitled!==oldCurve)throw new Error("smart_reach_entitlement_view_reconciliation_failed");
  if(BigInt(eligible)===oldPostViews&&oldEntitled===CAP)
    return {status:"capped" as const,chargeDecimal:"0.00000000",newViews:0};
  if(BigInt(eligible)===oldPostViews&&BigInt(prior)<oldPostViews)
    return {status:"no_charge" as const,chargeDecimal:"0.00000000",newViews:0};
  if(BigInt(eligible)<=oldPostViews||BigInt(prior)>oldPostViews)
    throw new Error("smart_reach_stale_or_invalid_view_range");
  const newTotalViews=oldTotalViews-oldPostViews+BigInt(eligible);
  const target=calculateCpcZeroClickEntitlementUnits(newTotalViews);
  let billableNewViews=BigInt(eligible)-oldPostViews;
  if(oldEntitled===CAP)billableNewViews=ZERO;
  else if(target>=CAP){
    // Find the first cumulative view at which the existing V1.01 curve reaches the cap.
    let lower=oldTotalViews+BigInt(1),upper=newTotalViews;
    while(lower<upper){
      const middle=(lower+upper)/BigInt(2);
      if(calculateCpcZeroClickEntitlementUnits(middle)>=CAP)upper=middle;
      else lower=middle+BigInt(1);
    }
    billableNewViews=lower-oldTotalViews;
  }
  if(billableNewViews===ZERO){
    // The audit still advances analytics, while no wallet or billing ledger entry is created.
    if(priorClaim)await conn.query("UPDATE channel_smart_reach_view_claims SET observed_views=? WHERE id=?",
      [eligible,priorClaim.id]);
    else await conn.query(`INSERT INTO channel_smart_reach_view_claims
      (campaign_id,publisher_id,post_id,channel_id,observed_views) VALUES (?,?,?,?,?)`,
      [input.campaignId,input.publisherId,input.postId,p.channel_id,eligible]);
    return {status:"capped" as const,chargeDecimal:"0.00000000",newViews:0};
  }
  const billedThrough=Number(oldPostViews+billableNewViews);
  const charge=calculateSmartReachImpressionCharge({previouslyBilledViews:Number(oldPostViews),verifiedEligibleViews:billedThrough,
    rateSegmentStartViews:segmentStart,effectiveCpm:String(c.smart_reach_effective_cpm),
    maximumCpm:String(c.smart_reach_max_cpm)});
  const increase=target>oldEntitled?target-oldEntitled:ZERO;
  const entitlementDelta=increase<CAP-oldEntitled?increase:CAP-oldEntitled;
  const [priorPools]=await conn.query<Row[]>(`SELECT publisher_pool_amount,publisher_funding
    FROM channel_smart_reach_impression_billings WHERE campaign_id=? AND publisher_id=?
    ORDER BY id FOR UPDATE`,[input.campaignId,input.publisherId]);
  const unusedFunding=priorPools.reduce((sum,row)=>sum+dec(row.publisher_pool_amount)-dec(row.publisher_funding),ZERO);
  const outstanding=dec(account.pending_amount)+entitlementDelta-unusedFunding;
  if(outstanding<ZERO)throw new Error("smart_reach_existing_pool_exceeds_entitlement");
  const actualUnits=charge.chargeUnits<outstanding?charge.chargeUnits:outstanding;
  const actualDecimal=unitsToDecimal(actualUnits);
  let walletKey:string|undefined;
  if(actualUnits>ZERO){
  if(dec(c.budget)<actualUnits)throw new Error("smart_reach_budget_insufficient");
  const daily=dec(c.daily_budget_limit||"0");
  if(daily>ZERO){
    const [spentRows]=await conn.query<Row[]>(`SELECT COALESCE(SUM(advertiser_charge),0) amount
      FROM channel_smart_reach_impression_billings WHERE campaign_id=? AND created_at>=UTC_DATE()
        AND created_at<UTC_DATE()+INTERVAL 1 DAY`,[input.campaignId]);
    if(dec(spentRows[0].amount)+actualUnits>daily)throw new Error("smart_reach_daily_budget_reached");
  }
  const [walletRows]=await conn.query<Row[]>("SELECT id,ad_balance FROM users WHERE id=? FOR UPDATE",[c.user_id]);
  if(!walletRows[0]||dec(walletRows[0].ad_balance)<actualUnits)throw new Error("smart_reach_wallet_insufficient");
  walletKey=`smart_reach:wallet:${input.idempotencyKey}`;
  const debit=await claimAdvertiserDirectDebit(conn,{sourceKey:walletKey,advertiserId:Number(c.user_id),
    campaignId:input.campaignId,campaignTable:"campaigns",billingType:"channel_view",
    amount:actualDecimal,description:`Smart Reach impressions ${input.idempotencyKey}`});
  if(!debit.ok)throw new Error(debit.duplicate?"smart_reach_wallet_duplicate":"smart_reach_wallet_insufficient");
  }
  let claimId:number;
  if(priorClaim){
    claimId=Number(priorClaim.id);
    await conn.query(`UPDATE channel_smart_reach_view_claims SET observed_views=?,entitled_amount=entitled_amount+?,
      pending_amount=pending_amount+? WHERE id=?`,[eligible,unitsToDecimal(entitlementDelta),unitsToDecimal(entitlementDelta),claimId]);
  }else{
    const [created]=await conn.query<ResultSetHeader>(`INSERT INTO channel_smart_reach_view_claims
      (campaign_id,publisher_id,post_id,channel_id,observed_views,entitled_amount,pending_amount)
      VALUES (?,?,?,?,?,?,?)`,[input.campaignId,input.publisherId,input.postId,p.channel_id,eligible,
        unitsToDecimal(entitlementDelta),unitsToDecimal(entitlementDelta)]);
    claimId=created.insertId;
  }
  await conn.query(`UPDATE channel_smart_reach_publisher_accounts
    SET entitled_amount=entitled_amount+?,pending_amount=pending_amount+?
    WHERE campaign_id=? AND publisher_id=?`,[unitsToDecimal(entitlementDelta),unitsToDecimal(entitlementDelta),input.campaignId,input.publisherId]);
  let eventId:number|undefined;
  if(actualUnits>ZERO){
  const [event]=await conn.query<ResultSetHeader>(`INSERT INTO channel_smart_reach_impression_billings
    (idempotency_key,campaign_id,publisher_id,post_id,channel_id,advertiser_id,claim_id,view_audit_id,
     from_view_count,through_view_count,billable_views,effective_cpm,advertiser_charge,publisher_pool_amount,
     wallet_debit_source_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[input.idempotencyKey,input.campaignId,input.publisherId,input.postId,
      p.channel_id,c.user_id,claimId,input.viewAuditId,prior,eligible,Number(charge.newViews),
      charge.effectiveCpmDecimal,actualDecimal,actualDecimal,walletKey]);
  await conn.query("UPDATE campaigns SET budget=budget-?,spend=spend+? WHERE id=?",
    [actualDecimal,actualDecimal,input.campaignId]);
  eventId=event.insertId;
  }
  // All publisher funding for Smart Reach impressions is advertiser-paid (owner policy).
  // Earliest unfunded billing pools and claims are matched deterministically.
  const [pools]=await conn.query<Row[]>(`SELECT id,publisher_pool_amount,publisher_funding FROM channel_smart_reach_impression_billings
    WHERE campaign_id=? AND publisher_id=? AND publisher_funding<publisher_pool_amount ORDER BY id FOR UPDATE`,
    [input.campaignId,input.publisherId]);
  const [pendingClaims]=await conn.query<Row[]>(`SELECT id,entitled_amount,funded_amount FROM channel_smart_reach_view_claims
    WHERE campaign_id=? AND publisher_id=? AND pending_amount>0 ORDER BY COALESCE(last_funded_at,created_at),id FOR UPDATE`,
    [input.campaignId,input.publisherId]);
  let credited=ZERO;
  for(const poolRow of pools){
    const [usedRows]=await conn.query<Row[]>(`SELECT COALESCE(SUM(amount),0) used
      FROM channel_smart_reach_funding_allocations WHERE billing_event_id=?`,[poolRow.id]);
    if(dec(usedRows[0].used)!==dec(poolRow.publisher_funding))throw new Error("smart_reach_pool_allocation_mismatch");
    let available=dec(poolRow.publisher_pool_amount)-dec(poolRow.publisher_funding);
    for(const claim of pendingClaims){
      if(available===ZERO)break;
      const remaining=dec(claim.entitled_amount)-dec(claim.funded_amount);
      if(remaining<=ZERO)continue;
      const [claimUsedRows]=await conn.query<Row[]>(`SELECT COALESCE(SUM(amount),0) used
        FROM channel_smart_reach_funding_allocations WHERE claim_id=?`,[claim.id]);
      let reserveUsed=ZERO;
      try{
        const [reserveUsedRows]=await conn.query<Row[]>(`SELECT COALESCE(SUM(amount),0) used
          FROM channel_smart_reach_reserve_allocations WHERE claim_id=?`,[claim.id]);
        reserveUsed=dec(reserveUsedRows[0].used);
      }catch(error){
        if(process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED==="true"||
          (error as {code?:string}).code!=="ER_NO_SUCH_TABLE")throw error;
      }
      if(dec(claimUsedRows[0].used)+reserveUsed!==dec(claim.funded_amount))
        throw new Error("smart_reach_claim_allocation_mismatch");
      const amount=available<remaining?available:remaining;
      const key=`smart_reach:allocation:${poolRow.id}:${claim.id}`;
      const [allocation]=await conn.query<ResultSetHeader>(`INSERT INTO channel_smart_reach_funding_allocations
        (billing_event_id,claim_id,campaign_id,publisher_id,amount,idempotency_key)
        VALUES (?,?,?,?,?,?)`,[poolRow.id,claim.id,input.campaignId,input.publisherId,unitsToDecimal(amount),key]);
      const creditedOk=await creditSettledPublisherBalance(conn,input.publisherId,unitsToDecimal(amount),{
        sourceKey:key,sourceSystem:"smart_reach_advertiser_impression",sourceRecordId:String(allocation.insertId),
        policyVersion:SMART_REACH_POLICY_VERSION});
      if(!creditedOk)throw new Error("smart_reach_publisher_credit_failed");
      await conn.query(`UPDATE channel_smart_reach_view_claims SET funded_amount=funded_amount+?,
        pending_amount=pending_amount-?,last_funded_at=UTC_TIMESTAMP(6) WHERE id=?`,
        [unitsToDecimal(amount),unitsToDecimal(amount),claim.id]);
      await conn.query(`UPDATE channel_smart_reach_publisher_accounts SET funded_amount=funded_amount+?,
        pending_amount=pending_amount-? WHERE campaign_id=? AND publisher_id=?`,
        [unitsToDecimal(amount),unitsToDecimal(amount),input.campaignId,input.publisherId]);
      await conn.query(`UPDATE channel_smart_reach_impression_billings SET publisher_funding=publisher_funding+?,
        publisher_credit_source_key=COALESCE(publisher_credit_source_key,?) WHERE id=?`,
        [unitsToDecimal(amount),key,poolRow.id]);
      claim.funded_amount=unitsToDecimal(dec(claim.funded_amount)+amount);
      available-=amount;credited+=amount;
    }
  }
  if(eventId===undefined)return {status:"no_charge" as const,chargeDecimal:actualDecimal,
    creditedDecimal:unitsToDecimal(credited),newViews:Number(charge.newViews)};
  return {status:"settled" as const,billingEventId:eventId,chargeDecimal:actualDecimal,
    creditedDecimal:unitsToDecimal(credited),newViews:Number(charge.newViews)};
}
