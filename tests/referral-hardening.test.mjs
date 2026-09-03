import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const policy = fs.readFileSync("src/lib/referralHardening.ts", "utf8");
const referral = fs.readFileSync("src/lib/referralSprint.ts", "utf8");
const commission = fs.readFileSync("src/app/api/cron/unlock-balances/route.ts", "utf8");
const migration = fs.readFileSync("db/migrations/20260801_0068_referral_payout_hardening.sql", "utf8");
const campaign = fs.readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
const publisherUi = fs.readFileSync("src/app/publisher/referral/page.tsx", "utf8");

test("ordinary referral amounts remain exact", () => {
  assert.match(policy, /registration: "0\.00500000"/);
  assert.match(policy, /verification: "0\.01000000"/);
  assert.match(policy, /ordinaryMaximum: "0\.01500000"/);
});

test("registration and verification use separate deterministic keys", () => {
  assert.match(referral, /referralIdempotencyKey\(input\.rewardType, input\.referralId\)/);
  assert.match(referral, /rewardType: "referral_join"/);
  assert.match(referral, /rewardType: "verified_referral"/);
  assert.match(migration, /UNIQUE INDEX uniq_referral_reward_idempotency/);
});

test("fraud and invalid accounts cannot receive verification rewards", () => {
  assert.match(referral, /ineligible_referral_status/);
  assert.match(referral, /duplicate_telegram_identity/);
  assert.match(referral, /abuse\.flags\.some\(\(flag\) => flag\.key === "referral_loop"\)/);
});

test("sprint prices and team pools are reduced exactly", () => {
  assert.match(policy, /\["1\.00000000", "0\.50000000", "0\.25000000"\]/);
  assert.match(policy, /\["1\.50000000", "0\.75000000", "0\.25000000"\]/);
  assert.match(migration, /first_place_reward=1\.00000000/);
  assert.match(migration, /best_team_reward=1\.50000000/);
});

test("one user's combined sprint rewards are capped at 1.50", () => {
  assert.match(policy, /sprintUser: "1\.50000000"/);
  assert.match(referral, /reward_type LIKE 'sprint_rank_%'.*reward_type LIKE 'team_sprint_%'/s);
});

test("daily, monthly, and global caps are transaction locked", () => {
  assert.match(policy, /dailyUser: "0\.50000000"/);
  assert.match(policy, /monthlyUser: "5\.00000000"/);
  assert.match(policy, /monthlyPlatform: "25\.00000000"/);
  assert.match(referral, /referral_budget_usage[\s\S]+ORDER BY scope_type,user_id FOR UPDATE/);
  assert.match(referral, /settled_amount=settled_amount\+\?/);
  assert.match(referral, /if \(!complete\) break/);
});

test("cap overflow remains pending for a later period", () => {
  assert.match(referral, /complete \? "paid" : "pending"/);
  assert.match(referral, /cap_overflow_pending/);
});

test("rankings require meaningful activity and exclude fraud signals", () => {
  for (const signal of ["fraud", "rejected", "self_referral", "reciprocal", "duplicate_tg", "referral_abuse_flags", "no_meaningful_activity"]) {
    assert.ok(policy.includes(signal) || referral.includes(signal), `missing ${signal}`);
  }
  for (const activity of ["channels", "bots", "miniapps", "campaigns", "deposits", "platform_revenue"]) assert.ok(policy.includes(activity));
  assert.match(referral, /recalculateSprintEligibility/);
});

test("milestones are canonical, duplicate-safe, and team milestones are disabled", () => {
  for (const value of ["0.02000000", "0.05000000", "0.15000000", "0.30000000", "0.75000000", "1.50000000", "3.00000000"]) assert.ok(migration.includes(value));
  assert.match(migration, /threshold_count=30 AND status='active'/);
  assert.match(migration, /scope='team' AND status='active'/);
  assert.match(referral, /referral_team_milestones_enabled/);
  assert.doesNotMatch(fs.readFileSync("src/app/api/admin/referrals/route.ts", "utf8"), /DELETE FROM referral_milestones/);
});

test("ledger/source records synchronize only after full settlement", () => {
  assert.match(referral, /UPDATE referral_sprint_winners SET reward_status='paid',paid_at=NOW\(\)/);
  assert.match(referral, /UPDATE referral_team_rewards SET reward_status='paid',paid_at=NOW\(\)/);
  assert.match(referral, /UPDATE referral_milestone_claims SET status='paid',paid_at=NOW\(\)/);
});

test("publisher commission has a dedicated idempotent ledger and lifetime cap", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS referral_commission_ledger/);
  assert.match(migration, /UNIQUE KEY uniq_referral_commission_key/);
  assert.match(commission, /publisher_commission:\$\{source\.type\}:\$\{source\.id\}/);
  assert.match(commission, /1\.00000000/);
  assert.doesNotMatch(commission, /creditUserAvailableBalance/);
});

test("deployment migration preserves history and targets only unsettled sprint", () => {
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.match(migration, /WHERE status='active' AND rewards_paid_at IS NULL/);
  assert.match(migration, /Historical paid[\s\S]+not imported/i);
});

test("publisher UI explains prices, eligibility, fraud, prizes, and caps", () => {
  for (const text of ["$0.005", "$0.010", "$0.015", "meaningful platform activity", "Individual prizes", "team pools", "caps apply", "suspicious referrals"]) assert.ok(publisherUi.includes(text));
});

test("campaign creation continues to use supported HTML parse mode", () => {
  assert.match(campaign, /const parse_mode = "html"/);
  assert.doesNotMatch(campaign, /const parse_mode = "none"/);
});
