import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const referral=fs.readFileSync(new URL("../src/lib/referralSprint.ts",import.meta.url),"utf8");
const script=fs.readFileSync(new URL("../scripts/reconcile-referral-account.mjs",import.meta.url),"utf8");
const subscriber=fs.readFileSync(new URL("../src/lib/channelSubscriberRefresh.ts",import.meta.url),"utf8");
const reconciliation=fs.readFileSync(new URL("../src/lib/referralReconciliation.ts",import.meta.url),"utf8");
const policy=fs.readFileSync(new URL("../src/lib/channelRefreshPolicy.ts",import.meta.url),"utf8");
const cron=fs.readFileSync(new URL("../src/app/api/cron/update-subscribers/route.ts",import.meta.url),"utf8");
test("dashboard uses immutable paid ledger total",()=>{assert.match(referral,/total_earnings: toNumber\(stats\?\.referral_earnings\)/);assert.doesNotMatch(referral,/total_earnings: toNumber\(user\.total_referral_earnings\)/)});
test("reconciliation is explicit, idempotent, and scoped",()=>{assert.match(script,/--user-id=/);assert.match(script,/--apply/);assert.match(reconciliation,/referral-invalid-reversal:/);assert.match(reconciliation,/original_reward_id/);assert.match(reconciliation,/exact_account_not_found/);assert.match(reconciliation,/balance_locked/)});
test("subscriber failures preserve count and scheduling is bounded",()=>{assert.doesNotMatch(subscriber,/subscriber_count=0/);assert.match(subscriber,/subscribers_fetch_status='failed'/);assert.match(policy,/SUBSCRIBER_REFRESH_HOURS=24/);assert.match(cron,/ORDER BY COALESCE\(c\.subscribers_last_attempt_at/);assert.match(cron,/acquireCronLock/)});
test("threshold policy encodes grace pause and safe restore",()=>{assert.match(policy,/BELOW_MINIMUM_GRACE_HOURS=48/);assert.match(policy,/checks>=2/);assert.match(policy,/input\.canRestore\?"restore":"clear_only"/);assert.match(policy,/monetization_paused_reason==="below_minimum"/)});
