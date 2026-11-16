import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
function load(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "process", output)(mod, mod.exports, process);
  return mod.exports;
}
const m = load("src/lib/channelAllocationMath.ts");
const stat = load("src/lib/statFormulas.ts");

test("zero-click curve: required milestone values and boundaries", () => {
  const check = (views, expected) => {
    assert.equal(m.calculateCpcZeroClickEntitlementDecimal(views), expected, `Views ${views}`);
  };

  check(0, "0.00000000");
  check(1, "0.00120000");
  check(10, "0.00900000");
  check(20, "0.01500000");
  check(50, "0.02500000");
  check(100, "0.04000000");
  check(200, "0.05500000");
  check(500, "0.08000000");
  check(750, "0.09200000");
  check(1000, "0.10000000");

  // Strict 0.10000000 cap beyond 1,000 views
  check(1001, "0.10000000");
  check(2000, "0.10000000");
  check(10000, "0.10000000");
  check(1000000, "0.10000000");
});

test("zero-click curve: interpolation between milestones and strict monotonicity", () => {
  const testViews = [0, 1, 2, 5, 10, 20, 30, 50, 75, 100, 200, 300, 500, 750, 999, 1000, 1001, 2000, 10000];
  let prevUnits = -1n;
  for (const v of testViews) {
    const units = m.calculateCpcZeroClickEntitlementUnits(v);
    assert.ok(units >= 0n, "non-negative");
    assert.ok(units >= prevUnits, `monotonic at ${v}`);
    assert.ok(units <= 10000000n, `cap at ${v}`);
    prevUnits = units;
  }

  // Intermediate point check: 75 views (halfway between 50 and 100)
  // 50: 0.02500000, 100: 0.04000000 -> 75 should be 0.03250000
  assert.equal(m.calculateCpcZeroClickEntitlementDecimal(75), "0.03250000");
  // 30 views (halfway between 20 and 50) -> 0.015 + 10/30 * 0.01 = 0.01833333
  assert.equal(m.calculateCpcZeroClickEntitlementDecimal(30), "0.01833333");

  // Input validation
  assert.throws(() => m.calculateCpcZeroClickEntitlementUnits(-5), /invalid_eligible_views/);
  assert.throws(() => m.calculateCpcZeroClickEntitlementUnits(NaN), /invalid_eligible_views/);
  assert.throws(() => m.calculateCpcZeroClickEntitlementUnits("100"), /invalid_eligible_views/);
});

