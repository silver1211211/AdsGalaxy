import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { decimalToUnits, unitsToDecimal } from "@/lib/channelAllocationMath";
import { STANDARD_CPC_ADVANCE_LIMIT_UNITS, isPhase1FinancialBackendEnabled } from "@/lib/channelPhase1FinancialPolicy";

const TABLE = "channel_standard_cpc_allowance_ledger";
const ZERO = BigInt(0);
type Operation = "advance" | "recovery" | "reversal";
type SourceSystem = "standard_cpc_advance" | "standard_cpc_arr" | "standard_cpc_reversal";
type Entry = RowDataPacket & { id: number; campaign_id: number; publisher_id:number; operation: Operation;
  amount: string; outstanding_delta: string; source_system: SourceSystem;
  source_transaction_key: string; idempotency_key: string; reverses_entry_id: number | null;
  applies_to_advance_entry_id: number | null };
export type AllowanceBalance = { outstandingUnits: bigint; capacityUnits: bigint;
  outstandingDecimal: string; capacityDecimal: string };
export type AllowanceWriteResult = AllowanceBalance & { status: "recorded" | "duplicate"; entryId: number };
type BaseInput = { campaignId: number; publisherId:number; amount: string; sourceTransactionKey: string; idempotencyKey: string };

function positiveId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid_${label}`);
}
function positiveAmount(amount: string): bigint {
  if (typeof amount !== "string" || !/^\d+(?:\.\d{1,8})?$/.test(amount)) throw new Error("allowance_amount_requires_exact_8_decimal_input");
  const units = decimalToUnits(amount);
  if (units <= ZERO || units > STANDARD_CPC_ADVANCE_LIMIT_UNITS) throw new Error("invalid_allowance_amount");
  return units;
}
function key(value: string, label: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 191)
    throw new Error(`invalid_${label}`);
}
function validate(input: BaseInput) {
  positiveId(input.campaignId, "campaign_id");
  positiveId(input.publisherId, "publisher_id");
  key(input.sourceTransactionKey, "source_transaction_key");
  key(input.idempotencyKey, "idempotency_key");
  return positiveAmount(input.amount);
}
async function lockStandardCampaign(conn: PoolConnection, campaignId: number) {
  const [rows] = await conn.query<Array<RowDataPacket & {type:string;campaign_kind:string|null}>>(
    "SELECT type,campaign_kind FROM campaigns WHERE id=? FOR UPDATE",[campaignId]);
  if (!rows[0] || rows[0].type !== "clicks" || ![null,"standard","channel"].includes(rows[0].campaign_kind))
    throw new Error("allowance_requires_standard_cpc_campaign");
}
async function balanceLocked(conn: PoolConnection, campaignId: number): Promise<AllowanceBalance> {
  const [rows] = await conn.query<Array<RowDataPacket & {outstanding_delta:string}>>(
    `SELECT outstanding_delta FROM ${TABLE} WHERE campaign_id=? ORDER BY id FOR UPDATE`,[campaignId]);
  const outstandingUnits = rows.reduce((sum,row)=>sum+decimalToUnits(row.outstanding_delta),ZERO);
  if (outstandingUnits < ZERO || outstandingUnits > STANDARD_CPC_ADVANCE_LIMIT_UNITS)
    throw new Error("allowance_ledger_out_of_bounds");
  const capacityUnits = STANDARD_CPC_ADVANCE_LIMIT_UNITS-outstandingUnits;
  return {outstandingUnits,capacityUnits,outstandingDecimal:unitsToDecimal(outstandingUnits),
    capacityDecimal:unitsToDecimal(capacityUnits)};
}
async function withLockedCampaign<T>(db: Pick<Pool,"getConnection">, campaignId: number,
  work: (conn: PoolConnection)=>Promise<T>): Promise<T> {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    await lockStandardCampaign(conn,campaignId);
    const result=await work(conn);
    await conn.commit();
    return result;
  } catch(error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}
async function existingKey(conn: PoolConnection, idempotencyKey: string): Promise<Entry|null> {
  const [rows]=await conn.query<Entry[]>(`SELECT * FROM ${TABLE} WHERE idempotency_key=? FOR UPDATE`,[idempotencyKey]);
  return rows[0]||null;
}
async function advanceOutstandingLocked(conn:PoolConnection,campaignId:number,publisherId:number,advanceEntryId:number):Promise<bigint>{
  const [rows]=await conn.query<Entry[]>(`SELECT * FROM ${TABLE} WHERE campaign_id=? ORDER BY id FOR UPDATE`,[campaignId]);
  const advance=rows.find(row=>row.id===advanceEntryId && row.operation==="advance" && row.publisher_id===publisherId);
  if(!advance)throw new Error("invalid_allowance_advance_target");
  const recoveries=new Set(rows.filter(row=>row.operation==="recovery" && row.publisher_id===publisherId &&
    row.applies_to_advance_entry_id===advanceEntryId).map(row=>row.id));
  return rows.reduce((sum,row)=>{
    if(row.id===advanceEntryId || recoveries.has(row.id) ||
      (row.operation==="reversal" && (row.reverses_entry_id===advanceEntryId || recoveries.has(row.reverses_entry_id!))))
      return sum+decimalToUnits(row.outstanding_delta);
    return sum;
  },ZERO);
}
function sameEntry(row: Entry, input: BaseInput, operation: Operation, sourceSystem: SourceSystem,
  amountUnits: bigint, reversesEntryId: number|null, advanceEntryId:number|null) {
  return row.campaign_id===input.campaignId && row.publisher_id===input.publisherId && row.operation===operation &&
    row.source_system===sourceSystem && row.source_transaction_key===input.sourceTransactionKey &&
    decimalToUnits(row.amount)===amountUnits && row.reverses_entry_id===reversesEntryId &&
    row.applies_to_advance_entry_id===advanceEntryId;
}
async function write(conn: PoolConnection, input: BaseInput, operation: Operation, sourceSystem: SourceSystem,
  amountUnits: bigint, deltaUnits: bigint, reversesEntryId: number|null,
  advanceEntryId:number|null): Promise<AllowanceWriteResult> {
  const [result]=await conn.query<ResultSetHeader>(
    `INSERT INTO ${TABLE}(campaign_id,publisher_id,operation,amount,outstanding_delta,source_system,
      source_transaction_key,idempotency_key,reverses_entry_id,applies_to_advance_entry_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [input.campaignId,input.publisherId,operation,unitsToDecimal(amountUnits),unitsToDecimal(deltaUnits),sourceSystem,
      input.sourceTransactionKey,input.idempotencyKey,reversesEntryId,advanceEntryId]);
  return {...await balanceLocked(conn,input.campaignId),status:"recorded",entryId:result.insertId};
}
async function idempotent(conn: PoolConnection,input:BaseInput,operation:Operation,sourceSystem:SourceSystem,
  amountUnits:bigint,reversesEntryId:number|null,advanceEntryId:number|null):Promise<AllowanceWriteResult|null> {
  const row=await existingKey(conn,input.idempotencyKey);
  if (!row) return null;
  if (!sameEntry(row,input,operation,sourceSystem,amountUnits,reversesEntryId,advanceEntryId))
    throw new Error("allowance_idempotency_conflict");
  return {...await balanceLocked(conn,input.campaignId),status:"duplicate",entryId:row.id};
}
function enabled() {
  if (!isPhase1FinancialBackendEnabled()) throw new Error("phase1_allowance_disabled");
}

