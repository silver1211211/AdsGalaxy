import "dotenv/config";
import mysql from "mysql2/promise";

const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
try {
  const [[fast]] = await db.query(`SELECT COUNT(*) partial_rows_reconstructable,
    0 complete_rows_reconstructable,
    COUNT(*) rows_ambiguous,
    SUM(publisher_status='pending') pending_publisher_rows,
    COALESCE(SUM(advertiser_debit),0) advertiser_debit,
    COALESCE(SUM(publisher_credit),0) publisher_allocation
    FROM channel_advertiser_debits`);
  const [[classic]] = await db.query(`SELECT COUNT(*) rows_reconstructable,
    COALESCE(SUM(advertiser_debit),0) advertiser_debit,
    COALESCE(SUM(publisher_credit),0) publisher_allocation,
    COALESCE(SUM(platform_revenue),0) platform_allocation,
    COALESCE(SUM(reserve_amount-quality_holdback),0) reserve_allocation,
    COALESCE(SUM(quality_holdback),0) quality_holdback
    FROM channel_settlement_ledger`);
  const [[missing]] = await db.query(`SELECT
    SUM(c.id IS NULL OR cp.id IS NULL OR ch.id IS NULL OR p.id IS NULL) missing_relationships
    FROM channel_advertiser_debits d
    LEFT JOIN campaigns c ON c.id=d.campaign_id LEFT JOIN campaign_posts cp ON cp.id=d.post_id
    LEFT JOIN channels ch ON ch.id=d.channel_id LEFT JOIN users p ON p.id=d.publisher_id`);
  const [[duplicates]] = await db.query(`SELECT COUNT(*) duplicate_source_keys FROM
    (SELECT source_key FROM channel_advertiser_debits GROUP BY source_key HAVING COUNT(*)>1) d`);
  const [[cache]] = await db.query(`SELECT COUNT(*) cache_differences FROM campaign_posts cp
    LEFT JOIN (SELECT post_id,SUM(advertiser_debit) spend,SUM(publisher_credit) publisher
      FROM channel_advertiser_debits GROUP BY post_id) d ON d.post_id=cp.id
    LEFT JOIN (SELECT post_id,SUM(advertiser_debit) spend,SUM(publisher_credit) publisher
      FROM channel_settlement_ledger GROUP BY post_id) l ON l.post_id=cp.id
    WHERE ABS(cp.spend-COALESCE(d.spend,0)-COALESCE(l.spend,0))>0.00000001
       OR ABS(cp.publisher_earnings-COALESCE(d.publisher,0)-COALESCE(l.publisher,0))>0.00000001`);
  const [[balances]] = await db.query(`SELECT COUNT(*) negative_balance_rows FROM users u WHERE u.balance_locked<0 OR u.balance_available<0`);
  console.log(JSON.stringify({
    mode: "read-only-dry-run", writes_performed: 0, fast, classic, missing, duplicates, cache, balances,
    notes: {
      fast_ambiguity: "Historical fast rows do not persist policy, nominal reserve, or quality holdback; publisher credit is reconstructable only after settlement.",
      balance_scope: "User balances include non-channel systems; this tool reports negative rows but does not propose automatic balance correction.",
    },
  }, null, 2));
} finally { await db.end(); }