test("dynamic effective CPM: accurate derivation from earnings across view counts", () => {
  const ecpm = (earnings, views) => m.calculateDynamicEffectiveCpm({ cumulativeEarnings: earnings, validViews: views });

  // 1 view, 0.00120000 earnings -> eCPM = 1.200000 USDT
  const r1 = ecpm("0.00120000", 1);
  assert.equal(r1.effectiveCpmDecimal, "1.20000000");
  assert.equal(r1.effectiveCpmDisplay6, "1.200000");

  // 10 views, 0.00900000 earnings -> eCPM = 0.900000 USDT
  const r10 = ecpm("0.00900000", 10);
  assert.equal(r10.effectiveCpmDecimal, "0.90000000");

  // 50 views, 0.02500000 earnings -> eCPM = 0.500000 USDT
  const r50 = ecpm("0.02500000", 50);
  assert.equal(r50.effectiveCpmDecimal, "0.50000000");

  // 100 views, 0.04000000 earnings -> eCPM = 0.400000 USDT
  const r100 = ecpm("0.04000000", 100);
  assert.equal(r100.effectiveCpmDecimal, "0.40000000");

  // 1,000 views, 0.10000000 earnings -> eCPM = 0.100000 USDT
  const r1000 = ecpm("0.10000000", 1000);
  assert.equal(r1000.effectiveCpmDecimal, "0.10000000");

  // 10,000 views, 0.10000000 earnings -> eCPM = 0.010000 USDT
  const r10k = ecpm("0.10000000", 10000);
  assert.equal(r10k.effectiveCpmDecimal, "0.01000000");
  assert.equal(r10k.effectiveCpmDisplay6, "0.010000");

  // CPC Campaign example: 5 clicks, 50 views, rate 65 USDT/1k (base = 0.039 USDT/click)
  // Total earnings = 5 * 0.039 = 0.19500000 USDT -> eCPM = (0.195 / 50) * 1000 = 3.900000 USDT
  const rCpc5 = ecpm("0.19500000", 50);
  assert.equal(rCpc5.effectiveCpmDecimal, "3.90000000");
  assert.equal(rCpc5.effectiveCpmDisplay6, "3.900000");

  // CPC Campaign example: 20 clicks, 1,000 views, rate 65 USDT/1k (base = 0.78000000 USDT)
  // eCPM = (0.78 / 1000) * 1000 = 0.780000 USDT
  const rCpc20 = ecpm("0.78000000", 1000);
  assert.equal(rCpc20.effectiveCpmDecimal, "0.78000000");
  assert.equal(rCpc20.effectiveCpmDisplay6, "0.780000");

  // Zero views or zero earnings safely return 0
  assert.equal(ecpm("0.10000000", 0).effectiveCpmDecimal, "0.00000000");
  assert.equal(ecpm("0", 1000).effectiveCpmDecimal, "0.00000000");

  // statFormulas helper parity
  assert.equal(stat.calculateEffectivePublisherCpm(0.195, 50), 3.9);
  assert.equal(stat.calculateEffectivePublisherCpm(0.78, 1000), 0.78);
  assert.equal(stat.calculateEffectivePublisherCpm(0.1, 0), 0);
});

test("quality adjustment: total routine adjustment strictly bounded to +/-5%", () => {
  // Neutral baseline scores (60 all) -> 1.00000000
  const neutral = m.calculateV101QualityMultiplier({
    trustScore: 60,
    trafficQualityScore: 60,
    ctrScore: 60,
    consistencyScore: 60,
    retentionScore: 60,
  });
  assert.equal(neutral.multiplierDecimal, "1.00000000");
  assert.equal(neutral.totalAdjustmentPercent, "0.0000");

  // Maximum ceiling scores (100 all) -> exactly 1.05000000 (+5.0%)
  const max = m.calculateV101QualityMultiplier({
    trustScore: 100,
    trafficQualityScore: 100,
    ctrScore: 100,
    consistencyScore: 100,
    retentionScore: 100,
  });
  assert.equal(max.multiplierDecimal, "1.05000000");
  assert.equal(max.trustAdjustmentPercent, "1.0000");
  assert.equal(max.trafficAdjustmentPercent, "4.0000");
  assert.equal(max.totalAdjustmentPercent, "5.0000");

  // Minimum floor scores (0 all) -> exactly 0.95000000 (-5.0%)
  const min = m.calculateV101QualityMultiplier({
    trustScore: 0,
    trafficQualityScore: 0,
    ctrScore: 0,
    consistencyScore: 0,
    retentionScore: 0,
  });
  assert.equal(min.multiplierDecimal, "0.95000000");
  assert.equal(min.trustAdjustmentPercent, "-1.0000");
  assert.equal(min.trafficAdjustmentPercent, "-4.0000");
  assert.equal(min.totalAdjustmentPercent, "-5.0000");

  // Trust independence check: low trust (20) with great traffic (100)
  // Trust penalty: (20 - 60)/40 * 1% = -1.0%. Traffic bonus: +4.0%.
  // Total: 1.0 - 0.01 + 0.04 = 1.03 (+3.0%)
  const lowTrustGreatTraffic = m.calculateV101QualityMultiplier({
    trustScore: 20,
    trafficQualityScore: 100,
    ctrScore: 100,
    consistencyScore: 100,
    retentionScore: 100,
  });
  assert.equal(lowTrustGreatTraffic.multiplierDecimal, "1.03000000");

  // High trust (100) with poor traffic (20)
  // Trust bonus: +1.0%. Traffic penalty: -4.0%. Total: 1.0 + 0.01 - 0.04 = 0.97 (-3.0%)
  const highTrustPoorTraffic = m.calculateV101QualityMultiplier({
    trustScore: 100,
    trafficQualityScore: 20,
    ctrScore: 20,
    consistencyScore: 20,
    retentionScore: 20,
  });
  assert.equal(highTrustPoorTraffic.multiplierDecimal, "0.97000000");
});

