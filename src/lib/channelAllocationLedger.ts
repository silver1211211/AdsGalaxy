import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { CHANNEL_POLICY_VERSION, decimalToUnits, unitsToDecimal, type DecimalInput } from "@/lib/channelAllocationMath";
export { calculateCurrentCanonicalAllocation, decimalToUnits, unitsToDecimal } from "@/lib/channelAllocationMath";
export type ChannelAllocationInput = {
  sourceKey: string;
  sourceType: "view" | "click" | "reversal" | "adjustment";
  sourceRecordId?: number | null;
  campaignId?: number | null;
  postId?: number | null;
  channelId?: number | null;
  advertiserId?: number | null;
  publisherId?: number | null;
  billableUnits: number | bigint;
  unitPrice: DecimalInput;
  advertiserDebit: DecimalInput;
  publisherAllocation: DecimalInput;
  platformAllocation: DecimalInput;
  reserveAllocation: DecimalInput;
  qualityAdjustment: DecimalInput;
  currency?: string;
  policyVersion?: string;
  occurredAt: Date | string;
  settledAt?: Date | string | null;
  reversalOfEventId?: string | null;
  fraudStatus?: "clear" | "suspected" | "confirmed" | "reversed";
};

function canonicalPayload(input: ChannelAllocationInput) {
  const values = {
    source_key: input.sourceKey,
    source_type: input.sourceType,
    source_record_id: input.sourceRecordId ?? null,
    campaign_id: input.campaignId ?? null,
    post_id: input.postId ?? null,
    channel_id: input.channelId ?? null,
    advertiser_id: input.advertiserId ?? null,
    publisher_id: input.publisherId ?? null,
    billable_units: String(input.billableUnits),
    unit_price: unitsToDecimal(decimalToUnits(input.unitPrice)),
    advertiser_debit: unitsToDecimal(decimalToUnits(input.advertiserDebit)),
    publisher_allocation: unitsToDecimal(decimalToUnits(input.publisherAllocation)),
    platform_allocation: unitsToDecimal(decimalToUnits(input.platformAllocation)),
    reserve_allocation: unitsToDecimal(decimalToUnits(input.reserveAllocation)),
    quality_adjustment: unitsToDecimal(decimalToUnits(input.qualityAdjustment)),
    currency: input.currency ?? "USD",
    policy_version: input.policyVersion ?? CHANNEL_POLICY_VERSION,
    occurred_at: new Date(input.occurredAt).toISOString(),
    settled_at: input.settledAt ? new Date(input.settledAt).toISOString() : null,
    reversal_of_event_id: input.reversalOfEventId ?? null,
    fraud_status: input.fraudStatus ?? "clear",
  };
  const invariant = decimalToUnits(values.publisher_allocation) + decimalToUnits(values.platform_allocation)
    + decimalToUnits(values.reserve_allocation) + decimalToUnits(values.quality_adjustment);
  if (invariant !== decimalToUnits(values.advertiser_debit)) throw new Error("channel_allocation_invariant_failed");
  return values;
}

export function hashChannelAllocation(input: ChannelAllocationInput) {
  return createHash("sha256").update(JSON.stringify(canonicalPayload(input))).digest("hex");
}

export function isChannelAllocationShadowWriteEnabled() {
  return process.env.CHANNEL_ALLOCATION_LEDGER_SHADOW_WRITE_ENABLED === "true";
}

export async function shadowWriteChannelAllocation(conn: PoolConnection, input: ChannelAllocationInput) {
  if (!isChannelAllocationShadowWriteEnabled()) return { status: "disabled" as const };
  try {
    const payload = canonicalPayload(input);
    const hash = hashChannelAllocation(input);
    const [insert] = await conn.query<ResultSetHeader>(
      `INSERT IGNORE INTO channel_allocation_ledger
       (event_id,source_key,source_type,source_record_id,campaign_id,post_id,channel_id,advertiser_id,publisher_id,
        billable_units,unit_price,advertiser_debit,publisher_allocation,platform_allocation,reserve_allocation,
        quality_adjustment,currency,policy_version,occurred_at,settled_at,reversal_of_event_id,fraud_status,payload_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), payload.source_key, payload.source_type, payload.source_record_id, payload.campaign_id,
        payload.post_id, payload.channel_id, payload.advertiser_id, payload.publisher_id, payload.billable_units,
        payload.unit_price, payload.advertiser_debit, payload.publisher_allocation, payload.platform_allocation,
        payload.reserve_allocation, payload.quality_adjustment, payload.currency, payload.policy_version,
        payload.occurred_at, payload.settled_at, payload.reversal_of_event_id, payload.fraud_status, hash]
    );
    if (insert.affectedRows !== 1) {
      const [existing] = await conn.query<Array<RowDataPacket & { payload_hash: string }>>(
        "SELECT payload_hash FROM channel_allocation_ledger WHERE source_key=?",
        [payload.source_key]
      );
      if (existing[0]?.payload_hash !== hash) throw new Error("canonical_source_key_payload_conflict");
      return { status: "duplicate" as const, payloadHash: hash };
    }
    return { status: "written" as const, payloadHash: hash };
  } catch (error) {
    console.error("Canonical channel allocation shadow write failed", {
      source_key: input.sourceKey,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { status: "failed" as const };
  }
}

export async function queryCanonicalChannelTotals(filters: { campaignId?: number; channelId?: number; publisherId?: number } = {}) {
  const clauses = ["1=1"];
  const params: number[] = [];
  for (const [column, value] of [["campaign_id", filters.campaignId], ["channel_id", filters.channelId], ["publisher_id", filters.publisherId]] as const) {
    if (value !== undefined) { clauses.push(`${column}=?`); params.push(value); }
  }
  const [rows] = await pool.query<Array<RowDataPacket & Record<string, string>>>(
    `SELECT COALESCE(SUM(advertiser_debit),0) advertiser_spend,
      COALESCE(SUM(publisher_allocation),0) publisher_allocation,
      COALESCE(SUM(platform_allocation),0) platform_allocation,
      COALESCE(SUM(reserve_allocation),0) reserve_allocation,
      COALESCE(SUM(quality_adjustment),0) quality_holdback,
      COALESCE(SUM(CASE WHEN source_type='reversal' THEN advertiser_debit ELSE 0 END),0) reversals
     FROM channel_allocation_ledger WHERE ${clauses.join(" AND ")}`,
    params
  );
  return rows[0];
}
