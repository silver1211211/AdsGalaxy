import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export type ChannelFraudBillingState = "clean" | "low_quality" | "suspicious" | "confirmed_fraud" | "critical_fraud";

export function fraudBillingStateForSeverity(severity: unknown): ChannelFraudBillingState {
  if (severity === "critical") return "critical_fraud";
  if (severity === "high") return "suspicious";
  if (severity === "medium") return "low_quality";
  return "clean";
}

type FraudPost = RowDataPacket & {
  fraud_event_id: number; billing_state: "confirmed_fraud" | "critical_fraud"; reason: string;
  post_id: number; campaign_id: number; channel_id: number; publisher_id: number; advertiser_id: number;
  campaign_type: string; views: number; clicks: number; settled_views: number; settled_clicks: number;
  fraud_excluded_views: number; fraud_excluded_clicks: number;
};

type LedgerRow = RowDataPacket & {
  id: number; settlement_type: "view" | "click"; new_units: number; advertiser_debit: number;
  publisher_credit: number; platform_revenue: number; reserve_amount: number;
};

function money(value: unknown) { return Number(Math.max(0, Number(value) || 0).toFixed(8)); }

async function reverseSettlement(connection: PoolConnection, post: FraudPost, ledger: LedgerRow) {
  const [[balances]] = await connection.query<Array<RowDataPacket & { balance_locked: number; balance_available: number }>>(
    "SELECT balance_locked, balance_available FROM users WHERE id = ? FOR UPDATE", [post.publisher_id]
  );
  const publisherCredit = money(ledger.publisher_credit);
  const lockedRecovery = Math.min(publisherCredit, money(balances?.balance_locked));
  const availableRecovery = Math.min(publisherCredit - lockedRecovery, money(balances?.balance_available));
  const recovered = money(lockedRecovery + availableRecovery);
  const shortfall = money(publisherCredit - recovered);
  const advertiserCredit = money(ledger.advertiser_debit);

  const [insert] = await connection.query(
    `INSERT IGNORE INTO channel_fraud_billing_adjustments
      (settlement_ledger_id,fraud_event_id,settlement_type,campaign_id,post_id,channel_id,publisher_id,advertiser_id,
       fraud_billing_state,fraudulent_units,advertiser_credit,publisher_credit_reversed,publisher_balance_recovered,
       platform_revenue_reversed,reserve_amount_reversed,reserve_shortfall,reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ledger.id, post.fraud_event_id, ledger.settlement_type, post.campaign_id, post.post_id, post.channel_id,
      post.publisher_id, post.advertiser_id, post.billing_state, ledger.new_units, advertiserCredit, publisherCredit,
      recovered, money(ledger.platform_revenue), money(ledger.reserve_amount), shortfall, post.reason]
  );
  if (!("affectedRows" in insert) || insert.affectedRows !== 1) return false;

  await connection.query(
    "UPDATE users SET ad_balance = ad_balance + ? WHERE id = ?",
    [advertiserCredit, post.advertiser_id]
  );
  await connection.query(
    "UPDATE users SET balance_locked = GREATEST(0,balance_locked-?), balance_available = GREATEST(0,balance_available-?) WHERE id = ?",
    [lockedRecovery, availableRecovery, post.publisher_id]
  );
  await connection.query(
    `UPDATE campaigns SET channel_spend=GREATEST(0,channel_spend-?),
       channel_publisher_earnings=GREATEST(0,channel_publisher_earnings-?),
       channel_platform_revenue=GREATEST(0,channel_platform_revenue-?),
       channel_reserve_amount=GREATEST(0,channel_reserve_amount-?) WHERE id=?`,
    [advertiserCredit, publisherCredit, money(ledger.platform_revenue), money(ledger.reserve_amount), post.campaign_id]
  );
  await connection.query(
    `UPDATE campaign_posts SET spend=GREATEST(0,spend-?), publisher_earnings=GREATEST(0,publisher_earnings-?),
       platform_revenue=GREATEST(0,platform_revenue-?), reserve_amount=GREATEST(0,reserve_amount-?) WHERE id=?`,
    [advertiserCredit, publisherCredit, money(ledger.platform_revenue), money(ledger.reserve_amount), post.post_id]
  );
  await connection.query(
    "INSERT INTO advertiser_transactions (user_id,amount,type,description) VALUES (?,?,'credit',?)",
    [post.advertiser_id, advertiserCredit, `Channel fraud adjustment: campaign ${post.campaign_id}, post ${post.post_id}, ${ledger.new_units} ${ledger.settlement_type} units`]
  );
  console.warn("Channel fraud advertiser adjustment", {
    campaign_id: post.campaign_id, channel_id: post.channel_id, publisher_id: post.publisher_id,
    fraudulent_units: ledger.new_units, advertiser_credit: advertiserCredit, reason: post.reason,
    fraud_event_id: post.fraud_event_id,
  });
  return true;
}

export async function applyChannelFraudBillingPolicy() {
  const [posts] = await pool.query<FraudPost[]>(
    `SELECT MAX(fe.id) fraud_event_id,
       CASE WHEN MAX(fe.billing_state='critical_fraud')=1 THEN 'critical_fraud' ELSE 'confirmed_fraud' END billing_state,
       MAX(fe.reason) reason, cp.id post_id, cp.campaign_id, cp.channel_id, ch.user_id publisher_id,
       c.user_id advertiser_id, c.type campaign_type, COALESCE(cp.views,0) views,
       (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id=cp.id) clicks,
       COALESCE(cp.settled_views,0) settled_views, COALESCE(cp.settled_clicks,0) settled_clicks,
       COALESCE(cp.fraud_excluded_views,0) fraud_excluded_views,
       COALESCE(cp.fraud_excluded_clicks,0) fraud_excluded_clicks
     FROM channel_fraud_events fe
     JOIN campaign_posts cp ON cp.id=fe.post_id
     JOIN campaigns c ON c.id=cp.campaign_id
     JOIN channels ch ON ch.id=cp.channel_id
     WHERE fe.billing_state IN ('confirmed_fraud','critical_fraud') AND fe.false_positive_at IS NULL
     GROUP BY cp.id,cp.campaign_id,cp.channel_id,ch.user_id,c.user_id,c.type,cp.views,cp.settled_views,cp.settled_clicks,
       cp.fraud_excluded_views,cp.fraud_excluded_clicks`
  );
  let adjustedSettlements = 0;
  let advertiserCredits = 0;
  let excludedUnits = 0;

  for (const post of posts) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [ledgers] = await connection.query<LedgerRow[]>(
        `SELECT l.id,l.settlement_type,l.new_units,l.advertiser_debit,l.publisher_credit,l.platform_revenue,l.reserve_amount
         FROM channel_settlement_ledger l
         LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
         WHERE l.post_id=? AND a.id IS NULL FOR UPDATE`, [post.post_id]
      );
      for (const ledger of ledgers) {
        if (await reverseSettlement(connection, post, ledger)) {
          adjustedSettlements += 1;
          advertiserCredits = money(advertiserCredits + money(ledger.advertiser_debit));
        }
      }
      const isClick = post.campaign_type === "clicks";
      const settlementTable = isClick ? "ad_settlements" : "ad_settlements_views";
      await connection.query(`UPDATE ${settlementTable} SET fraud_adjusted_at=COALESCE(fraud_adjusted_at,NOW()) WHERE post_id=?`, [post.post_id]);
      const observed = Number(isClick ? post.clicks : post.views);
      const previousExcluded = Number(isClick ? post.fraud_excluded_clicks : post.fraud_excluded_views);
      excludedUnits += Math.max(0, observed - previousExcluded);
      const settledColumn = isClick ? "settled_clicks" : "settled_views";
      const excludedColumn = isClick ? "fraud_excluded_clicks" : "fraud_excluded_views";
      await connection.query(`UPDATE campaign_posts SET ${settledColumn}=GREATEST(${settledColumn},?), ${excludedColumn}=GREATEST(${excludedColumn},?) WHERE id=?`, [observed, observed, post.post_id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      console.error("Channel fraud billing adjustment failed", { post_id: post.post_id, error: error instanceof Error ? error.message : "unknown_error" });
    } finally { connection.release(); }
  }
  return { fraudPosts: posts.length, excludedUnits, adjustedSettlements, advertiserCredits };
}
