import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { channelUnitPriceSql } from "@/lib/channelBilling";

/** Trusted SQL expressions only; never pass request input as an expression. */
export function channelDailySpendSql(campaignId = "c.id", campaignKind = "c.campaign_kind") {
  return `(CASE WHEN ${campaignKind}='channel_growth' THEN
    COALESCE((SELECT SUM(g.advertiser_debit) FROM channel_growth_conversions g
      WHERE g.campaign_id=${campaignId} AND g.status='billed' AND g.fraud_status='clear'
        AND g.billed_at>=UTC_DATE() AND g.billed_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)),0)
    ELSE
    COALESCE((SELECT SUM(l.advertiser_debit) FROM channel_settlement_ledger l
      WHERE l.campaign_id=${campaignId} AND l.created_at>=UTC_DATE()
        AND l.created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)
        AND NOT EXISTS (SELECT 1 FROM channel_fraud_billing_adjustments a WHERE a.settlement_ledger_id=l.id)),0)
    + COALESCE((SELECT SUM(d.advertiser_debit) FROM channel_advertiser_debits d
      WHERE d.campaign_id=${campaignId} AND d.created_at>=UTC_DATE()
        AND d.created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)),0) END)`;
}

export async function getChannelDailySpend(conn: Pick<PoolConnection, "query">, campaignId: number) {
  const [[row]] = await conn.query<Array<RowDataPacket & { spend: string | number }>>(
    `SELECT ${channelDailySpendSql()} spend FROM campaigns c WHERE c.id=?`, [campaignId],
  );
  return Number(row?.spend || 0);
}

export function channelNextUnitSql(alias = "c") {
  return channelUnitPriceSql(alias);
}

export function canResumeChannelDailyCap(input: {
  status: string; unitPrice: number; budget: number; balance: number;
  requiresBalance: boolean; cap: number; spent: number;
}) {
  return input.status === "daily_cap_reached" && Number.isFinite(input.unitPrice) && input.unitPrice > 0
    && input.budget + 1e-10 >= input.unitPrice
    && (!input.requiresBalance || input.balance + 1e-10 >= input.unitPrice)
    && (input.cap <= 0 || input.spent + input.unitPrice <= input.cap + 1e-10);
}
