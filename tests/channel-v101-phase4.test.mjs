import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const loadedCache = new Map();

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
    return {};
  };
  new Function("module", "exports", "require", "process", output)(mod, mod.exports, customRequire, process);
  loadedCache.set(file, mod.exports);
  return mod.exports;
}

const stability = load("src/lib/channelTrustFraudStability.ts");

test("Task B — Slow trust score adjustments: bounded to +/- 1.0 point per rolling 24 hours", () => {
  const baseScore = 65.0;

  // 1. Single routine negative event requesting -10.0 penalty
  const res1 = stability.calculateRollingTrustAdjustment({
    currentScore: baseScore,
    proposedDelta: -10.0,
    appliedDeltaIn24h: 0.0,
    historicalEvidence: { postCount: 5, activeDays: 7, windowDays: 7 },
  });
  assert.equal(res1.finalDelta, -1.0, "Routine negative adjustment must be capped at -1.0 pt");
  assert.equal(res1.newScore, 64.0);
  assert.equal(res1.capped, true);

  // 2. Multiple events within one hour: after -0.6 applied, another -10.0 requested
  const res2 = stability.calculateRollingTrustAdjustment({
    currentScore: 64.4,
    proposedDelta: -10.0,
    appliedDeltaIn24h: -0.6,
    historicalEvidence: { postCount: 5, activeDays: 7, windowDays: 7 },
  });
  assert.equal(res2.finalDelta, -0.4, "Remaining negative headroom is -0.4 pt");
  assert.equal(res2.newScore, 64.0);
  assert.equal(res2.capped, true);

  // 3. When rolling 24h limit is already reached (-1.0 applied)
  const res3 = stability.calculateRollingTrustAdjustment({
    currentScore: 64.0,
    proposedDelta: -5.0,
    appliedDeltaIn24h: -1.0,
    historicalEvidence: { postCount: 5, activeDays: 7, windowDays: 7 },
  });
  assert.equal(res3.finalDelta, 0.0, "No further trust drop allowed once -1.0 is reached in 24h");
  assert.equal(res3.newScore, 64.0);
  assert.equal(res3.capped, true);

  // 4. Positive recovery capped at +1.0 point per 24h
  const res4 = stability.calculateRollingTrustAdjustment({
    currentScore: 60.0,
    proposedDelta: 5.0,
    appliedDeltaIn24h: 0.0,
    historicalEvidence: { postCount: 5, activeDays: 7, windowDays: 7 },
  });
  assert.equal(res4.finalDelta, 1.0, "Trust recovery capped at +1.0 pt");
  assert.equal(res4.newScore, 61.0);
  assert.equal(res4.capped, true);

  // 5. Rolling boundary reset (appliedDeltaIn24h = 0 after window expires)
  const res5 = stability.calculateRollingTrustAdjustment({
    currentScore: 64.0,
    proposedDelta: -0.8,
    appliedDeltaIn24h: 0.0,
    historicalEvidence: { postCount: 4, activeDays: 5, windowDays: 7 },
  });
  assert.equal(res5.finalDelta, -0.8, "After window expires, fresh -1.0 headroom opens");
  assert.equal(res5.newScore, 63.2);
  assert.equal(res5.capped, false);
});

test("Task B — Historical evidence requirement: insufficient activity preserves current score", () => {
  const currentTrust = 72.5;

  // Insufficient posts: only 1 post in 7 days (threshold is 3)
  const res1 = stability.calculateRollingTrustAdjustment({
    currentScore: currentTrust,
    proposedDelta: -5.0,
    appliedDeltaIn24h: 0.0,
    historicalEvidence: { postCount: 1, activeDays: 1, windowDays: 7 },
  });
  assert.equal(res1.finalDelta, 0.0, "Insufficient posts must result in zero trust delta");
  assert.equal(res1.newScore, currentTrust, "Score preserved");
  assert.equal(res1.preservationReason, "insufficient_historical_evidence_preserved");

  // Zero active days
  const res2 = stability.calculateRollingTrustAdjustment({
    currentScore: currentTrust,
    proposedDelta: -8.0,
    appliedDeltaIn24h: 0.0,
    historicalEvidence: { postCount: 0, activeDays: 0, windowDays: 7 },
  });
  assert.equal(res2.finalDelta, 0.0);
  assert.equal(res2.newScore, currentTrust);

  // Sufficient evidence: 3 posts and 2 active days
  const res3 = stability.calculateRollingTrustAdjustment({
    currentScore: currentTrust,
    proposedDelta: -0.5,
    appliedDeltaIn24h: 0.0,
    historicalEvidence: { postCount: 3, activeDays: 2, windowDays: 7 },
  });
  assert.equal(res3.finalDelta, -0.5, "Sufficient evidence permits routine adjustment");
  assert.equal(res3.newScore, 72.0);
});

