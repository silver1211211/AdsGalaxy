import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import "./reward-callback-production-loader.mjs";

const rawUrl = process.env.ADSGALAXY_DEPOSIT_BONUS_TEST_DATABASE_URL;
if (!rawUrl) throw new Error("ADSGALAXY_DEPOSIT_BONUS_TEST_DATABASE_URL is required");
const parsed = new URL(rawUrl);
assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname));
assert.equal(parsed.pathname.slice(1), "adsgalaxy_deposit_bonus_test");
assert.match(parsed.pathname, /adsgalaxy.*test/i);

const prefix = `codex_bonus_${randomUUID().replaceAll("-", "")}`;
const pool = mysql.createPool({ uri: parsed.href, connectionLimit: 10 });
let bonusService;
let promotion;
const userIds = [];
const depositIds = [];

async function createFixture(amount, status = "waiting", balance = 0) {
  const [user] = await pool.query(
    "INSERT INTO users (telegram_id,username,ad_balance,balance_available) VALUES (?,?,?,0)",
    [`96${Date.now()}${userIds.length}`, `${prefix}_${userIds.length}`, balance],
  );
  userIds.push(user.insertId);
  const [deposit] = await pool.query(
    `INSERT INTO deposits (user_id,track_id,order_id,amount,status)
     VALUES (?,?,?,?,?)`,
    [user.insertId, `${prefix}_track_${depositIds.length}`, `${prefix}_order_${depositIds.length}`, amount, status],
  );
  depositIds.push(deposit.insertId);
  return { userId: user.insertId, depositId: deposit.insertId };
}

async function confirm(fixture, amount, confirmedAt = new Date()) {
  return bonusService.confirmDepositCredit(pool, {
    ...fixture,
    confirmedAmount: amount,
    providerTransaction: `${prefix}_transaction`,
    confirmedAt,
  });
}

before(async () => {
  bonusService = await import("../src/lib/depositBonus.ts");
  const [rows] = await pool.query(
    "SELECT id,starts_at,ends_at,is_active FROM deposit_promotions WHERE slug=?",
    [bonusService.DEPOSIT_BONUS_PROMOTION_SLUG],
  );
  promotion = rows[0];
  assert.ok(promotion);
  await pool.query(
    "UPDATE deposit_promotions SET starts_at=UTC_TIMESTAMP()-INTERVAL 1 DAY,ends_at=UTC_TIMESTAMP()+INTERVAL 1 DAY,is_active=TRUE WHERE id=?",
    [promotion.id],
  );
});

