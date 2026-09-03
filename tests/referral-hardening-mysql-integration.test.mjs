import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";

const enabled = process.env.TEST_MYSQL_REFERRAL === "1";
const connection = () => mysql.createConnection({
  host: process.env.TEST_MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.TEST_MYSQL_PORT || 33307),
  user: process.env.TEST_MYSQL_USER || "root",
  password: process.env.TEST_MYSQL_PASSWORD || "",
  database: process.env.TEST_MYSQL_DATABASE || "refhard_clean",
});

test("concurrent budget reservations serialize and cannot exceed caps", { skip: !enabled }, async () => {
  const setup = await connection();
  await setup.query("DELETE FROM referral_budget_usage");
  await setup.query("INSERT INTO referral_budget_usage(scope_type,user_id,period_start,spent_amount) VALUES ('user_day',900001,CURDATE(),0),('user_month',900001,DATE_FORMAT(CURDATE(),'%Y-%m-01'),0),('platform_month',0,DATE_FORMAT(CURDATE(),'%Y-%m-01'),0)");
  await setup.end();

  async function reserve(requested) {
    const db = await connection();
    await db.beginTransaction();
    try {
      const [rows] = await db.query(`SELECT scope_type,spent_amount FROM referral_budget_usage
        WHERE (scope_type='user_day' AND user_id=900001 AND period_start=CURDATE())
           OR (scope_type='user_month' AND user_id=900001 AND period_start=DATE_FORMAT(CURDATE(),'%Y-%m-01'))
           OR (scope_type='platform_month' AND user_id=0 AND period_start=DATE_FORMAT(CURDATE(),'%Y-%m-01'))
        ORDER BY scope_type,user_id FOR UPDATE`);
      const values = new Map(rows.map((row) => [row.scope_type, Number(row.spent_amount)]));
      const amount = Math.max(0, Math.min(requested, .5-values.get("user_day"), 5-values.get("user_month"), 25-values.get("platform_month")));
      if (amount > 0) await db.query(`UPDATE referral_budget_usage SET spent_amount=spent_amount+?
        WHERE (scope_type='user_day' AND user_id=900001 AND period_start=CURDATE())
           OR (scope_type='user_month' AND user_id=900001 AND period_start=DATE_FORMAT(CURDATE(),'%Y-%m-01'))
           OR (scope_type='platform_month' AND user_id=0 AND period_start=DATE_FORMAT(CURDATE(),'%Y-%m-01'))`, [amount]);
      await db.commit();
      return amount;
    } finally { await db.end(); }
  }

  const amounts = await Promise.all([reserve(.4), reserve(.4), reserve(.4)]);
  assert.equal(amounts.reduce((a,b) => a+b, 0), .5);
  const verify = await connection();
  const [[row]] = await verify.query("SELECT spent_amount FROM referral_budget_usage WHERE scope_type='user_day' AND user_id=900001 AND period_start=CURDATE()");
  assert.equal(String(row.spent_amount), "0.50000000");
  await verify.end();
});

test("commission idempotency rejects a duplicate source", { skip: !enabled }, async () => {
  const db = await connection();
  await db.query("DELETE FROM referral_commission_ledger WHERE idempotency_key='integration:commission:1'");
  const values = ["integration:commission:1",1,2,"view",1,"1.00000000","0.05000000","0.05000000","{}"];
  const [first] = await db.query(`INSERT IGNORE INTO referral_commission_ledger
    (idempotency_key,referrer_user_id,referred_publisher_id,source_settlement_type,source_settlement_id,gross_publisher_amount,commission_rate,amount,eligibility_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?)`, values);
  const [second] = await db.query(`INSERT IGNORE INTO referral_commission_ledger
    (idempotency_key,referrer_user_id,referred_publisher_id,source_settlement_type,source_settlement_id,gross_publisher_amount,commission_rate,amount,eligibility_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?)`, values);
  assert.equal(first.affectedRows, 1);
  assert.equal(second.affectedRows, 0);
  await db.end();
});
