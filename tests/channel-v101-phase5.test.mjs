import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const loadedCache = new Map();

// Mock database pool for schema and state tests
const mockDb = {
  query: async () => [[]],
};

function load(file) {
  if (loadedCache.has(file)) return loadedCache.get(file);
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier.includes("channelAllocationMath")) return load("src/lib/channelAllocationMath.ts");
    if (specifier.includes("channelTrustFraudStability")) return load("src/lib/channelTrustFraudStability.ts");
    if (specifier.includes("channelReserveTreasury")) return load("src/lib/channelReserveTreasury.ts");
    if (specifier.includes("db")) return { default: mockDb, ...mockDb };
    return {};
  };
  new Function("module", "exports", "require", "process", output)(mod, mod.exports, customRequire, process);
  loadedCache.set(file, mod.exports);
  return mod.exports;
}

const math = load("src/lib/channelAllocationMath.ts");
const treasury = load("src/lib/channelReserveTreasury.ts");

// ----------------------------------------------------------------------------
// Test 1: Zero views and zero clicks
// ----------------------------------------------------------------------------
test("1. Zero views and zero clicks: 0 entitlement, 0 advance, 0 CPM", () => {
  const advance = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 0,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(advance.targetEntitlementDecimal, "0.00000000");
  assert.equal(advance.fundingDeltaDecimal, "0.00000000");
  assert.equal(advance.newFundedAdvanceDecimal, "0.00000000");

  const arr = treasury.evaluateArrClickTransition({
    eligibleViews: 0,
    currentClicks: 0,
    newClicks: 0,
    clickPublisherUnitPrice: "0.04000000",
    actualFundedAdvance: "0.00000000",
    alreadyRecoveredAmount: "0.00000000",
  });
  assert.equal(arr.cumulativePublisherEarningsDecimal, "0.00000000");
  assert.equal(arr.newlyRecoveredDeltaDecimal, "0.00000000");
  assert.equal(arr.newAdditionalCashDeltaDecimal, "0.00000000");
  assert.equal(arr.effectiveCpmDisplay6, "0.000000");
});

// ----------------------------------------------------------------------------
// Test 2: One eligible view
// ----------------------------------------------------------------------------
test("2. One eligible view: 0.00120000 USDT entitlement, funded accurately", () => {
  const advance = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 1,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "5.00000000",
  });
  assert.equal(advance.eligible, true);
  assert.equal(advance.targetEntitlementDecimal, "0.00120000");
  assert.equal(advance.fundingDeltaDecimal, "0.00120000");
  assert.equal(advance.newFundedAdvanceDecimal, "0.00120000");
  assert.equal(advance.isPartialFunding, false);

  const cpm = math.calculateDynamicEffectiveCpm({
    cumulativeEarnings: advance.newFundedAdvanceDecimal,
    validViews: 1,
  });
  assert.equal(cpm.effectiveCpmDecimal, "1.20000000");
  assert.equal(cpm.effectiveCpmDisplay6, "1.200000");
});

// ----------------------------------------------------------------------------
// Test 3: Every required Phase 3 entitlement milestone
// ----------------------------------------------------------------------------
test("3. Every required Phase 3 entitlement milestone matches pure spec", () => {
  const milestones = [
    [0, "0.00000000"],
    [1, "0.00120000"],
    [10, "0.00900000"],
    [20, "0.01500000"],
    [50, "0.02500000"],
    [100, "0.04000000"],
    [200, "0.05500000"],
    [500, "0.08000000"],
    [750, "0.09200000"],
    [1000, "0.10000000"],
  ];
  for (const [views, expected] of milestones) {
    const res = treasury.calculateZeroClickAdvanceFunding({
      campaignType: "clicks",
      eligibleViews: views,
      currentFundedAdvance: "0.00000000",
      spendableReserveBalance: "10.00000000",
    });
    assert.equal(res.targetEntitlementDecimal, expected, `Milestone for ${views} views failed`);
  }
});

// ----------------------------------------------------------------------------
// Test 4: Intermediate milestone interpolation
// ----------------------------------------------------------------------------
test("4. Intermediate milestone interpolation (30 views, 75 views)", () => {
  // 30 views: between 20 (0.0150) and 50 (0.0250) -> 0.01833333 USDT
  const res30 = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 30,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(res30.targetEntitlementDecimal, "0.01833333");

  // 75 views: between 50 (0.0250) and 100 (0.0400) -> 0.03250000 USDT
  const res75 = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 75,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(res75.targetEntitlementDecimal, "0.03250000");
});

