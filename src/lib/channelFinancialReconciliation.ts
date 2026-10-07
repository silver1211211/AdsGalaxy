import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type ReconciliationRow = RowDataPacket & {
  internal_id: number;
  public_id: string | number;
  campaign_kind: string | null;
  funding_model: string;
  channel_spend: string | number;
  channel_publisher_earnings: string | number;
  channel_platform_revenue: string | number;
  channel_reserve_amount: string | number;
  ledger_advertiser_debit: string | number;
  ledger_publisher_credit: string | number;
  ledger_platform_revenue: string | number;
  ledger_reserve_amount: string | number;
  direct_debit_claims: string | number;
  pending_publisher_credits: string | number;
  growth_seed_credits: string | number;
};

const number = (value: unknown) => Number(value || 0);
const delta = (left: unknown, right: unknown) => Number((number(left) - number(right)).toFixed(8));

/** Read-only proof helper. It never updates or reconciles production balances. */
export async function inspectChannelCampaignFinancialIntegrity(campaignId: number) {
  const [[row]] = await pool.query<ReconciliationRow[]>(`
    SELECT c.id internal_id,COALESCE(c.public_id,c.id) public_id,c.campaign_kind,c.funding_model,
      c.channel_spend,c.channel_publisher_earnings,c.channel_platform_revenue,c.channel_reserve_amount,
      (COALESCE((SELECT SUM(l.advertiser_debit) FROM channel_settlement_ledger l
        LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
        WHERE l.campaign_id=c.id AND a.id IS NULL),0)
       +COALESCE((SELECT SUM(d.advertiser_debit) FROM channel_advertiser_debits d
        WHERE d.campaign_id=c.id),0)) ledger_advertiser_debit,
      (COALESCE((SELECT SUM(l.publisher_credit) FROM channel_settlement_ledger l
        LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
        WHERE l.campaign_id=c.id AND a.id IS NULL),0)
       +COALESCE((SELECT SUM(d.publisher_credit) FROM channel_advertiser_debits d
        WHERE d.campaign_id=c.id AND d.publisher_status='settled'),0)) ledger_publisher_credit,
      (COALESCE((SELECT SUM(l.platform_revenue) FROM channel_settlement_ledger l
        LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
        WHERE l.campaign_id=c.id AND a.id IS NULL),0)
       +COALESCE((SELECT SUM(GREATEST(d.advertiser_debit-d.publisher_credit,0)) FROM channel_advertiser_debits d
        WHERE d.campaign_id=c.id AND d.publisher_status='settled'),0)) ledger_platform_revenue,
      COALESCE((SELECT SUM(l.reserve_amount) FROM channel_settlement_ledger l
        LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
        WHERE l.campaign_id=c.id AND a.id IS NULL),0) ledger_reserve_amount,
      COALESCE((SELECT SUM(d.amount) FROM advertiser_direct_debits d
        WHERE d.campaign_id=c.id AND d.campaign_table='campaigns' AND d.status='settled'),0) direct_debit_claims,
      COALESCE((SELECT COUNT(*) FROM channel_advertiser_debits d
        WHERE d.campaign_id=c.id AND d.publisher_status='pending'),0) pending_publisher_credits,
      COALESCE((SELECT SUM(s.publisher_credit) FROM channel_growth_seed_ledger s
        WHERE s.campaign_id=c.id AND s.status='settled'),0) growth_seed_credits
    FROM campaigns c WHERE c.id=? LIMIT 1`, [campaignId]);
  if (!row) return null;

  const growthCredits = number(row.growth_seed_credits);
  const expectedPublisher = number(row.ledger_publisher_credit) + growthCredits;
  const differences = {
    campaign_spend_minus_ledger: delta(row.channel_spend, row.ledger_advertiser_debit),
    campaign_publisher_minus_ledger: delta(row.channel_publisher_earnings, expectedPublisher),
    direct_debit_minus_ledger: row.funding_model === "direct_debit"
      ? delta(row.direct_debit_claims, row.ledger_advertiser_debit)
      : 0,
  };
  return {
    ...row,
    expected_publisher_total: expectedPublisher,
    differences,
    balanced: Object.values(differences).every((value) => Math.abs(value) <= 0.00000001)
      && number(row.pending_publisher_credits) === 0,
  };
}
