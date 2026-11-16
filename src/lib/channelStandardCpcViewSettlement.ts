import type {PoolConnection,ResultSetHeader,RowDataPacket} from "mysql2/promise";
import {calculateCpcZeroClickEntitlementUnits,decimalToUnits,unitsToDecimal} from "@/lib/channelAllocationMath";
import {STANDARD_CPC_CLICK_POLICY_VERSION,isPhase1FinancialBackendEnabled} from "@/lib/channelPhase1FinancialPolicy";
import {checkAuthoritativeCpcPostEligibility} from "@/lib/channelCpcZeroClickEligibility";
import {readStandardCpcAllowanceBalanceInTransaction,recordStandardCpcAdvanceInTransaction} from "@/lib/channelStandardCpcAllowanceLedger";
import {creditSettledPublisherBalance} from "@/lib/earnings";

const ZERO=BigInt(0);
const CAP=decimalToUnits("0.10000000");
const TABLE="channel_standard_cpc_view_entitlements";
type ViewRow=RowDataPacket&{id:number;campaign_id:number;publisher_id:number;post_id:number;channel_id:number;
  observed_views:number;entitled_amount:string;funded_amount:string;pending_amount:string;hold_reason:string|null};

async function assertNewPolicy(conn:PoolConnection,campaignId:number){
  if(!isPhase1FinancialBackendEnabled() || process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED!=="true")
    throw new Error("standard_cpc_view_policy_disabled");
  const [rows]=await conn.query<Array<RowDataPacket&{financial_policy_version:string|null;type:string;campaign_kind:string|null}>>(
    "SELECT financial_policy_version,type,campaign_kind FROM campaigns WHERE id=? FOR UPDATE",[campaignId]);
  if(rows[0]?.financial_policy_version!==STANDARD_CPC_CLICK_POLICY_VERSION || rows[0]?.type!=="clicks" ||
    ![null,"standard","channel"].includes(rows[0]?.campaign_kind))throw new Error("standard_cpc_view_policy_mismatch");
}

/** Oldest unserved claim first; a partial payment moves that row to the end. */
export async function fundPendingStandardCpcViewsInTransaction(conn:PoolConnection,campaignId:number){
  await assertNewPolicy(conn,campaignId);
  const [rows]=await conn.query<ViewRow[]>(
    `SELECT * FROM ${TABLE} WHERE campaign_id=? AND pending_amount>0 AND hold_reason IS NULL
     ORDER BY COALESCE(last_funded_at,created_at),id LIMIT 256 FOR UPDATE`,[campaignId]);
  let credited=ZERO;
  for(const row of rows){
    const balance=await readStandardCpcAllowanceBalanceInTransaction(conn,campaignId);
    if(balance.capacityUnits===ZERO)break;
    const authority=await checkAuthoritativeCpcPostEligibility(conn,{campaignId,postId:Number(row.post_id),publisherId:Number(row.publisher_id)});
    if(!authority.eligible){
      if(authority.reason==="schema_not_ready")throw new Error("standard_cpc_view_evidence_schema_unavailable");
      await conn.query(`UPDATE ${TABLE} SET hold_reason=? WHERE id=?`,[authority.reason.slice(0,80),row.id]);
      continue;
    }
    if(Number(authority.post.channel_id)!==Number(row.channel_id) || authority.authoritativeEligibleViews<Number(row.observed_views)){
      await conn.query(`UPDATE ${TABLE} SET hold_reason='view_evidence_changed' WHERE id=?`,[row.id]);
      continue;
    }
    const pending=decimalToUnits(row.pending_amount);
    const amount=pending<balance.capacityUnits?pending:balance.capacityUnits;
    if(amount===ZERO)continue;
    const newFunded=decimalToUnits(row.funded_amount)+amount;
    const sourceKey=`standard-cpc-view:row:${row.id}:funded:${unitsToDecimal(newFunded)}`;
    const advance=await recordStandardCpcAdvanceInTransaction(conn,{
      campaignId,publisherId:Number(row.publisher_id),amount:unitsToDecimal(amount),
      sourceTransactionKey:sourceKey,idempotencyKey:sourceKey});
    if(advance.status!=="recorded")throw new Error("standard_cpc_view_advance_replay_conflict");
    if(!(await creditSettledPublisherBalance(conn,Number(row.publisher_id),unitsToDecimal(amount),{
      sourceKey:sourceKey+":publisher",sourceSystem:"standard_cpc_view_allowance",
      sourceRecordId:String(row.id),policyVersion:STANDARD_CPC_CLICK_POLICY_VERSION,
    })))throw new Error("standard_cpc_view_credit_failed");
    await conn.query(
      `UPDATE ${TABLE} SET funded_amount=?,pending_amount=entitled_amount-?,last_funded_at=NOW(6) WHERE id=?`,
      [unitsToDecimal(newFunded),unitsToDecimal(newFunded),row.id]);
    await conn.query(
      `INSERT INTO channel_unified_settlement_events
       (idempotency_key,settlement_type,campaign_id,post_id,channel_id,publisher_id,advertiser_id,
        units,unit_price,advertiser_debit,publisher_credit,platform_revenue,reserve_contribution,arr_recovered,status)
       VALUES (?,'cpc_zero_click_advance',?,?,?,?,0,?,0,0,?,0,0,0,'settled')`,
      [sourceKey,campaignId,row.post_id,row.channel_id,row.publisher_id,row.observed_views,unitsToDecimal(amount)]);
    credited+=amount;
  }
  return {creditedUnits:credited,creditedDecimal:unitsToDecimal(credited),examined:rows.length,
    batchLimitReached:rows.length===256};
}

