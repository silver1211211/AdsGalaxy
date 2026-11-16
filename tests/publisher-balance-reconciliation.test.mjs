import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("src/lib/publisherBalanceReconciliation.ts", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const record = { exports: {} };
new Function("module", "exports", output)(record, record.exports);
const { decimalUnits, unitsDecimal, reconcileBalanceEventRows, reconcilePublisherBalanceEvents } = record.exports;

const opening = {
  id: 1, event_kind: "account_opened", source_event_key: "account_opened:7",
  source_system: "registration", policy_version: "balance-events-v1",
  available_before: "0.00000000", available_after: "0.00000000",
  locked_before: "0.00000000", locked_after: "0.00000000",
  delta_available: "0.00000000", delta_locked: "0.00000000",
};
const earned = {
  id: 2, event_kind: "balance_changed", source_event_key: "channel:2:publisher",
  source_system: "channel", policy_version: "v1",
  available_before: "0.00000000", available_after: "2.00000000",
  locked_before: "0.00000000", locked_after: "0.00000000",
  delta_available: "2.00000000", delta_locked: "0.00000000",
};
const reserved = {
  id: 3, event_kind: "balance_changed", source_event_key: "withdrawal:reserve:3",
  source_system: "withdrawal_request", policy_version: "v1",
  available_before: "2.00000000", available_after: "1.00000000",
  locked_before: "0.00000000", locked_after: "1.00000000",
  delta_available: "-1.00000000", delta_locked: "1.00000000",
};

function dbFor(events, { available = "1.00000000", locked = "1.00000000", pending = "1.00000000", installed = 1 } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM users")) return [[{ balance_available: available, balance_locked: locked }]];
      if (sql.includes("information_schema.tables")) return [[{ present: installed }]];
      if (sql.includes("FROM withdrawals")) return [[{ amount: pending }]];
      if (sql.includes("FROM publisher_balance_events") && sql.includes("ORDER BY id LIMIT ?")) {
        return [events.filter((row) => row.id > params[1]).slice(0, params[2])];
      }
      if (sql.includes("FROM publisher_balance_events")) return [[]];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

test("eight-decimal arithmetic preserves tiny balances and rejects lossy input", () => {
  assert.equal(decimalUnits("0.00000001"), 1n);
  assert.equal(decimalUnits("-0.00000001"), -1n);
  assert.equal(unitsDecimal(100000001n), "1.00000001");
  assert.throws(() => decimalUnits("0.000000001"), /invalid_financial_decimal/);
  assert.throws(() => decimalUnits("NaN"), /invalid_financial_decimal/);
});

test("opening, legitimate earning, and reservation reconcile without double counting", async () => {
  const result = await reconcilePublisherBalanceEvents(7, dbFor([opening, earned, reserved]));
  assert.equal(result.state, "ordinary_reconciled");
  assert.equal(result.expectedAvailable, "1.00000000");
  assert.equal(result.expectedLocked, "1.00000000");
  assert.equal(result.pendingWithdrawalLiability, "1.00000000");
  assert.equal(result.protectedIntegrity, "not_provisioned");
});

test("stored extra funds are an exact discrepancy", async () => {
  const result = await reconcilePublisherBalanceEvents(7, dbFor([opening, earned, reserved], { available: "11.00000000" }));
  assert.equal(result.state, "discrepancy");
  assert.equal(result.differenceAvailable, "10.00000000");
});

test("broken delta, missing opening, and missing source are separate outcomes", () => {
  assert.equal(reconcileBalanceEventRows([opening, { ...earned, delta_available: "3.00000000" }]).continuityBreakAt, 2);
  assert.equal(reconcileBalanceEventRows([earned]).openingPresent, false);
  assert.equal(reconcileBalanceEventRows([opening, { ...earned, source_event_key: null }]).sourceGaps, 1);
});

test("pending withdrawal shortfall is a discrepancy; unavailable ledger stays incomplete", async () => {
  const short = await reconcilePublisherBalanceEvents(7, dbFor([opening, earned, reserved], { pending: "2.00000000" }));
  assert.equal(short.state, "discrepancy");
  const unavailable = await reconcilePublisherBalanceEvents(7, dbFor([], { installed: 0 }));
  assert.equal(unavailable.state, "not_installed");
  assert.equal(unavailable.expectedAvailable, null);
});