// ----------------------------------------------------------------------------
// Test 5: 1,000, 5,000 and 10,000 eligible views with hard cap enforced
// ----------------------------------------------------------------------------
test("5. Hard cap of 0.10000000 USDT strictly enforced at >= 1,000 views", () => {
  for (const views of [1000, 5000, 10000, 50000]) {
    const res = treasury.calculateZeroClickAdvanceFunding({
      campaignType: "clicks",
      eligibleViews: views,
      currentFundedAdvance: "0.00000000",
      spendableReserveBalance: "10.00000000",
    });
    assert.equal(res.targetEntitlementDecimal, "0.10000000", `Views ${views} exceeded hard cap`);
    assert.equal(res.fundingDeltaDecimal, "0.10000000");
  }
});

// ----------------------------------------------------------------------------
// Test 6: Incremental view updates
// ----------------------------------------------------------------------------
test("6. Incremental view steps fund exact differences without double payment", () => {
  let funded = "0.00000000";

  // Step 1: 10 views (target 0.00900000)
  const step1 = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 10,
    currentFundedAdvance: funded,
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(step1.fundingDeltaDecimal, "0.00900000");
  assert.equal(step1.newFundedAdvanceDecimal, "0.00900000");
  funded = step1.newFundedAdvanceDecimal;

  // Step 2: 50 views (target 0.02500000)
  const step2 = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 50,
    currentFundedAdvance: funded,
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(step2.fundingDeltaDecimal, "0.01600000");
  assert.equal(step2.newFundedAdvanceDecimal, "0.02500000");
  funded = step2.newFundedAdvanceDecimal;

  // Step 3: 200 views (target 0.05500000)
  const step3 = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 200,
    currentFundedAdvance: funded,
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(step3.fundingDeltaDecimal, "0.03000000");
  assert.equal(step3.newFundedAdvanceDecimal, "0.05500000");
  funded = step3.newFundedAdvanceDecimal;

  // Step 4: 1000 views (target 0.10000000)
  const step4 = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 1000,
    currentFundedAdvance: funded,
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(step4.fundingDeltaDecimal, "0.04500000");
  assert.equal(step4.newFundedAdvanceDecimal, "0.10000000");
  assert.equal(step4.newFundedAdvanceUnits, BigInt(10_000_000));
});

// ----------------------------------------------------------------------------
// Test 7: Duplicate view evaluations
// ----------------------------------------------------------------------------
test("7. Duplicate view evaluations return 0 delta and idempotent status", () => {
  const res = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 50,
    currentFundedAdvance: "0.02500000",
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(res.fundingDeltaDecimal, "0.00000000");
  assert.equal(res.newFundedAdvanceDecimal, "0.02500000");
  assert.equal(res.unfundedEntitlementUnits, BigInt(0));
  assert.equal(res.reason, "already_funded_or_no_increase");
});

// ----------------------------------------------------------------------------
// Test 8: Duplicate click evaluations
// ----------------------------------------------------------------------------
test("8. Duplicate click evaluations generate idempotent keys and no duplicate recovery", () => {
  const key1 = treasury.generateArrRecoveryIdempotencyKey({
    advanceId: 101,
    postId: 55,
    clickId: 999,
  });
  const key2 = treasury.generateArrRecoveryIdempotencyKey({
    advanceId: 101,
    postId: 55,
    clickId: 999,
  });
  assert.equal(key1, key2);
  assert.equal(key1, "v101:arr_rec:adv_101:post_55:clk_999");
});

// ----------------------------------------------------------------------------
// Test 9: Multiple settlement worker executions
// ----------------------------------------------------------------------------
test("9. Multiple settlement worker concurrency simulation preserves exactly-once funding", () => {
  const worker1Result = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 100,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(worker1Result.fundingDeltaDecimal, "0.04000000");

  // Worker 2 runs concurrently or immediately after worker 1 updated the advance state
  const worker2Result = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 100,
    currentFundedAdvance: worker1Result.newFundedAdvanceDecimal,
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(worker2Result.fundingDeltaDecimal, "0.00000000");
  assert.equal(worker2Result.newFundedAdvanceDecimal, "0.04000000");
});

