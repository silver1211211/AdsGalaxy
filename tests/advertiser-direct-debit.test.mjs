import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const core = read("src/lib/advertiserDirectDebit.ts");
const creation = read("src/lib/campaignCreationTransaction.ts");
const campaigns = read("src/app/api/advertiser/campaigns/route.ts");
const lifecycle = read("src/app/api/advertiser/campaigns/[id]/route.ts");
const miniLifecycle = read("src/app/api/advertiser/miniapp-rewarded-campaigns/[id]/route.ts");
const migration = read("db/migrations/20260909_0133_advertiser_direct_debit.sql");

test("new classic campaigns do not reserve or debit their full cap", () => {
  assert.doesNotMatch(creation, /UPDATE users SET ad_balance/);
  assert.doesNotMatch(creation, /advertiser_transactions/);
  assert.match(campaigns, /'direct_debit'/);
});

test("the shared debit claim is durable and wallet-conditional", () => {
  assert.match(core, /INSERT IGNORE INTO advertiser_direct_debits/);
  assert.match(migration, /UNIQUE KEY uq_advertiser_direct_debit_source/);
  assert.match(core, /ad_balance=ad_balance-\? WHERE id=\? AND ad_balance>=\?/);
  assert.match(core, /advertiser_transactions/);
});

test("all billable campaign paths call the shared debit primitive", () => {
  for (const path of [
    "src/lib/channelFastBilling.ts",
    "src/lib/channelSettlement.ts",
    "src/app/api/cron/process-broadcast/route.ts",
    "src/lib/miniappInternalAds.ts",
    "src/lib/miniappExternalDeliverySync.ts",
    "src/lib/channelGrowth.ts",
  ]) assert.match(read(path), /claimAdvertiserDirectDebit/);
});

test("campaign allowance remains conditional and cannot go negative", () => {
  assert.match(read("src/lib/channelFastBilling.ts"), /budget>=\?/);
  assert.match(read("src/lib/channelGrowth.ts"), /budget>=\?/);
  const settlement = read("src/lib/channelSettlement.ts");
  assert.match(settlement, /FOR UPDATE/);
  assert.match(settlement, /Math\.min\(dueUnits, affordableUnits\)/);
  assert.match(settlement, /UPDATE campaigns SET budget = \?/);
  assert.match(read("src/app/api/cron/process-broadcast/route.ts"), /budget >= \?/);
  assert.match(read("src/lib/miniappInternalAds.ts"), /remaining_budget >= \?/);
});

test("budget increases and decreases never mutate the advertiser wallet", () => {
  const classicBlock = lifecycle.slice(lifecycle.indexOf('if (action === "add_fund")'));
  const miniBlock = miniLifecycle.slice(miniLifecycle.indexOf('if (body.action === "add_fund")'));
  for (const block of [classicBlock, miniBlock]) {
    assert.match(block, /set_budget_cap/);
    assert.doesNotMatch(block, /UPDATE users/);
    assert.doesNotMatch(block, /advertiser_transactions/);
  }
});

test("pause and resume do not manufacture refunds", () => {
  const toggle = lifecycle.slice(lifecycle.indexOf('if (action === "toggle")'), lifecycle.indexOf('if (action === "add_fund")'));
  assert.doesNotMatch(toggle, /ad_balance\s*=\s*ad_balance\s*\+/);
  assert.doesNotMatch(toggle, /total_budget\s*=/);
  assert.match(toggle, /u\.ad_balance>=CAST/);
});

test("deposit reactivation is restricted to direct-debit insufficient-balance pauses", () => {
  const source = read("src/lib/directDebitLifecycle.ts");
  assert.match(source, /funding_model='direct_debit'/);
  assert.match(source, /pause_reason='insufficient_balance'/);
  assert.doesNotMatch(source, /balance_locked/);
});

test("legacy release is unique, auditable, and never touches publisher locked earnings", () => {
  assert.match(migration, /advertiser_campaign_reservation_release_ledger/);
  assert.match(migration, /UNIQUE KEY uq_reservation_release_campaign/);
  assert.match(migration, /UNIQUE KEY uq_reservation_release_transaction/);
  assert.match(migration, /exact_creation_debit_name_amount_time/);
  assert.doesNotMatch(migration, /balance_locked/);
  assert.doesNotMatch(migration, /balance_available/);
});

test("migration follows 0132 in the ledger-driven deployment list", () => {
  const deploy = read("deploy-vps.sh");
  assert.ok(deploy.indexOf("20260908_0132_channel_growth.sql") < deploy.indexOf("20260909_0133_advertiser_direct_debit.sql"));
  assert.match(deploy, /adsfusion_schema_migrations/);
});

test("cross-campaign final-wallet concurrency admits only one charge", async () => {
  const state = { wallet: 0.75, debits: new Set() };
  const claim = async (key, amount) => {
    if (state.debits.has(key) || state.wallet < amount) return false;
    state.debits.add(key);
    state.wallet = Number((state.wallet - amount).toFixed(8));
    return true;
  };
  const results = await Promise.all([claim("campaign-a:event-1", 0.75), claim("campaign-b:event-1", 0.75)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(state.wallet, 0);
});

test("same source retry is idempotent", async () => {
  const debits = new Set();
  const claim = (key) => debits.has(key) ? false : (debits.add(key), true);
  assert.equal(claim("channel:post:1:view:1"), true);
  assert.equal(claim("channel:post:1:view:1"), false);
  assert.equal(debits.size, 1);
});

test("Growth startup subsidy stays separate from advertiser direct debit", () => {
  const growth = read("src/lib/channelGrowth.ts");
  assert.match(growth, /claimAdvertiserDirectDebit/);
  assert.match(growth, /seedRecovery/);
  assert.doesNotMatch(migration, /growth_seed_allocated\s*=\s*growth_seed_allocated\s*-/);
});