export async function observeStandardCpcZeroClickViewsInTransaction(conn:PoolConnection,input:{
  campaignId:number;postId:number;channelId:number;publisherId:number;eligibleViews:number|bigint;
}){
  await assertNewPolicy(conn,input.campaignId);
  const authority=await checkAuthoritativeCpcPostEligibility(conn,{
    campaignId:input.campaignId,postId:input.postId,publisherId:input.publisherId});
  if(!authority.eligible)return {status:"rejected" as const,reason:authority.reason,
    targetUnits:ZERO,fundingUnits:ZERO,fundedUnits:ZERO,pendingUnits:ZERO};
  const views=authority.authoritativeEligibleViews;
  if(!Number.isSafeInteger(views)||views<=0||Number(input.eligibleViews)!==views||
     Number(authority.post.channel_id)!==Number(input.channelId))
    return {status:"rejected" as const,reason:"verified_views_mismatch_or_missing",
      targetUnits:ZERO,fundingUnits:ZERO,fundedUnits:ZERO,pendingUnits:ZERO};
  const [priorRows]=await conn.query<ViewRow[]>(`SELECT * FROM ${TABLE} WHERE post_id=? FOR UPDATE`,[input.postId]);
  const prior=priorRows[0];
  if(prior && (Number(prior.campaign_id)!==input.campaignId||Number(prior.publisher_id)!==input.publisherId||
      Number(prior.channel_id)!==input.channelId))throw new Error("standard_cpc_view_attribution_conflict");
  const [publisherRows]=await conn.query<ViewRow[]>(
    `SELECT * FROM ${TABLE} WHERE campaign_id=? AND publisher_id=? ORDER BY id FOR UPDATE`,
    [input.campaignId,input.publisherId]);
  const totalEntitled=publisherRows.reduce((sum,row)=>sum+decimalToUnits(row.entitled_amount),ZERO);
  if(totalEntitled>CAP)throw new Error("standard_cpc_view_publisher_cap_exceeded");
  const oldEntitled=prior?decimalToUnits(prior.entitled_amount):ZERO;
  const curve=calculateCpcZeroClickEntitlementUnits(views);
  const increase=curve>oldEntitled?curve-oldEntitled:ZERO;
  const headroom=CAP-totalEntitled;
  const nextEntitled=oldEntitled+(increase<headroom?increase:headroom);
  let rowId=prior?.id;
  if(prior){
    await conn.query(`UPDATE ${TABLE} SET observed_views=GREATEST(observed_views,?),entitled_amount=?,
      pending_amount=?-funded_amount,hold_reason=NULL WHERE id=?`,
      [views,unitsToDecimal(nextEntitled),unitsToDecimal(nextEntitled),rowId]);
  }else{
    const [insert]=await conn.query<ResultSetHeader>(`INSERT INTO ${TABLE}
      (campaign_id,publisher_id,post_id,channel_id,observed_views,entitled_amount,pending_amount)
      VALUES (?,?,?,?,?,?,?)`,[input.campaignId,input.publisherId,input.postId,input.channelId,views,
        unitsToDecimal(nextEntitled),unitsToDecimal(nextEntitled)]);
    rowId=insert.insertId;
  }
  const before=prior?decimalToUnits(prior.funded_amount):ZERO;
  await fundPendingStandardCpcViewsInTransaction(conn,input.campaignId);
  const [afterRows]=await conn.query<ViewRow[]>(`SELECT * FROM ${TABLE} WHERE id=? FOR UPDATE`,[rowId]);
  const after=afterRows[0];
  const funded=decimalToUnits(after.funded_amount);
  const pending=decimalToUnits(after.pending_amount);
  const funding=funded-before;
  return {status:funding>ZERO?(pending>ZERO?"partially_funded" as const:"funded" as const):
    (pending>ZERO?"exhausted" as const:"already_funded" as const),reason:undefined,
    targetUnits:decimalToUnits(after.entitled_amount),fundingUnits:funding,fundedUnits:funded,pendingUnits:pending};
}