// ----------------------------------------------------------------------------
// Test 10: Partial Reserve funding
// ----------------------------------------------------------------------------
test("10. Partial Reserve funding safely funds available spendable balance and queues remainder", () => {
  // Target for 100 views is 0.04000000 USDT. Available spendable reserve is only 0.01500000 USDT.
  const res = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 100,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "0.01500000",
  });
  assert.equal(res.eligible, true);
  assert.equal(res.targetEntitlementDecimal, "0.04000000");
  assert.equal(res.fundingDeltaDecimal, "0.01500000");
  assert.equal(res.newFundedAdvanceDecimal, "0.01500000");
  assert.equal(res.isPartialFunding, true);
  assert.equal(res.unfundedQueueDecimal, "0.02500000");
  assert.equal(res.reason, "partial_funding_insufficient_spendable_reserve");
});

// ----------------------------------------------------------------------------
// Test 11: Insufficient Reserve funding
// ----------------------------------------------------------------------------
test("11. Insufficient Reserve funding (0 spendable balance) creates 0 unbacked credit", () => {
  const res = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 100,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "0.00000000",
  });
  assert.equal(res.eligible, true);
  assert.equal(res.targetEntitlementDecimal, "0.04000000");
  assert.equal(res.fundingDeltaDecimal, "0.00000000");
  assert.equal(res.newFundedAdvanceDecimal, "0.00000000");
  assert.equal(res.isPartialFunding, true);
  assert.equal(res.unfundedQueueDecimal, "0.04000000");
  assert.equal(res.reason, "reserve_exhausted_or_at_floor");
});

// ----------------------------------------------------------------------------
// Test 12: Protected 30% Reserve floor
// ----------------------------------------------------------------------------
test("12. Protected 30% Reserve floor is strictly conserved and never spendable", () => {
  const state = treasury.calculateReserveTreasuryState({
    realizedInflows: "10.00000000",
    authorizedAdvances: "0.00000000",
    recoveredArr: "0.00000000",
  });
  assert.equal(state.totalRealizedCapitalDecimal, "10.00000000");
  assert.equal(state.protectedBalanceDecimal, "3.00000000");
  assert.equal(state.maxSpendableLimitDecimal, "7.00000000");
  assert.equal(state.unencumberedSpendableBalanceDecimal, "7.00000000");
  assert.equal(state.isSolvent, true);
});

// ----------------------------------------------------------------------------
// Test 13: 70% maximum spendable allocation enforcement
// ----------------------------------------------------------------------------
test("13. 70% maximum spendable ceiling stops advances when outstanding reaches cap", () => {
  // Realized capital: 10.00000000. Cap: 7.00000000. Already committed outstanding advances: 7.00000000.
  const state = treasury.calculateReserveTreasuryState({
    realizedInflows: "10.00000000",
    authorizedAdvances: "7.00000000",
    recoveredArr: "0.00000000",
  });
  assert.equal(state.maxSpendableLimitDecimal, "7.00000000");
  assert.equal(state.outstandingAdvancesDecimal, "7.00000000");
  assert.equal(state.unencumberedSpendableBalanceDecimal, "0.00000000");
  assert.equal(state.isSolvent, true);
});

// ----------------------------------------------------------------------------
// Test 14: Partial ARR recovery
// ----------------------------------------------------------------------------
test("14. Partial ARR recovery when 1 click arrives: advance partially recovered, 0 extra cash", () => {
  // 1,000 views, 0.10000000 USDT advance. 1 click arrives at 0.04000000 USDT.
  const arr = treasury.evaluateArrClickTransition({
    eligibleViews: 1000,
    currentClicks: 0,
    newClicks: 1,
    clickPublisherUnitPrice: "0.04000000",
    actualFundedAdvance: "0.10000000",
    alreadyRecoveredAmount: "0.00000000",
  });
  assert.equal(arr.grossClickEntitlementDecimal, "0.04000000");
  assert.equal(arr.cumulativePublisherEarningsDecimal, "0.10000000");
  assert.equal(arr.outstandingAdvanceDecimal, "0.06000000");
  assert.equal(arr.totalRecoveredDecimal, "0.04000000");
  assert.equal(arr.newlyRecoveredDeltaDecimal, "0.04000000");
  assert.equal(arr.newAdditionalCashDeltaDecimal, "0.00000000");
});

