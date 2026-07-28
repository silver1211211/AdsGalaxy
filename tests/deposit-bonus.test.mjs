import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { calculateDepositBonus, depositBonusRateBasisPoints } from "../src/lib/depositBonus.ts";

const route = readFileSync("src/app/api/advertiser/deposits/[track_id]/route.ts", "utf8");
const listRoute = readFileSync("src/app/api/advertiser/deposits/route.ts", "utf8");
const service = readFileSync("src/lib/depositBonus.ts", "utf8");
const migration = readFileSync("db/migrations/20260728_0106_deposit_bonus_promotion.sql", "utf8");
const page = readFileSync("src/app/advertiser/deposit/page.tsx", "utf8");
const deploy = readFileSync("deploy-vps.sh", "utf8");

test("deposit bonus tier boundaries use exact decimal units", () => {
  const cases = [
    ["99.99", 0], ["100.00", 500], ["299.99", 500], ["300.00", 750],
    ["719.99", 750], ["720.00", 1000], ["2200.99", 1000], ["2201.00", 1200],
  ];
  for (const [amount, expected] of cases) assert.equal(depositBonusRateBasisPoints(amount), expected);
  assert.equal(calculateDepositBonus("300.00").bonusAmount, "22.50000000");
  assert.equal(calculateDepositBonus("2201.00").bonusAmount, "264.12000000");
  assert.equal(calculateDepositBonus("999999999.99999999").bonusAmount, "120000000.00000000");
});

test("promotion migration preserves its original two-calendar-month window", () => {
  assert.match(migration, /INSERT IGNORE INTO deposit_promotions/);
  assert.match(migration, /UTC_TIMESTAMP\(\)/);
  assert.match(migration, /DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL 2 MONTH\)/);
  assert.match(migration, /UNIQUE KEY uniq_deposit_bonus_deposit \(deposit_id\)/);
  assert.ok(deploy.indexOf("0105_add_advertiser_transaction_description") < deploy.indexOf("0106_deposit_bonus_promotion"));
});

test("confirmation locks the deposit and ignores browser bonus values", () => {
  assert.match(service, /WHERE id = \? AND user_id = \? FOR UPDATE/);
  assert.match(service, /awardDepositBonus\(conn/);
  assert.doesNotMatch(route, /browser.*bonus|body\.bonus|bonus.*request\.json/i);
  assert.doesNotMatch(route, /ALTER TABLE|CREATE TABLE/);
  assert.doesNotMatch(listRoute, /ALTER TABLE|CREATE TABLE/);
  assert.match(route, /MAX_PROVIDER_RESPONSE_BYTES/);
  assert.match(listRoute, /MAX_PROVIDER_RESPONSE_BYTES/);
});

test("history, receipt, countdown and earned badge use server bonus data", () => {
  assert.match(page, /Deposit Bonus Live/);
  assert.match(page, /View bonus tiers/);
  assert.match(page, /Total credited/);
  assert.match(page, /bonus_rate_basis_points/);
  assert.match(page, /promotion\.ends_at/);
});
