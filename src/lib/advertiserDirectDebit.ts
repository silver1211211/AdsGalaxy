import "server-only";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

export type DirectDebitResult =
  | { ok: true; duplicate: false }
  | { ok: false; duplicate: true }
  | { ok: false; duplicate: false; reason: "INSUFFICIENT_AD_BALANCE" };

export async function claimAdvertiserDirectDebit(
  conn: PoolConnection,
  input: {
    sourceKey: string;
    advertiserId: number;
    campaignId: number;
    campaignTable: "campaigns" | "miniapp_rewarded_campaigns";
    billingType: "channel_view" | "channel_click" | "bot_delivery" | "miniapp_impression" | "miniapp_external" | "channel_growth" | "teaser_impression";
    amount: string | number;
    description: string;
  },
): Promise<DirectDebitResult> {
  const amount = String(input.amount);
  const [claim] = await conn.query<ResultSetHeader>(
    `INSERT IGNORE INTO advertiser_direct_debits
      (source_key,advertiser_id,campaign_id,campaign_table,billing_type,amount,status)
     VALUES (?,?,?,?,?,?,'claimed')`,
    [input.sourceKey, input.advertiserId, input.campaignId, input.campaignTable, input.billingType, amount],
  );
  if (claim.affectedRows !== 1) return { ok: false, duplicate: true };

  const [wallet] = await conn.query<ResultSetHeader>(
    "UPDATE users SET ad_balance=ad_balance-? WHERE id=? AND ad_balance>=?",
    [amount, input.advertiserId, amount],
  );
  if (wallet.affectedRows !== 1) {
    await conn.query("DELETE FROM advertiser_direct_debits WHERE source_key=? AND status='claimed'", [input.sourceKey]);
    return { ok: false, duplicate: false, reason: "INSUFFICIENT_AD_BALANCE" };
  }
  await conn.query(
    "INSERT INTO advertiser_transactions (user_id,amount,type,description) VALUES (?,?,'debit',?)",
    [input.advertiserId, amount, input.description],
  );
  await conn.query(
    "UPDATE advertiser_direct_debits SET status='settled',settled_at=NOW() WHERE source_key=?",
    [input.sourceKey],
  );
  return { ok: true, duplicate: false };
}