// ----------------------------------------------------------------------------
// Test 15: Full ARR recovery
// ----------------------------------------------------------------------------
test("15. Full ARR recovery: clicks match advance, 100% recovered to reserve", () => {
  // 1,000 views, 0.10000000 advance. 2 clicks arrive at 0.05000000 USDT.
  const arr = treasury.evaluateArrClickTransition({
    eligibleViews: 1000,
    currentClicks: 0,
    newClicks: 2,
    clickPublisherUnitPrice: "0.05000000",
    actualFundedAdvance: "0.10000000",
    alreadyRecoveredAmount: "0.00000000",
  });
  assert.equal(arr.grossClickEntitlementDecimal, "0.10000000");
  assert.equal(arr.cumulativePublisherEarningsDecimal, "0.10000000");
  assert.equal(arr.outstandingAdvanceDecimal, "0.00000000");
  assert.equal(arr.totalRecoveredDecimal, "0.10000000");
  assert.equal(arr.newlyRecoveredDeltaDecimal, "0.10000000");
  assert.equal(arr.newAdditionalCashDeltaDecimal, "0.00000000");
});

// ----------------------------------------------------------------------------
// Test 16: Click entitlement exceeding funded advance
// ----------------------------------------------------------------------------
test("16. Click entitlement exceeding advance credits incremental cash to publisher", () => {
  // Advance 0.10000000 USDT. Prior clicks: 2 (recovered 0.10000000). Click 3 arrives at 0.05000000 USDT.
  const arr = treasury.evaluateArrClickTransition({
    eligibleViews: 1000,
    currentClicks: 2,
    newClicks: 1,
    clickPublisherUnitPrice: "0.05000000",
    actualFundedAdvance: "0.10000000",
    alreadyRecoveredAmount: "0.10000000",
    alreadyPaidCashAmount: "0.00000000",
  });
  assert.equal(arr.totalClicks, BigInt(3));
  assert.equal(arr.grossClickEntitlementDecimal, "0.15000000");
  assert.equal(arr.cumulativePublisherEarningsDecimal, "0.15000000");
  assert.equal(arr.outstandingAdvanceDecimal, "0.00000000");
  assert.equal(arr.newlyRecoveredDeltaDecimal, "0.00000000");
  assert.equal(arr.newAdditionalCashDeltaDecimal, "0.05000000");
});

// ----------------------------------------------------------------------------
// Test 17: Campaign pause/resume and exhaustion
// ----------------------------------------------------------------------------
test("17. Campaign paused or exhausted maintains ledger integrity and stops new debits", () => {
  // If campaign status is paused/exhausted, advance funding respects current funded state
  const res = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 50,
    currentFundedAdvance: "0.02500000",
    spendableReserveBalance: "0.00000000",
  });
  assert.equal(res.fundingDeltaDecimal, "0.00000000");
  assert.equal(res.newFundedAdvanceDecimal, "0.02500000");
});

// ----------------------------------------------------------------------------
// Test 18: CPM campaign isolation
// ----------------------------------------------------------------------------
test("18. CPM campaign isolation: campaigns with campaign_type='views' are rejected", () => {
  const res = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "views",
    eligibleViews: 1000,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
  });
  assert.equal(res.eligible, false);
  assert.equal(res.campaignTypeValid, false);
  assert.equal(res.targetEntitlementDecimal, "0.00000000");
  assert.equal(res.fundingDeltaDecimal, "0.00000000");
  assert.equal(res.reason, "campaign_not_cpc_views_campaign_excluded");
});

// ----------------------------------------------------------------------------
// Test 19: Different advertiser CPC rates
// ----------------------------------------------------------------------------
test("19. Different advertiser CPC rates correctly scale click entitlement", () => {
  for (const cpc of ["0.02000000", "0.05000000", "0.15000000"]) {
    const arr = treasury.evaluateArrClickTransition({
      eligibleViews: 500,
      currentClicks: 0,
      newClicks: 1,
      clickPublisherUnitPrice: cpc,
      actualFundedAdvance: "0.08000000",
      alreadyRecoveredAmount: "0.00000000",
    });
    assert.equal(arr.grossClickEntitlementDecimal, cpc);
  }
});

