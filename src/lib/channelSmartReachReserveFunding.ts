import type {Pool,RowDataPacket,ResultSetHeader} from "mysql2/promise";
import {decimalToUnits,unitsToDecimal} from "@/lib/channelAllocationMath";
import {SMART_REACH_POLICY_VERSION} from "@/lib/channelSmartReachConfiguration";
import {acquireSharedReserveTreasuryLock} from "@/lib/channelUnifiedSettlement";
import {getReserveTreasuryBalance} from "@/lib/channelReserveTreasury";
import {creditSettledPublisherBalance} from "@/lib/earnings";

type Row=RowDataPacket&Record<string,any>;
const ZERO=BigInt(0);
const dec=(x:unknown)=>decimalToUnits(String(x));

/** Funds existing, verified pending claims only; never creates new entitlement. */
export async function fundPendingSmartReachClaimsFromReserve(pool:Pool,campaignId:number,publisherId:number){
  if(process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED!=="true")
    return {status:"disabled" as const,creditedDecimal:"0.00000000"};
  if(!Number.isSafeInteger(campaignId)||campaignId<=0||!Number.isSafeInteger(publisherId)||publisherId<=0)
    throw new Error("invalid_smart_reach_reserve_request");
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[campaign]]=await conn.query<Row[]>(`SELECT financial_policy_version,financial_billing_mode,status
      FROM campaigns WHERE id=? FOR UPDATE`,[campaignId]);
    if(!campaign||campaign.financial_policy_version!==SMART_REACH_POLICY_VERSION||
      campaign.financial_billing_mode!=="smart_reach"||campaign.status!=="active")
      throw new Error("smart_reach_reserve_campaign_ineligible");
    if(!await acquireSharedReserveTreasuryLock(conn))throw new Error("smart_reach_treasury_lock_unavailable");
    const [accounts]=await conn.query<Row[]>(`SELECT entitled_amount,funded_amount,pending_amount
      FROM channel_smart_reach_publisher_accounts WHERE campaign_id=? AND publisher_id=? FOR UPDATE`,
      [campaignId,publisherId]);
    if(!accounts[0]){await conn.commit();return {status:"nothing_pending" as const,creditedDecimal:"0.00000000"};}
    const account=accounts[0];
    const [claims]=await conn.query<Row[]>(`SELECT id,entitled_amount,funded_amount,pending_amount
      FROM channel_smart_reach_view_claims WHERE campaign_id=? AND publisher_id=?
      ORDER BY id FOR UPDATE`,[campaignId,publisherId]);
    const totalEntitled=claims.reduce((s,r)=>s+dec(r.entitled_amount),ZERO);
    const totalFunded=claims.reduce((s,r)=>s+dec(r.funded_amount),ZERO);
    if(totalEntitled!==dec(account.entitled_amount)||totalFunded!==dec(account.funded_amount)||
      totalEntitled-totalFunded!==dec(account.pending_amount)||totalEntitled>dec("0.10"))
      throw new Error("smart_reach_reserve_claim_reconciliation_failed");
    const global=await getReserveTreasuryBalance(conn);
    const own=await getReserveTreasuryBalance(conn,campaignId);
    let available=global.unencumberedSpendableBalanceUnits<own.unencumberedSpendableBalanceUnits
      ?global.unencumberedSpendableBalanceUnits:own.unencumberedSpendableBalanceUnits;
    if(!global.isSolvent||!own.isSolvent)throw new Error("smart_reach_reserve_insolvent");
    if(available<=ZERO){await conn.commit();return {status:"unfunded" as const,creditedDecimal:"0.00000000"};}
    const [sources]=await conn.query<Row[]>(`SELECT id,amount,idempotency_key FROM channel_reserve_treasury_ledger
      WHERE campaign_id=? AND policy_version=? AND entry_type='allocation_inflow' AND direction='in'
      ORDER BY id FOR UPDATE`,[campaignId,SMART_REACH_POLICY_VERSION]);
    let credited=ZERO;
    for(const source of sources){
      if(available<=ZERO)break;
      const [[used]]=await conn.query<Row[]>(`SELECT COALESCE(SUM(committed_amount),0) amount
        FROM channel_smart_reach_reserve_fundings WHERE reserve_ledger_id=? AND status IN ('committed','consumed')`,[source.id]);
      let sourceRemaining=dec(source.amount)-dec(used.amount);
      if(sourceRemaining<ZERO)throw new Error("smart_reach_reserve_source_overcommitted");
      for(const claim of claims){
        if(available<=ZERO||sourceRemaining<=ZERO)break;
        const pending=dec(claim.entitled_amount)-dec(claim.funded_amount);
        if(pending<=ZERO)continue;
        const [[advertiserAlloc]]=await conn.query<Row[]>(`SELECT COALESCE(SUM(amount),0) amount
          FROM channel_smart_reach_funding_allocations WHERE claim_id=?`,[claim.id]);
        const [[reserveAlloc]]=await conn.query<Row[]>(`SELECT COALESCE(SUM(amount),0) amount
          FROM channel_smart_reach_reserve_allocations WHERE claim_id=?`,[claim.id]);
        if(dec(advertiserAlloc.amount)+dec(reserveAlloc.amount)!==dec(claim.funded_amount))
          throw new Error("smart_reach_reserve_allocation_mismatch");
        const amount=[pending,available,sourceRemaining].reduce((a,b)=>a<b?a:b);
        const key=`smart_reach:reserve:${source.id}:${claim.id}:${dec(claim.funded_amount)}`;
        const [funding]=await conn.query<ResultSetHeader>(`INSERT INTO channel_smart_reach_reserve_fundings
          (reserve_ledger_id,campaign_id,publisher_id,claim_id,committed_amount,consumed_amount,status,
           idempotency_key,source_financial_ref,consumed_at)
          VALUES(?,?,?,?,?,?,'consumed',?,?,UTC_TIMESTAMP(6))`,
          [source.id,campaignId,publisherId,claim.id,unitsToDecimal(amount),unitsToDecimal(amount),key,String(source.idempotency_key)]);
        const creditKey=`${key}:credit`;
        await conn.query(`INSERT INTO channel_smart_reach_reserve_allocations
          (reserve_funding_id,claim_id,campaign_id,publisher_id,amount,idempotency_key,publisher_credit_source_key)
          VALUES(?,?,?,?,?,?,?)`,[funding.insertId,claim.id,campaignId,publisherId,unitsToDecimal(amount),key,creditKey]);
        if(!await creditSettledPublisherBalance(conn,publisherId,unitsToDecimal(amount),{
          sourceKey:creditKey,sourceSystem:"smart_reach_collected_reserve",sourceRecordId:String(funding.insertId),
          policyVersion:SMART_REACH_POLICY_VERSION}))throw new Error("smart_reach_reserve_credit_failed");
        await conn.query(`UPDATE channel_smart_reach_view_claims SET funded_amount=funded_amount+?,
          pending_amount=pending_amount-?,last_funded_at=UTC_TIMESTAMP(6) WHERE id=?`,
          [unitsToDecimal(amount),unitsToDecimal(amount),claim.id]);
        await conn.query(`UPDATE channel_smart_reach_publisher_accounts SET funded_amount=funded_amount+?,
          pending_amount=pending_amount-? WHERE campaign_id=? AND publisher_id=?`,
          [unitsToDecimal(amount),unitsToDecimal(amount),campaignId,publisherId]);
        claim.funded_amount=unitsToDecimal(dec(claim.funded_amount)+amount);
        available-=amount;sourceRemaining-=amount;credited+=amount;
      }
      if(claims.every(claim=>dec(claim.entitled_amount)===dec(claim.funded_amount)))break;
    }
    await conn.commit();
    return {status:credited>ZERO?"funded" as const:"unfunded" as const,creditedDecimal:unitsToDecimal(credited)};
  }catch(error){await conn.rollback();throw error;}
  finally{conn.release();}
}
