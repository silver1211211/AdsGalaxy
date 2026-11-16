import type {PoolConnection,RowDataPacket} from "mysql2/promise";
import {calculateDirectGrossSplit,decimalToUnits,unitsToDecimal} from "@/lib/channelAllocationMath";
import {isPhase1FinancialBackendEnabled} from "@/lib/channelPhase1FinancialPolicy";
import {listStandardCpcOutstandingAdvancesInTransaction,
  recordStandardCpcRecoveryInTransaction} from "@/lib/channelStandardCpcAllowanceLedger";

const ZERO=BigInt(0);
export type StandardCpcArrInput={campaignId:number;postId:number;publisherId:number;clickId:number;
  grossClickCharge:string;policy:"standard_cpc_allowance_v1"|"legacy"};

/**
 * Does not commit. Call after beginning the canonical click transaction; its caller
 * must commit the advertiser debit, publisher credit, click event and these rows together.
 * Legacy callers continue using the existing reserve ARR path unchanged.
 */
export async function routeStandardCpcArrForClickInTransaction(conn:PoolConnection,input:StandardCpcArrInput){
  if(input.policy==="legacy" || !isPhase1FinancialBackendEnabled())
    return {status:"legacy_passthrough" as const};
  for(const [label,value] of [["campaign_id",input.campaignId],["post_id",input.postId],
    ["publisher_id",input.publisherId],["click_id",input.clickId]] as const)
    if(!Number.isSafeInteger(value)||value<=0)throw new Error(`invalid_${label}`);
  if(typeof input.grossClickCharge!=="string" || !/^\d+(?:\.\d{1,8})?$/.test(input.grossClickCharge))
    throw new Error("arr_gross_requires_exact_decimal");
  const gross=decimalToUnits(input.grossClickCharge);
  if(gross<decimalToUnits("0.065"))throw new Error("arr_click_below_minimum_charge");
  const split=calculateDirectGrossSplit({grossDebit:input.grossClickCharge,
    publisherPercent:"60",platformPercent:"30",reservePercent:"10"});
  if(split.publisherBase+split.platform+split.reserveBase!==gross)throw new Error("arr_split_invariant_failed");
  // The allowance reader locks the stable campaign row before any click/ledger reads.
  const advances=await listStandardCpcOutstandingAdvancesInTransaction(conn,input.campaignId,input.publisherId);
  const [clicks]=await conn.query<RowDataPacket[]>(
    `SELECT cc.id FROM campaign_clicks cc
     JOIN campaign_posts cp ON cp.id=cc.post_id AND cp.campaign_id=cc.campaign_id
     JOIN channels ch ON ch.id=cp.channel_id
     WHERE cc.id=? AND cc.campaign_id=? AND cc.post_id=? AND ch.user_id=?
       AND cc.is_bot=0 AND cc.accepted_at IS NOT NULL LIMIT 1 FOR UPDATE`,
    [input.clickId,input.campaignId,input.postId,input.publisherId]);
  if(!clicks.length)throw new Error("arr_click_not_accepted_for_publisher");
  const prefix=`cpc-click:${input.clickId}:advance:`;
  const [prior]=await conn.query<Array<RowDataPacket & {amount:string;campaign_id:number;publisher_id:number}>>(
    `SELECT amount,campaign_id,publisher_id FROM channel_standard_cpc_allowance_ledger
     WHERE source_system='standard_cpc_arr' AND source_transaction_key LIKE ? FOR UPDATE`,[`${prefix}%`]);
  if(prior.length){
    if(prior.some(row=>row.campaign_id!==input.campaignId || row.publisher_id!==input.publisherId))
      throw new Error("arr_click_source_conflict");
    const recovered=prior.reduce((sum,row)=>sum+decimalToUnits(row.amount),ZERO);
    if(recovered>split.publisherBase)throw new Error("arr_duplicate_exceeds_publisher_share");
    return {status:"duplicate" as const,recoveredUnits:recovered,
      recoveredDecimal:unitsToDecimal(recovered),publisherCashUnits:split.publisherBase-recovered,
      publisherCashDecimal:unitsToDecimal(split.publisherBase-recovered),
      publisherShareUnits:split.publisherBase,platformUnits:split.platform,reserveUnits:split.reserveBase};
  }
  let remaining=split.publisherBase;
  let recovered=ZERO;
  for(const advance of advances){
    if(remaining===ZERO)break;
    const amount=remaining<advance.outstandingUnits?remaining:advance.outstandingUnits;
    if(amount===ZERO)continue;
    await recordStandardCpcRecoveryInTransaction(conn,{
      campaignId:input.campaignId,publisherId:input.publisherId,advanceEntryId:advance.entryId,
      amount:unitsToDecimal(amount),sourceTransactionKey:`${prefix}${advance.entryId}`,
      idempotencyKey:`standard-cpc-arr:c_${input.campaignId}:clk_${input.clickId}:adv_${advance.entryId}`});
    remaining-=amount;recovered+=amount;
  }
  return {status:"routed" as const,recoveredUnits:recovered,
    recoveredDecimal:unitsToDecimal(recovered),publisherCashUnits:remaining,
    publisherCashDecimal:unitsToDecimal(remaining),publisherShareUnits:split.publisherBase,
    platformUnits:split.platform,reserveUnits:split.reserveBase};
}