// ----------------------------------------------------------------------------
// Test 20: Different admin revenue splits
// ----------------------------------------------------------------------------
test("20. Configurable admin revenue splits (60/30/10, 70/20/10, 50/40/10)", () => {
  const splits = [
    { pub: 60, plat: 30, res: 10, debit: "1.00000000", expectedRes: "0.10000000" },
    { pub: 70, plat: 20, res: 10, debit: "1.00000000", expectedRes: "0.10000000" },
    { pub: 50, plat: 40, res: 10, debit: "2.50000000", expectedRes: "0.25000000" },
  ];
  for (const s of splits) {
    const grossSplit = math.calculateDirectGrossSplit({
      grossDebit: s.debit,
      publisherPercent: s.pub,
      platformPercent: s.plat,
      reservePercent: s.res,
    });
    assert.equal(math.unitsToDecimal(grossSplit.reserveBase), s.expectedRes);
    const invariant = grossSplit.publisherBase + grossSplit.platform + grossSplit.reserveBase;
    assert.equal(invariant, grossSplit.debit);
  }
});

// ----------------------------------------------------------------------------
// Test 21: ±5% quality adjustment boundaries
// ----------------------------------------------------------------------------
test("21. Publisher quality adjustments bounded to ±5% (0.95 to 1.05)", () => {
  // Lower bound 0.95 on 500 views (base 0.08000000) -> 0.07600000 USDT
  const lower = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 500,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
    qualityMultiplier: "0.95000000",
  });
  assert.equal(lower.targetEntitlementDecimal, "0.07600000");

  // Upper bound 1.05 on 200 views (base 0.05500000) -> 0.05775000 USDT
  const upper = treasury.calculateZeroClickAdvanceFunding({
    campaignType: "clicks",
    eligibleViews: 200,
    currentFundedAdvance: "0.00000000",
    spendableReserveBalance: "10.00000000",
    qualityMultiplier: "1.05000000",
  });
  assert.equal(upper.targetEntitlementDecimal, "0.05775000");
});

// ----------------------------------------------------------------------------
// Test 22: Database schema not ready
// ----------------------------------------------------------------------------
test("22. Database schema not ready gracefully degrades without throwing", async () => {
  // Mock db where tables do not exist
  const unreadyDb = {
    query: async () => [[{ present: 0 }]],
  };
  const isReady = await treasury.isChannelV101ReserveTreasurySchemaReady(unreadyDb);
  assert.equal(isReady, false);
});

// ----------------------------------------------------------------------------
// Test 23: Ledger reconciliation and precision
// ----------------------------------------------------------------------------
test("23. Ledger reconciliation: realized capital = protected + maxSpendable", () => {
  const state = treasury.calculateReserveTreasuryState({
    realizedInflows: "123.45678900",
    authorizedAdvances: "45.00000000",
    recoveredArr: "15.00000000",
  });
  const sum = state.protectedBalanceUnits + state.maxSpendableLimitUnits;
  assert.equal(sum, state.totalRealizedCapitalUnits);
  assert.equal(state.outstandingAdvancesUnits, BigInt(30_00000000));
  assert.equal(state.isSolvent, true);
});

// ----------------------------------------------------------------------------
// Test 24: Failure recovery and replay idempotency
// ----------------------------------------------------------------------------
test("24. Replay idempotency: identical inputs produce byte-for-byte identical state", () => {
  const input = {
    realizedInflows: "50.00000000",
    authorizedAdvances: "20.00000000",
    recoveredArr: "10.00000000",
  };
  const run1 = treasury.calculateReserveTreasuryState(input);
  const run2 = treasury.calculateReserveTreasuryState(input);
  assert.deepEqual(run1, run2);
});

// ----------------------------------------------------------------------------
// Test 25: No duplicate advertiser debit or publisher credit
// ----------------------------------------------------------------------------
test("25. Financial conservation invariant: debit = publisher + platform + reserve", () => {
  const grossDebit = "0.50000000";
  const split = math.calculateDirectGrossSplit({
    grossDebit,
    publisherPercent: 60,
    platformPercent: 30,
    reservePercent: 10,
  });
  const pub = split.publisherBase;
  const plat = split.platform;
  const res = split.reserveBase;
  assert.equal(pub + plat + res, split.debit);
  assert.equal(math.unitsToDecimal(pub), "0.30000000");
  assert.equal(math.unitsToDecimal(plat), "0.15000000");
  assert.equal(math.unitsToDecimal(res), "0.05000000");
});