after(async () => {
  if (depositIds.length) {
    await pool.query("DELETE FROM deposit_bonuses WHERE deposit_id IN (?)", [depositIds]);
    await pool.query("DELETE FROM deposits WHERE id IN (?)", [depositIds]);
  }
  if (userIds.length) {
    await pool.query("DELETE FROM advertiser_transactions WHERE user_id IN (?)", [userIds]);
    await pool.query("DELETE FROM users WHERE id IN (?)", [userIds]);
  }
  await pool.query(
    "UPDATE deposit_promotions SET starts_at=?,ends_at=?,is_active=? WHERE id=?",
    [promotion.starts_at, promotion.ends_at, promotion.is_active, promotion.id],
  );
  const [[counts]] = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE username LIKE ?) users,
      (SELECT COUNT(*) FROM deposits WHERE track_id LIKE ?) deposits`,
    [`${prefix}%`, `${prefix}%`],
  );
  assert.deepEqual(counts, { users: 0, deposits: 0 });
  const [[triggers]] = await pool.query(
    "SELECT COUNT(*) count FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name LIKE ?",
    [`${prefix}%`],
  );
  assert.equal(triggers.count, 0);
  await pool.end();
});

for (const [amount, rate, expected] of [
  ["99.99", 0, "0.00000000"],
  ["100.00", 500, "5.00000000"],
  ["299.99", 500, "15.00000000"],
  ["300.00", 750, "22.50000000"],
  ["719.99", 750, "54.00000000"],
  ["720.00", 1000, "72.00000000"],
  ["2200.99", 1000, "220.10000000"],
  ["2201.00", 1200, "264.12000000"],
  ["9999999.99", 1200, "1200000.00000000"],
]) {
  test(`${amount} credits the exact production bonus`, async () => {
    const fixture = await createFixture(amount);
    const result = await confirm(fixture, amount);
    assert.equal(result.rateBasisPoints, rate);
    assert.equal(result.bonusAmount, expected);
    const [[user]] = await pool.query("SELECT ad_balance,balance_available FROM users WHERE id=?", [fixture.userId]);
    assert.equal(Number(user.balance_available), 0);
    assert.equal(Number(user.ad_balance).toFixed(2), (Number(amount) + Number(expected)).toFixed(2));
  });
}

test("pending, cancelled and expired deposits award only after valid confirmation", async () => {
  for (const status of ["canceled", "expired", "failed"]) {
    const fixture = await createFixture("100.00", status);
    const result = await confirm(fixture, "100.00");
    assert.equal(result.credited, false);
    const [[user]] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [fixture.userId]);
    assert.equal(Number(user.ad_balance), 0);
  }
});

test("promotion start is inclusive and end is exclusive", async () => {
  const now = new Date();
  now.setMilliseconds(0);
  const end = new Date(now.getTime() + 60_000);
  try {
    await pool.query("UPDATE deposit_promotions SET starts_at=?,ends_at=? WHERE id=?", [now, end, promotion.id]);
    const atStart = await createFixture("100.00");
    assert.equal((await confirm(atStart, "100.00", now)).rateBasisPoints, 500);
    const atEnd = await createFixture("100.00");
    assert.equal((await confirm(atEnd, "100.00", end)).rateBasisPoints, 0);
    const before = await createFixture("100.00");
    assert.equal((await confirm(before, "100.00", new Date(now.getTime() - 1))).rateBasisPoints, 0);
  } finally {
    await pool.query(
      "UPDATE deposit_promotions SET starts_at=UTC_TIMESTAMP()-INTERVAL 1 DAY,ends_at=UTC_TIMESTAMP()+INTERVAL 1 DAY WHERE id=?",
      [promotion.id],
    );
  }
});

test("duplicate and simultaneous confirmations credit principal and bonus once", async () => {
  const fixture = await createFixture("300.00");
  const results = await Promise.all([confirm(fixture, "300.00"), confirm(fixture, "300.00")]);
  assert.equal(results.filter((result) => result.credited).length, 1);
  assert.equal(results.filter((result) => result.idempotent).length, 1);
  const [[user]] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [fixture.userId]);
  assert.equal(Number(user.ad_balance), 322.5);
  const [[ledger]] = await pool.query(
    "SELECT SUM(type='credit') principal,SUM(type='deposit_bonus') bonus FROM advertiser_transactions WHERE user_id=?",
    [fixture.userId],
  );
  assert.equal(Number(ledger.principal), 1);
  assert.equal(Number(ledger.bonus), 1);
});

test("reversal is idempotent, audited, and never makes Ad Balance negative", async () => {
  const fixture = await createFixture("100.00");
  await confirm(fixture, "100.00");
  await pool.query("UPDATE users SET ad_balance=2 WHERE id=?", [fixture.userId]);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const first = await bonusService.reverseDepositBonus(conn, fixture.depositId);
    await conn.commit();
    assert.equal(first.reversedAmount, "2.00000000");
    await conn.beginTransaction();
    const second = await bonusService.reverseDepositBonus(conn, fixture.depositId);
    await conn.commit();
    assert.equal(second.idempotent, true);
  } finally {
    conn.release();
  }
  const [[user]] = await pool.query("SELECT ad_balance,balance_available FROM users WHERE id=?", [fixture.userId]);
  assert.equal(Number(user.ad_balance), 0);
  assert.equal(Number(user.balance_available), 0);
  const [[record]] = await pool.query("SELECT status,reversed_amount,reversed_at FROM deposit_bonuses WHERE deposit_id=?", [fixture.depositId]);
  assert.equal(record.status, "reversed");
  assert.equal(Number(record.reversed_amount), 2);
  assert.ok(record.reversed_at);
});

test("promotion row retains one immutable activation window on migration-style rerun", async () => {
  const [[before]] = await pool.query("SELECT starts_at,ends_at FROM deposit_promotions WHERE id=?", [promotion.id]);
  await pool.query(
    `INSERT IGNORE INTO deposit_promotions (slug,name,starts_at,ends_at,is_active)
     VALUES (?, 'rerun', UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 MONTH),TRUE)`,
    [bonusService.DEPOSIT_BONUS_PROMOTION_SLUG],
  );
  const [[afterRow]] = await pool.query("SELECT starts_at,ends_at FROM deposit_promotions WHERE id=?", [promotion.id]);
  assert.equal(String(afterRow.starts_at), String(before.starts_at));
  assert.equal(String(afterRow.ends_at), String(before.ends_at));
});