/** Each operation owns its complete transaction; no wallet, publisher or reserve tables are touched. */
export async function recordStandardCpcAdvance(db:Pick<Pool,"getConnection">,input:BaseInput):Promise<AllowanceWriteResult>{
  enabled();const amount=validate(input);
  return withLockedCampaign(db,input.campaignId,async conn=>{
    const duplicate=await idempotent(conn,input,"advance","standard_cpc_advance",amount,null,null);
    if(duplicate)return duplicate;
    const balance=await balanceLocked(conn,input.campaignId);
    if(amount>balance.capacityUnits)throw new Error("standard_cpc_allowance_exhausted");
    return write(conn,input,"advance","standard_cpc_advance",amount,amount,null,null);
  });
}
/** Caller owns commit/rollback; pair this advance with the publisher credit in one transaction. */
export async function recordStandardCpcAdvanceInTransaction(conn:PoolConnection,input:BaseInput):Promise<AllowanceWriteResult>{
  enabled();const amount=validate(input);
  await assertTransaction(conn);
  await lockStandardCampaign(conn,input.campaignId);
  const duplicate=await idempotent(conn,input,"advance","standard_cpc_advance",amount,null,null);
  if(duplicate)return duplicate;
  const balance=await balanceLocked(conn,input.campaignId);
  if(amount>balance.capacityUnits)throw new Error("standard_cpc_allowance_exhausted");
  return write(conn,input,"advance","standard_cpc_advance",amount,amount,null,null);
}
export async function readStandardCpcAllowanceBalanceInTransaction(conn:PoolConnection,campaignId:number):Promise<AllowanceBalance>{
  positiveId(campaignId,"campaign_id");await assertTransaction(conn);await lockStandardCampaign(conn,campaignId);
  return balanceLocked(conn,campaignId);
}
export async function recordStandardCpcRecovery(db:Pick<Pool,"getConnection">,
  input:BaseInput & {advanceEntryId:number}):Promise<AllowanceWriteResult>{
  enabled();const amount=validate(input);positiveId(input.advanceEntryId,"advance_entry_id");
  return withLockedCampaign(db,input.campaignId,conn=>recordRecoveryLocked(conn,input,amount));
}
async function recordRecoveryLocked(conn:PoolConnection,input:BaseInput & {advanceEntryId:number},amount:bigint){
    const duplicate=await idempotent(conn,input,"recovery","standard_cpc_arr",amount,null,input.advanceEntryId);
    if(duplicate)return duplicate;
    const balance=await balanceLocked(conn,input.campaignId);
    if(amount>balance.outstandingUnits)throw new Error("recovery_exceeds_outstanding_advance");
    if(amount>await advanceOutstandingLocked(conn,input.campaignId,input.publisherId,input.advanceEntryId))
      throw new Error("recovery_exceeds_target_advance");
    return write(conn,input,"recovery","standard_cpc_arr",amount,-amount,null,input.advanceEntryId);
}
async function assertTransaction(conn:PoolConnection){
  const [rows]=await conn.query<Array<RowDataPacket & {active:number}>>("SELECT @@in_transaction AS active");
  if(Number(rows[0]?.active)!==1)throw new Error("allowance_requires_active_transaction");
}
/** Caller owns commit/rollback; use inside the same transaction as CPC click settlement. */
export async function recordStandardCpcRecoveryInTransaction(conn:PoolConnection,
  input:BaseInput & {advanceEntryId:number}):Promise<AllowanceWriteResult>{
  enabled();const amount=validate(input);positiveId(input.advanceEntryId,"advance_entry_id");
  await assertTransaction(conn);
  await lockStandardCampaign(conn,input.campaignId);
  return recordRecoveryLocked(conn,input,amount);
}
/** Reads only this publisher's allowance advances, ordered for deterministic ARR allocation. */
export async function listStandardCpcOutstandingAdvancesInTransaction(conn:PoolConnection,
  campaignId:number,publisherId:number):Promise<Array<{entryId:number;outstandingUnits:bigint}>>{
  positiveId(campaignId,"campaign_id");positiveId(publisherId,"publisher_id");
  await assertTransaction(conn);
  await lockStandardCampaign(conn,campaignId);
  const [rows]=await conn.query<Entry[]>(`SELECT * FROM ${TABLE} WHERE campaign_id=? AND publisher_id=? ORDER BY id FOR UPDATE`,
    [campaignId,publisherId]);
  const recoveries=new Map<number,number>();
  for(const row of rows)if(row.operation==="recovery" && row.applies_to_advance_entry_id!==null)
    recoveries.set(row.id,row.applies_to_advance_entry_id);
  return rows.filter(row=>row.operation==="advance").map(advance=>{
    const outstandingUnits=rows.reduce((sum,row)=>{
      if(row.id===advance.id || (row.operation==="recovery" && row.applies_to_advance_entry_id===advance.id)
        || (row.operation==="reversal" && (row.reverses_entry_id===advance.id ||
          recoveries.get(row.reverses_entry_id!)===advance.id))) return sum+decimalToUnits(row.outstanding_delta);
      return sum;
    },ZERO);
    if(outstandingUnits<ZERO || outstandingUnits>decimalToUnits(advance.amount))
      throw new Error("allowance_advance_out_of_bounds");
    return {entryId:advance.id,outstandingUnits};
  }).filter(row=>row.outstandingUnits>ZERO);
}
export async function reverseStandardCpcAllowanceEntry(db:Pick<Pool,"getConnection">,
  input:BaseInput & {originalEntryId:number}):Promise<AllowanceWriteResult>{
  enabled();const amount=validate(input);positiveId(input.originalEntryId,"original_entry_id");
  return withLockedCampaign(db,input.campaignId,async conn=>{
    const duplicate=await idempotent(conn,input,"reversal","standard_cpc_reversal",amount,input.originalEntryId,null);
    if(duplicate)return duplicate;
    const [rows]=await conn.query<Entry[]>(`SELECT * FROM ${TABLE} WHERE id=? AND campaign_id=? FOR UPDATE`,
      [input.originalEntryId,input.campaignId]);
    const original=rows[0];
    if(!original || original.operation==="reversal" || original.publisher_id!==input.publisherId)
      throw new Error("invalid_allowance_reversal_target");
    const [reversals]=await conn.query<Array<RowDataPacket & {amount:string}>>(
      `SELECT amount FROM ${TABLE} WHERE campaign_id=? AND reverses_entry_id=? FOR UPDATE`,
      [input.campaignId,input.originalEntryId]);
    const reversed=reversals.reduce((sum,row)=>sum+decimalToUnits(row.amount),ZERO);
    if(reversed+amount>decimalToUnits(original.amount))throw new Error("allowance_reversal_exceeds_original");
    const balance=await balanceLocked(conn,input.campaignId);
    const delta=original.operation==="advance"?-amount:amount;
    if(original.operation==="advance" && amount>await advanceOutstandingLocked(conn,input.campaignId,input.publisherId,original.id))
      throw new Error("advance_reversal_exceeds_unrecovered_amount");
    if(balance.outstandingUnits+delta<ZERO)throw new Error("advance_reversal_exceeds_outstanding");
    if(balance.outstandingUnits+delta>STANDARD_CPC_ADVANCE_LIMIT_UNITS)
      throw new Error("recovery_reversal_exceeds_allowance_limit");
    return write(conn,input,"reversal","standard_cpc_reversal",amount,delta,input.originalEntryId,null);
  });
}
export async function readStandardCpcAllowanceBalance(db:Pick<Pool,"getConnection">,campaignId:number):Promise<AllowanceBalance>{
  positiveId(campaignId,"campaign_id");
  return withLockedCampaign(db,campaignId,conn=>balanceLocked(conn,campaignId));
}
