import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "./reward-callback-production-loader.mjs";

const budget = await import("../src/lib/broadcastBudgetLifecycle.ts");
const worker = readFileSync("src/app/api/cron/process-broadcast/route.ts", "utf8");
const listing = readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
const detail = readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts", "utf8");
const channelSettlement = readFileSync("src/lib/channelSettlement.ts", "utf8");

test("zero, negative, and sub-unit BOT budgets are exhausted using production affordability", () => {
  for (const remaining of [0, "-3.25000000", "0.00999999"]) {
    const result = budget.evaluateBroadcastAffordability(remaining, "0.01000000");
    assert.equal(result.affordable, false);
    assert.equal(result.exhausted, true);
  }
  assert.equal(budget.publicBroadcastBudget("-3.25000000"), 0);
  assert.equal(budget.addBroadcastMoney("0.00999999", "0.00000001"), "0.01000000");
});

test("exact final BOT unit reserves once and cannot reserve a second time", () => {
  const first = budget.evaluateBroadcastAffordability("0.01000000", "0.01000000");
  assert.equal(first.affordable, true);
  assert.equal(first.remainingAfterReservationUnits, 0n);
  const second = budget.evaluateBroadcastAffordability("0.00000000", "0.01000000");
  assert.equal(second.affordable, false);
  assert.match(worker, /SELECT budget, status, daily_budget_limit FROM campaigns WHERE id = \? FOR UPDATE/);
  assert.match(worker, /UPDATE campaigns SET budget = budget - \? WHERE id = \? AND budget >= \? AND status = 'active'/);
  assert.match(worker, /INSERT INTO broadcast_deliveries[\s\S]*status, retry_count\)[\s\S]*'pending'/);
});

test("insufficient locked reservations become budget_exhausted without financial side effects", () => {
  assert.doesNotMatch(worker, /insufficient_budget_for_delivery/);
  assert.match(worker, /SET status = 'budget_exhausted', budget_exhausted_at = NOW\(\), pause_reason = 'budget_exhausted'/);
  const affordabilityFailure = worker.slice(
    worker.indexOf("if (!canFundBroadcastDelivery(lockedCampaign.budget, input.cost))"),
    worker.indexOf("if (Number(lockedCampaign.daily_budget_limit", worker.indexOf("if (!canFundBroadcastDelivery(lockedCampaign.budget, input.cost))"))
  );
  assert.doesNotMatch(affordabilityFailure, /INSERT INTO broadcast_deliveries|sendTelegramMessage|publisher_reward/);
});

test("refund is idempotent and only auto-reactivates an automatically exhausted BOT campaign", () => {
  assert.equal(budget.refundedBroadcastStatus({
    status: "budget_exhausted",
    pauseReason: "budget_exhausted",
    refundedBudget: "0.01000000",
    nextDebit: "0.01000000",
  }), "active");
  assert.equal(budget.refundedBroadcastStatus({
    status: "paused",
    pauseReason: "user_paused",
    refundedBudget: "10.00000000",
    nextDebit: "0.01000000",
  }), "paused");
  assert.match(worker, /WHERE id = \? AND status IN \('pending','sending','retry_wait'\)/);
  assert.match(worker, /if \(!delivery \|\| !\["pending", "sending", "retry_wait"\]\.includes\(delivery\.status\)\)[\s\S]*refunded: false, idempotent: true/);
  assert.match(worker, /status = 'active', budget_exhausted_at = NULL, pause_reason = NULL/);
});

test("worker reconciles unaffordable active BOT campaigns even with no eligible recipients", () => {
  const reconcile = worker.indexOf("const [exhaustedCandidates]");
  const inventory = worker.indexOf("// 1. Find active broadcast campaigns with budget");
  assert.ok(reconcile >= 0 && reconcile < inventory);
  assert.match(worker, /c\.budget < ROUND\(GREATEST/);
  assert.match(worker, /WHERE status='active' AND id IN/);
});

test("public BOT budget is clamped while CHANNEL accounting remains protected", () => {
  assert.match(listing, /CASE WHEN type = 'broadcast' THEN GREATEST\(COALESCE\(budget, 0\), 0\) ELSE budget END AS budget/);
  assert.match(listing, /THEN 'budget_exhausted'/);
  assert.match(detail, /GREATEST\(COALESCE\(budget, 0\), 0\) AS budget/);
  assert.match(detail, /campaignRows\[0\]\.status = "budget_exhausted"/);
  assert.match(channelSettlement, /const platformRevenue = amount\(debit \* \(policy\.platformMarginPercent \/ 100\)\)/);
  assert.match(channelSettlement, /const reserveAmount = amount\(publisherPoolBeforeReserve \* \(policy\.safetyReservePercent \/ 100\)\)/);
  assert.match(channelSettlement, /const publisherCredit = amount\(debit - platformRevenue - reserveAmount\)/);
  assert.doesNotMatch(worker, /deleteActiveCampaignPosts|settleCampaignEngagementBeforeDeletion/);
});
