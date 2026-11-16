import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const balanceSource = fs.readFileSync("src/lib/publisherBalanceReconciliation.ts", "utf8");
const balanceOutput = ts.transpileModule(balanceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const balanceModule = { exports: {} };
new Function("require", "module", "exports", balanceOutput)(() => { throw Error("unexpected import"); }, balanceModule, balanceModule.exports);
const { decimalUnits, unitsDecimal } = balanceModule.exports;

function loadCheck(snapshot, state = "ordinary_reconciled") {
  const source = fs.readFileSync("src/lib/withdrawalVerification.ts", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "./db") return { default: {} };
    if (name === "./publisherBalanceReconciliation") return {
      decimalUnits, unitsDecimal,
      reconcilePublisherBalanceEvents: async () => ({ state, actualAvailable: "10.00000000", actualLocked: "20.00000000", protectedIntegrity: "not_provisioned" }),
    };
    if (name === "./withdrawalFinancialSnapshot") return { withdrawalFinancialSnapshot: async () => snapshot };
    throw Error(`unexpected import ${name}`);
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const units = (value) => decimalUnits(value);
function snapshot({ earnings = "40.00000000", legacy = "0.00000000", paid = "10.00000000", pending = "20.00000000", referrals = 0, monetized = 0 } = {}) {
  return {
    units: { totalEarnings: units(earnings), legacyReferral: units(legacy), commission: 0n, pendingWithdrawals: units(pending), paidWithdrawals: units(paid) },
    amounts: { totalEarnings: earnings, channel: earnings, miniapp: "0.00000000", legacyReferral: legacy, commission: "0.00000000", joinReward: "0.00000000", promotion: "0.00000000", paidWithdrawals: paid, pendingWithdrawals: pending },
    directReferrals: referrals, monetizedReferrals: monetized,
  };
}
function db({ available = "10.00000000", locked = "20.00000000", totalWithdrawn = "10.00" } = {}) {
  return { query: async () => [[{ id: 17, user_id: 100, amount: "10.00000000", network: "BEP-20", refunded: 0, balance_available: available, balance_locked: locked, total_withdrawn: totalWithdrawn }]] };
}

test("paid withdrawals plus available and locked balances reconcile without double-counting pending", async () => {
  const result = await loadCheck(snapshot()).performWithdrawalVerification(17, db());
  assert.equal(result.status, "Review Passed");
  assert.equal(result.evidence.earnings_reconciliation.claimed_lifetime_total, "40.00000000");
  assert.equal(result.evidence.earnings_reconciliation.pending_withdrawals, "20.00000000");
});

test("one hundred millionth difference is exact and is flagged with complete history", async () => {
  const result = await loadCheck(snapshot({ earnings: "39.99999999" })).performWithdrawalVerification(17, db());
  assert.equal(result.status, "Financial Discrepancy");
  assert.equal(result.evidence.earnings_reconciliation.earnings_difference, "0.00000001");
});

test("missing opening history leaves an earnings mismatch for manual review, not a fraud verdict", async () => {
  const result = await loadCheck(snapshot({ earnings: "39.00000000" }), "incomplete").performWithdrawalVerification(17, db());
  assert.equal(result.status, "Manual Review");
  assert.equal(result.evidence.issues.find((item) => item.code === "lifetime_earnings_mismatch").severity, "warning");
});

test("legacy referral quality requires 1% of distinct referred users to monetize", async () => {
  const check = loadCheck(snapshot({ legacy: "1.00000000", referrals: 201, monetized: 1 }));
  const result = await check.performWithdrawalVerification(17, db());
  assert.equal(result.status, "Manual Review");
  assert.equal(result.evidence.referral_quality.required_count, 3);
  assert.match(result.evidence.referral_quality.reason, /1%/);
  assert.equal(check.evaluateReferralQuality(200, 1, true).rule_passed, false);
  assert.equal(check.evaluateReferralQuality(100, 1, true).rule_passed, true);
  assert.equal(check.evaluateReferralQuality(1000, 0, false).rule_applied, false);
});

test("missing ledger source fails closed instead of substituting zero", async () => {
  const check = loadCheck(null);
  await assert.rejects(check.performWithdrawalVerification(17, db()));
});