test("Task B & E — Severe confirmed fraud and manual admin overrides bypass routine limits", () => {
  // Manual admin override
  const adminRes = stability.calculateRollingTrustAdjustment({
    currentScore: 80.0,
    proposedDelta: -30.0,
    appliedDeltaIn24h: -1.0,
    isManualAdmin: true,
  });
  assert.equal(adminRes.finalDelta, -30.0, "Manual admin override can apply arbitrary adjustment");
  assert.equal(adminRes.newScore, 50.0);
  assert.equal(adminRes.preservationReason, "manual_admin_override");

  // Confirmed severe fraud exception
  const severeRes = stability.calculateRollingTrustAdjustment({
    currentScore: 75.0,
    proposedDelta: -45.0,
    appliedDeltaIn24h: -1.0,
    isConfirmedSevereFraud: true,
  });
  assert.equal(severeRes.finalDelta, -45.0, "Confirmed severe fraud bypasses routine 1-point cap");
  assert.equal(severeRes.newScore, 30.0);
  assert.equal(severeRes.classification, "confirmed_serious_fraud");
});

test("Task C — Fraud-risk score stabilization: maximum 3 points increase per rolling 24 hours & deduplication", () => {
  const currentRisk = 20.0;

  // 1. Single suspicious signal requesting +15.0 risk increase
  const res1 = stability.calculateRollingRiskAdjustment({
    currentRiskScore: currentRisk,
    proposedIncrease: 15.0,
    appliedIncreaseIn24h: 0.0,
  });
  assert.equal(res1.finalIncrease, 3.0, "Routine risk increase must be strictly capped at +3.0 pts/24h");
  assert.equal(res1.newRiskScore, 23.0);
  assert.equal(res1.capped, true);

  // 2. Subsequent signal within 24h after +2.0 already applied
  const res2 = stability.calculateRollingRiskAdjustment({
    currentRiskScore: 22.0,
    proposedIncrease: 10.0,
    appliedIncreaseIn24h: 2.0,
  });
  assert.equal(res2.finalIncrease, 1.0, "Remaining 24h risk headroom is +1.0 pt");
  assert.equal(res2.newRiskScore, 23.0);

  // 3. Repeated evaluations with 24h cap exhausted
  const res3 = stability.calculateRollingRiskAdjustment({
    currentRiskScore: 23.0,
    proposedIncrease: 8.0,
    appliedIncreaseIn24h: 3.0,
  });
  assert.equal(res3.finalIncrease, 0.0, "No further risk increase permitted once +3.0 is reached in 24h");
  assert.equal(res3.newRiskScore, 23.0);

  // 4. Incident deduplication: duplicate incident key is skipped
  const processedKeys = new Set(["channel:123:abnormal_view_spike:post:456"]);
  const res4 = stability.calculateRollingRiskAdjustment({
    currentRiskScore: 20.0,
    proposedIncrease: 2.0,
    appliedIncreaseIn24h: 0.0,
    deduplicationKey: "channel:123:abnormal_view_spike:post:456",
    alreadyProcessedKeys: processedKeys,
  });
  assert.equal(res4.finalIncrease, 0.0, "Duplicate incident must yield 0 increase");
  assert.equal(res4.skippedDuplicate, true);
  assert.equal(res4.reason, "duplicate_incident_skipped");

  // 5. Gradual recovery: up to -1.5 points per 24h
  const res5 = stability.calculateRollingRiskAdjustment({
    currentRiskScore: 40.0,
    proposedIncrease: -5.0,
    appliedIncreaseIn24h: 0.0,
  });
  assert.equal(res5.finalIncrease, -1.5, "Gradual risk recovery capped at -1.5 pts/24h");
  assert.equal(res5.newRiskScore, 38.5);
});

test("Task D & H — Zero-click & CTR decriminalization and reserve view eligibility", () => {
  // Outdated heuristics check
  assert.equal(stability.isZeroClickOrLowCtrHeuristic("zero_engagement_500"), true);
  assert.equal(stability.isZeroClickOrLowCtrHeuristic("zero_engagement_1000"), true);
  assert.equal(stability.isZeroClickOrLowCtrHeuristic("near_zero_ctr"), true);
  assert.equal(stability.isZeroClickOrLowCtrHeuristic("clicks_above_views"), false);
  assert.equal(stability.isZeroClickOrLowCtrHeuristic("click_burst"), false);

  // Signal classifications
  assert.equal(stability.classifyV101Signal("zero_engagement_1000", "high"), "normal_traffic");
  assert.equal(stability.classifyV101Signal("near_zero_ctr", "medium"), "normal_traffic");
  assert.equal(stability.classifyV101Signal("extreme_ctr", "critical", { ctr: 0.25 }), "statistical_anomaly");
  assert.equal(stability.classifyV101Signal("extreme_ctr", "critical", { ctr: 0.65 }), "suspicious_activity");
  assert.equal(stability.classifyV101Signal("clicks_above_views", "critical"), "confirmed_invalid_engagement");

  // Reserve view eligibility on CPC: 500, 1,000, 10,000 views with 0 clicks are 100% eligible!
  const el500 = stability.validateViewReserveEligibility({ views: 500, clicks: 0 });
  assert.equal(el500.isEligible, true);
  assert.equal(el500.eligibleViews, 500n);
  assert.equal(el500.classification, "normal_traffic");

  const el1000 = stability.validateViewReserveEligibility({ views: 1000, clicks: 0 });
  assert.equal(el1000.isEligible, true);
  assert.equal(el1000.eligibleViews, 1000n);

  const el10k = stability.validateViewReserveEligibility({ views: 10000, clicks: 0 });
  assert.equal(el10k.isEligible, true);
  assert.equal(el10k.eligibleViews, 10000n);

  // Technical bot burst is excluded
  const botEl = stability.validateViewReserveEligibility({ views: 2000, clicks: 10, hasSevereBotPattern: true });
  assert.equal(botEl.isEligible, false);
  assert.equal(botEl.eligibleViews, 0n);
  assert.equal(botEl.excludedViews, 2000n);
  assert.equal(botEl.classification, "confirmed_invalid_engagement");
});