test("ARR simulation: zero-click advance transition as clicks arrive", () => {
  const c65 = "0.03900000"; // 60% publisher share of 0.065 USDT click
  const advance = "0.10000000";

  // State 0: 1,000 views, 0 clicks, 0.10 advance credited
  const s0 = m.calculateArrTransition({
    eligibleViews: 1000,
    validClicks: 0,
    clickPublisherUnitPrice: c65,
    actualFundedAdvance: advance,
  });
  assert.equal(m.unitsToDecimal(s0.cumulativePublisherEarnings), "0.10000000");
  assert.equal(m.unitsToDecimal(s0.outstandingAdvance), "0.10000000");
  assert.equal(m.unitsToDecimal(s0.recoveredAmount), "0.00000000");
  assert.equal(m.unitsToDecimal(s0.additionalCashPayout), "0.00000000");
  assert.equal(s0.effectiveCpmDecimal, "0.10000000");

  // State 1: 1 click arrives
  const s1 = m.calculateArrTransition({
    eligibleViews: 1000,
    validClicks: 1,
    clickPublisherUnitPrice: c65,
    actualFundedAdvance: advance,
  });
  assert.equal(m.unitsToDecimal(s1.grossClickEntitlement), "0.03900000");
  assert.equal(m.unitsToDecimal(s1.cumulativePublisherEarnings), "0.10000000"); // earnings preserved
  assert.equal(m.unitsToDecimal(s1.outstandingAdvance), "0.06100000");
  assert.equal(m.unitsToDecimal(s1.recoveredAmount), "0.03900000");
  assert.equal(m.unitsToDecimal(s1.additionalCashPayout), "0.00000000");
  assert.equal(s1.effectiveCpmDecimal, "0.10000000");

  // State 2: 2 clicks arrive
  const s2 = m.calculateArrTransition({
    eligibleViews: 1000,
    validClicks: 2,
    clickPublisherUnitPrice: c65,
    actualFundedAdvance: advance,
  });
  assert.equal(m.unitsToDecimal(s2.grossClickEntitlement), "0.07800000");
  assert.equal(m.unitsToDecimal(s2.cumulativePublisherEarnings), "0.10000000");
  assert.equal(m.unitsToDecimal(s2.outstandingAdvance), "0.02200000");
  assert.equal(m.unitsToDecimal(s2.recoveredAmount), "0.07800000");
  assert.equal(m.unitsToDecimal(s2.additionalCashPayout), "0.00000000");

  // State 3: 3 clicks arrive (recovery complete, publisher earns new cash)
  const s3 = m.calculateArrTransition({
    eligibleViews: 1000,
    validClicks: 3,
    clickPublisherUnitPrice: c65,
    actualFundedAdvance: advance,
  });
  assert.equal(m.unitsToDecimal(s3.grossClickEntitlement), "0.11700000");
  assert.equal(m.unitsToDecimal(s3.cumulativePublisherEarnings), "0.11700000");
  assert.equal(m.unitsToDecimal(s3.outstandingAdvance), "0.00000000");
  assert.equal(m.unitsToDecimal(s3.recoveredAmount), "0.10000000"); // fully recovered!
  assert.equal(m.unitsToDecimal(s3.additionalCashPayout), "0.01700000");
  assert.equal(s3.effectiveCpmDecimal, "0.11700000");
  assert.equal(s3.effectiveCpmDisplay6, "0.117000");

  // Partial reserve funding test: advance was only funded to 0.01000000 USDT
  const sPartial = m.calculateArrTransition({
    eligibleViews: 100,
    validClicks: 1,
    clickPublisherUnitPrice: c65,
    actualFundedAdvance: "0.01000000",
  });
  assert.equal(m.unitsToDecimal(sPartial.grossClickEntitlement), "0.03900000");
  assert.equal(m.unitsToDecimal(sPartial.cumulativePublisherEarnings), "0.03900000");
  assert.equal(m.unitsToDecimal(sPartial.outstandingAdvance), "0.00000000");
  assert.equal(m.unitsToDecimal(sPartial.recoveredAmount), "0.01000000");
  assert.equal(m.unitsToDecimal(sPartial.additionalCashPayout), "0.02900000");

  // Multiple CPC campaign rates: 80, 100, 120 USDT / 1k
  const c80 = "0.04800000";
  const c100 = "0.06000000";
  const c120 = "0.07200000";
  assert.equal(m.unitsToDecimal(m.calculateArrTransition({ eligibleViews: 1000, validClicks: 2, clickPublisherUnitPrice: c80, actualFundedAdvance: advance }).outstandingAdvance), "0.00400000");
  assert.equal(m.unitsToDecimal(m.calculateArrTransition({ eligibleViews: 1000, validClicks: 2, clickPublisherUnitPrice: c100, actualFundedAdvance: advance }).additionalCashPayout), "0.02000000");
  assert.equal(m.unitsToDecimal(m.calculateArrTransition({ eligibleViews: 1000, validClicks: 2, clickPublisherUnitPrice: c120, actualFundedAdvance: advance }).additionalCashPayout), "0.04400000");
});

