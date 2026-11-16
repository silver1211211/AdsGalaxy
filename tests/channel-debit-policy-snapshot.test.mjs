import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("src/lib/channelFastBilling.ts", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const POLICY = "channel-v1-snapshot-margin-pool-reserve-quality-round8";

function loadWithDebit(row) {
  const calls = { sql: [], credits: [], safety: [] };
  const conn = {
    async query(sql) {
      calls.sql.push(sql);
      if (sql.includes("SELECT d.*,c.user_id advertiser_id")) return [[row]];
      if (sql.includes("FROM settings")) throw new Error("current settings must not reprice a historical debit");
      return [{ affectedRows: 1 }];
    },
  };
  const pool = {
    async query(sql) {
      calls.sql.push(sql);
      return [[{ id: row.id }]];
    },
  };
  const mocks = {
    "@/lib/db": { __esModule: true, default: pool },
    "@/lib/dbResilience": { withFinancialTransactionRetry: (fn) => fn(conn) },
    "@/lib/channelAllocationMath": { CHANNEL_DEBIT_SNAPSHOT_POLICY_VERSION: POLICY },
    "@/lib/channelBilling": { money: (x) => Math.round(x * 1e8) / 1e8 },
    "@/lib/publisherQuality": { getPublisherQuality: async () => ({ qualityWeight: 1 }) },
    "@/lib/revenueProtection": { recordPayoutSafetyCheck: async (x) => { calls.safety.push(x); return { status: "passed" }; } },
    "@/lib/earnings": { isZeroOrdinaryLockEnabled: () => false, creditSettledPublisherBalance: async (_db, userId, amount) => { calls.credits.push({ userId, amount }); return true; } },
    "@/lib/referralCommission": { recordReferralCommission: async () => ({ status: "no_referrer" }) },
    "@/lib/channelAllocationLedger": {
      calculateCurrentCanonicalAllocation: () => ({ debit: 10000000000n, publisher: 6000000000n, platform: 3000000000n, reserve: 1000000000n, qualityAdjustment: 0n }),
      unitsToDecimal: (x) => (Number(x) / 1e8).toFixed(8),
      shadowWriteChannelAllocation: async () => {},
    },
  };
  const record = { exports: {} };
  new Function("require", "module", "exports", "process", output)(
    (name) => mocks[name] ?? {},
    record,
    record.exports,
    process
  );
  return { settle: record.exports.settlePendingChannelPublisherCredits, calls };
}

const debit = {
  id: 93, source_key: "click:93", settlement_type: "click", campaign_id: 1,
  post_id: 2, channel_id: 3, publisher_id: 4, advertiser_id: 5,
  units: 1, unit_price: "100.00000000", advertiser_debit: "100.00000000",
  created_at: "2026-10-30 00:00:00", publisher_status: "pending",
};

test("legacy pending debit without a policy snapshot is not credited", async () => {
  const { settle, calls } = loadWithDebit({ ...debit, allocation_policy_version: null });
  const result = await settle(1);
  assert.equal(result.missingPolicy, 1);
  assert.equal(result.settled, 0);
  assert.deepEqual(calls.credits, []);
  assert.deepEqual(calls.safety, []);
});

test("delayed settlement uses saved policy even if current settings changed", async () => {
  const { settle, calls } = loadWithDebit({
    ...debit, allocation_policy_version: POLICY,
    platform_margin_percent: "30.00000000",
    safety_reserve_percent: "14.28571429",
  });
  const result = await settle(1);
  assert.equal(result.missingPolicy, 0);
  assert.equal(result.settled, 1);
  assert.equal(result.publisherCredited, 60);
  assert.deepEqual(calls.credits, [{ userId: 4, amount: 60 }]);
  assert.equal(calls.safety[0].platformShare, 30);
  assert.equal(calls.safety[0].reserveShare, 10);
  assert.ok(calls.sql.every((sql) => !sql.includes("FROM settings")));
});