test("Task F — Financial reversal authorization: heuristic alerts cannot trigger irreversible clawbacks", () => {
  // 1. Unconfirmed critical_fraud heuristic alert
  const auth1 = stability.isFinancialReversalAuthorized("critical_fraud");
  assert.equal(auth1.isAuthorized, false, "Heuristic critical_fraud must NOT authorize clawbacks");
  assert.equal(auth1.action, "provisional_hold", "Enters provisional hold for review");

  // 2. Suspicious activity
  const auth2 = stability.isFinancialReversalAuthorized("suspicious");
  assert.equal(auth2.isAuthorized, false);
  assert.equal(auth2.action, "provisional_hold");

  // 3. Clean / low quality
  const auth3 = stability.isFinancialReversalAuthorized("low_quality");
  assert.equal(auth3.isAuthorized, false);
  assert.equal(auth3.action, "monitor_only");

  // 4. Formally verified confirmed_fraud
  const auth4 = stability.isFinancialReversalAuthorized("confirmed_fraud");
  assert.equal(auth4.isAuthorized, true, "Verified confirmed_fraud authorizes financial reversal");
  assert.equal(auth4.action, "reverse_settlement");

  // 5. Manual administrator authorization
  const auth5 = stability.isFinancialReversalAuthorized("suspicious", { manualAdminApproval: true });
  assert.equal(auth5.isAuthorized, true, "Manual admin approval authorizes reversal");
  assert.equal(auth5.action, "reverse_settlement");
});

test("Task G — Bounded quality multiplier: strictly clamped to [0.95, 1.05] with trust <= +/-1%", () => {
  // 1. Platform baseline neutral scores (60, 60, 60)
  const neutral = stability.calculateV101BoundedQualityMultiplier({
    trustScore: 60,
    trafficQualityScore: 60,
    ctrScore: 60,
  });
  assert.equal(neutral.multiplierDecimal, "1.00000000", "Baseline 60 yields exactly 1.00000000");
  assert.equal(neutral.adjustmentPercent, "0.0000");

  // 2. Worst-case scores (0, 0, 0, 0, 0)
  const worst = stability.calculateV101BoundedQualityMultiplier({
    trustScore: 0,
    trafficQualityScore: 0,
    ctrScore: 0,
    consistencyScore: 0,
    retentionScore: 0,
  });
  assert.equal(worst.multiplierDecimal, "0.95000000", "Must never fall below 0.95000000");
  assert.equal(worst.adjustmentPercent, "-5.0000");

  // 3. Best-case scores (100, 100, 100, 100, 100)
  const best = stability.calculateV101BoundedQualityMultiplier({
    trustScore: 100,
    trafficQualityScore: 100,
    ctrScore: 100,
    consistencyScore: 100,
    retentionScore: 100,
  });
  assert.equal(best.multiplierDecimal, "1.05000000", "Must never exceed 1.05000000");
  assert.equal(best.adjustmentPercent, "5.0000");

  // 4. Trust-only influence: trust = 0, but traffic and CTR at baseline (60, 60)
  const minTrustOnly = stability.calculateV101BoundedQualityMultiplier({
    trustScore: 0,
    trafficQualityScore: 60,
    ctrScore: 60,
  });
  assert.equal(minTrustOnly.trustContributionPercent, "-1.0000", "Trust alone contributes at most -1.0%");
  assert.equal(minTrustOnly.multiplierDecimal, "0.99000000");

  // 5. Trust-only max: trust = 100, traffic and CTR at baseline (60, 60)
  const maxTrustOnly = stability.calculateV101BoundedQualityMultiplier({
    trustScore: 100,
    trafficQualityScore: 60,
    ctrScore: 60,
  });
  assert.equal(maxTrustOnly.trustContributionPercent, "1.0000", "Trust alone contributes at most +1.0%");
  assert.equal(maxTrustOnly.multiplierDecimal, "1.01000000");
});