test("six-decimal earnings display formatting preserves small positive balances", () => {
  assert.equal(m.formatSixDecimalDisplay("0.00120000"), "0.001200");
  assert.equal(m.formatSixDecimalDisplay("0.03900000"), "0.039000");
  assert.equal(m.formatSixDecimalDisplay("0.10000000"), "0.100000");
  assert.equal(m.formatSixDecimalDisplay("123.45678901"), "123.456789");
  assert.equal(m.formatSixDecimalDisplay("0"), "0.000000");

  assert.equal(stat.formatPublisherEarningsDisplay(0.0012), "0.001200");
  assert.equal(stat.formatPublisherEarningsDisplay(0.039), "0.039000");
  assert.equal(stat.formatPublisherEarningsDisplay(0.1), "0.100000");
});

test("CPM/Views campaigns: strictly separated from zero-click curve and ARR", () => {
  // Ordinary Views campaign: 50,000 views at 1.50 CPM, split 60/30/10
  const viewAlloc = m.calculateV101ChannelAllocation({
    billingKind: "view",
    units: 50000,
    ratePerThousand: "1.50",
    split: { publisherPercent: "60", platformPercent: "30", reservePercent: "10" },
  });
  assert.equal(viewAlloc.advertiserDebit, "75.00000000");
  assert.equal(viewAlloc.publisherAllocation, "45.00000000");
  assert.equal(viewAlloc.platformAllocation, "22.50000000");
  assert.equal(viewAlloc.reserveAllocation, "7.50000000");
  assert.equal(viewAlloc.reserveAdvanceApplied, false);

  const cpm = m.calculateDynamicEffectiveCpm({
    cumulativeEarnings: viewAlloc.publisherAllocation,
    validViews: 50000,
  });
  // Effective CPM should equal exactly 60% of 1.50 = 0.90000000 USDT
  assert.equal(cpm.effectiveCpmDecimal, "0.90000000");
  assert.equal(cpm.effectiveCpmDisplay6, "0.900000");
});
