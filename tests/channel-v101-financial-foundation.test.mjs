import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Offline, pure tests: only reads source files; no DB, network, Telegram or PM2.
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
const D = m.unitsToDecimal;
const split60 = { publisherPercent: "60", platformPercent: "30", reservePercent: "10" };

function calc(grossDebit, s = split60) {
  const r = m.calculateDirectGrossSplit({ grossDebit, ...s });
  assert.equal(r.publisherBase + r.platform + r.reserveBase, r.debit, "conservation");
  assert.ok(r.publisherBase >= 0n && r.platform >= 0n && r.reserveBase >= 0n, "non-negative");
  return { publisher: D(r.publisherBase), platform: D(r.platform), reserve: D(r.reserveBase), debit: D(r.debit) };
}

test("60/30/10 on 100, 65 and 0.065 USDT", () => {
  assert.deepEqual(calc("100"), { publisher: "60.00000000", platform: "30.00000000", reserve: "10.00000000", debit: "100.00000000" });
  assert.deepEqual(calc("65"), { publisher: "39.00000000", platform: "19.50000000", reserve: "6.50000000", debit: "65.00000000" });
  assert.deepEqual(calc("0.065"), { publisher: "0.03900000", platform: "0.01950000", reserve: "0.00650000", debit: "0.06500000" });
});

test("administrator 70/25/5 gross split conserves exactly on 100 USDT", () => {
  assert.deepEqual(calc("100", { publisherPercent: 70, platformPercent: 25, reservePercent: 5 }),
    { publisher: "70.00000000", platform: "25.00000000", reserve: "5.00000000", debit: "100.00000000" });
});

test("alternative administrator split 65/25/10 and 50/50/0", () => {
  assert.deepEqual(calc("100", { publisherPercent: 65, platformPercent: 25, reservePercent: 10 }),
    { publisher: "65.00000000", platform: "25.00000000", reserve: "10.00000000", debit: "100.00000000" });
  assert.deepEqual(calc("0.00000001", { publisherPercent: 50, platformPercent: 50, reservePercent: 0 }),
    { publisher: "0.00000001", platform: "0.00000000", reserve: "0.00000000", debit: "0.00000001" });
});

test("invalid splits, negatives, non-numeric, non-finite and missing settings are rejected", () => {
  const bad = (s, re) => assert.throws(() => m.calculateDirectGrossSplit({ grossDebit: "1", ...s }), re);
  bad({ publisherPercent: 60, platformPercent: 40, reservePercent: 10 }, /split_percent_total_not_100/);
  bad({ publisherPercent: 60, platformPercent: 30, reservePercent: 9 }, /split_percent_total_not_100/);
  bad({ publisherPercent: -10, platformPercent: 90, reservePercent: 20 }, /split_percent_out_of_range/);
  bad({ publisherPercent: "abc", platformPercent: 30, reservePercent: 10 }, /publisher_percent_invalid/);
  bad({ publisherPercent: NaN, platformPercent: 30, reservePercent: 10 }, /publisher_percent_not_finite/);
  bad({ publisherPercent: Infinity, platformPercent: 30, reservePercent: 10 }, /publisher_percent_not_finite/);
  bad({ publisherPercent: 60, platformPercent: undefined, reservePercent: 10 }, /platform_percent_missing/);
  bad({ publisherPercent: "", platformPercent: 30, reservePercent: 10 }, /publisher_percent_missing/);
  for (const g of [-1, "-0.1", NaN, "x", null, undefined]) {
    assert.throws(() => m.calculateDirectGrossSplit({ grossDebit: g, ...split60 }));
  }
});

test("zero, tiny, large amounts and rounding remainders always conserve", () => {
  assert.deepEqual(calc("0"), { publisher: "0.00000000", platform: "0.00000000", reserve: "0.00000000", debit: "0.00000000" });
  assert.equal(calc("0.00000001").publisher, "0.00000001"); // leftover unit goes to largest remainder (publisher)
  assert.equal(calc("0.00000002").debit, "0.00000002");
  assert.equal(calc("0.00000003").debit, "0.00000003");
  calc("999999999999.99999999");
  const thirds = { publisherPercent: "33.33333334", platformPercent: "33.33333333", reservePercent: "33.33333333" };
  for (const g of ["0.00000001", "0.00000007", "1", "123.45678901", "0.065"]) calc(g, thirds);
  // boundary: 5 units -> publisher 3.0, platform 1.5, reserve 0.5. Floors 3/1/0 leave one unit;
  // platform and reserve tie at .5, the fixed tie order (publisher, platform, reserve) gives it to platform.
  assert.deepEqual(calc("0.00000005"), { publisher: "0.00000003", platform: "0.00000002", reserve: "0.00000000", debit: "0.00000005" });
  // exhaustive small sweep for conservation
  for (let u = 0; u < 300; u++) calc(`0.${String(u).padStart(8, "0")}`);
});

test("stored legacy policy converts exactly to direct percentages", () => {
  assert.deepEqual(m.resolveDirectSplitFromStoredPolicy("30", "14.28571429"),
    { publisherPercent: "60.00000000", platformPercent: "30.00000000", reservePercent: "10.00000000" });
  assert.deepEqual(m.resolveDirectSplitFromStoredPolicy("75", "40"),
    { publisherPercent: "15.00000000", platformPercent: "75.00000000", reservePercent: "10.00000000" });
  // missing settings -> legacy defaults 40 / 10 => 54 / 40 / 6 (historical behaviour)
  assert.deepEqual(m.resolveDirectSplitFromStoredPolicy(undefined, null),
    { publisherPercent: "54.00000000", platformPercent: "40.00000000", reservePercent: "6.00000000" });
  assert.throws(() => m.resolveDirectSplitFromStoredPolicy("abc", "10"), /platform_margin_percent_invalid/);
  assert.throws(() => m.resolveDirectSplitFromStoredPolicy("101", "10"), /out_of_range/);
  assert.throws(() => m.resolveDirectSplitFromStoredPolicy("-1", "10"), /out_of_range/);
  const r = m.resolveDirectSplitFromStoredPolicy("30", "14.28571429");
  assert.doesNotThrow(() => m.validateDirectSplitPercents({ publisherPercent: r.publisherPercent, platformPercent: r.platformPercent, reservePercent: r.reservePercent }));
});

test("policy stays LEGACY unless explicitly opted in; legacy math unchanged", () => {
  for (const env of [{}, { CHANNEL_V101_ALLOCATION_ENABLED: "false" }, { CHANNEL_V101_ALLOCATION_ENABLED: "TRUE" }, { CHANNEL_V101_ALLOCATION_ENABLED: "1" }]) {
    const p = m.resolveChannelAllocationPolicy({ platformMarginValue: "40", poolReserveValue: "10", env });
    assert.equal(p.policy, "legacy");
    assert.equal(p.policyVersion, m.CHANNEL_POLICY_VERSION);
  }
  const on = m.resolveChannelAllocationPolicy({ platformMarginValue: "30", poolReserveValue: "14.28571429", env: { CHANNEL_V101_ALLOCATION_ENABLED: "true" } });
  assert.equal(on.policy, "v101");
  assert.equal(on.policyVersion, m.CHANNEL_V101_POLICY_VERSION);
  assert.notEqual(m.CHANNEL_V101_POLICY_VERSION, m.CHANNEL_POLICY_VERSION);
  assert.match(m.CHANNEL_V101_POLICY_VERSION, /^adsgalaxy-v1\.01/);
  assert.equal(m.CHANNEL_POLICY_VERSION, "channel-v1-margin40-pool-reserve10-quality-v1-round8");
  const legacy = m.calculateCurrentCanonicalAllocation({ advertiserDebit: "1.00000000", platformMarginPercent: "40", safetyReservePercent: "10", qualityWeight: "1" });
  assert.equal(D(legacy.publisher), "0.54000000");
  assert.equal(D(legacy.platform), "0.40000000");
  assert.equal(D(legacy.reserve), "0.06000000");
});

test("quality 0.95 / 1.00 / 1.05 on a 0.039 publisher click allocation", () => {
  const base = m.calculateDirectGrossSplit({ grossDebit: "0.065", ...split60 });
  const neg = m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "0.95" });
  assert.equal(D(neg.publisherFinal), "0.03705000");
  assert.equal(D(neg.reserveFinal), "0.00845000"); // 0.0065 + 0.00195 holdback
  assert.equal(D(neg.qualityAdjustmentSigned), "-0.00195000");
  const neutral = m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "1" });
  assert.equal(D(neutral.publisherFinal), "0.03900000");
  assert.equal(D(neutral.reserveFinal), "0.00650000");
  const pos = m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "1.05", authorizedBonusFunding: "1" });
  assert.equal(D(pos.publisherFinal), "0.04095000");
  assert.equal(D(pos.reserveFinal), "0.00455000");
  assert.equal(D(pos.bonusGranted), "0.00195000");
  for (const r of [neg, neutral, pos]) {
    assert.equal(r.publisherFinal + r.platform + r.reserveFinal, r.debit);
    assert.equal(D(r.platform), "0.01950000"); // platform never altered
  }
});

test("positive bonus needs an authorized funding source and never exceeds it or the event reserve", () => {
  const base = m.calculateDirectGrossSplit({ grossDebit: "0.065", ...split60 });
  const none = m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "1.05" });
  assert.equal(D(none.publisherFinal), "0.03900000");
  assert.equal(D(none.bonusGranted), "0.00000000");
  assert.equal(D(none.bonusDenied), "0.00195000");
  const partial = m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "1.05", authorizedBonusFunding: "0.001" });
  assert.equal(D(partial.bonusGranted), "0.00100000");
  assert.equal(D(partial.bonusDenied), "0.00095000");
  assert.equal(partial.publisherFinal + partial.platform + partial.reserveFinal, partial.debit);
  assert.throws(() => m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "1.05", authorizedBonusFunding: "-1" }), /negative/);
  // reserve-less split can never fund a bonus
  const noReserve = m.calculateDirectGrossSplit({ grossDebit: "1", publisherPercent: 70, platformPercent: 30, reservePercent: 0 });
  const r = m.calculateQualityAdjustedAllocation(noReserve, { qualityMultiplier: "1.05", authorizedBonusFunding: "100" });
  assert.equal(r.bonusGranted, 0n);
});

test("quality multipliers outside +/-5% are rejected; combiner cannot stack beyond the limit", () => {
  const base = m.calculateDirectGrossSplit({ grossDebit: "1", ...split60 });
  for (const q of ["0.9499", "1.0501", "0", "-1", "2", "abc", NaN, Infinity]) {
    assert.throws(() => m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: q }), /quality_multiplier/);
  }
  assert.equal(D(m.constrainQualityMultiplier("0.5")), "0.95000000");
  assert.equal(D(m.constrainQualityMultiplier("1.5")), "1.05000000");
  assert.equal(D(m.constrainQualityMultiplier("1.02")), "1.02000000");
  assert.throws(() => m.constrainQualityMultiplier(NaN));
  assert.equal(D(m.combineQualityMultipliers(["0.97", "0.97", "0.97"])), "0.95000000");
  assert.equal(D(m.combineQualityMultipliers(["1.04", "1.04"])), "1.05000000");
  assert.equal(D(m.combineQualityMultipliers(["0.98", "1.01"])), "0.99000000");
  assert.equal(D(m.combineQualityMultipliers([])), "1.00000000");
  assert.throws(() => m.combineQualityMultipliers(["0"]), /quality_factor_invalid/);
});

test("negative adjustments reconcile on tiny amounts too", () => {
  for (const g of ["0.00000001", "0.00000009", "0.065", "12345.6789"]) {
    const base = m.calculateDirectGrossSplit({ grossDebit: g, ...split60 });
    const r = m.calculateQualityAdjustedAllocation(base, { qualityMultiplier: "0.95" });
    assert.equal(r.publisherFinal + r.platform + r.reserveFinal, r.debit);
    assert.ok(r.publisherFinal >= 0n && r.reserveFinal >= r.reserveBase);
  }
});

test("CPC debit uses the actual campaign price: 65/80/100/120 per 1,000 and 0/5/20 clicks", () => {
  const price = (rate, units) => m.calculateChannelEngagementDebit({ billingKind: "click", units, ratePerThousand: rate });
  assert.equal(D(price(65, 1).debit), "0.06500000");
  assert.equal(price(65, 1).unitPrice, "0.06500000");
  assert.equal(D(price(65, 0).debit), "0.00000000");
  assert.equal(D(price(65, 5).debit), "0.32500000");
  assert.equal(D(price(65, 20).debit), "1.30000000");
  assert.equal(D(price(80, 20).debit), "1.60000000");
  assert.equal(D(price(100, 20).debit), "2.00000000");
  assert.equal(D(price(120, 20).debit), "2.40000000");
  const pubBase = (rate, units) => D(m.calculateDirectGrossSplit({ grossDebit: D(price(rate, units).debit), ...split60 }).publisherBase);
  assert.equal(pubBase(65, 20), "0.78000000");
  assert.equal(pubBase(80, 20), "0.96000000");
  assert.equal(pubBase(120, 20), "1.44000000");
});

test("CPM/Views debit and full allocation; no CPC reserve advance", () => {
  const r = m.calculateV101ChannelAllocation({ billingKind: "view", units: 12500, ratePerThousand: "1.5", split: split60 });
  assert.equal(r.advertiserDebit, "18.75000000");
  assert.equal(r.publisherAllocation, "11.25000000");
  assert.equal(r.platformAllocation, "5.62500000");
  assert.equal(r.reserveAllocation, "1.87500000");
  assert.equal(r.reserveAdvanceApplied, false);
  assert.equal(r.qualityAdjustment, "0.00000000");
  assert.equal(r.policyVersion, m.CHANNEL_V101_POLICY_VERSION);
  const tiny = m.calculateV101ChannelAllocation({ billingKind: "view", units: 1, ratePerThousand: "0.5", split: split60 });
  assert.equal(tiny.advertiserDebit, "0.00050000");
  assert.equal(tiny.unitPrice, "0.00050000");
  assert.throws(() => m.calculateChannelEngagementDebit({ billingKind: "teaser", units: 1, ratePerThousand: 1 }), /invalid_billing_kind/);
  assert.throws(() => m.calculateChannelEngagementDebit({ billingKind: "view", units: -1, ratePerThousand: 1 }), /invalid_units/);
  assert.throws(() => m.calculateChannelEngagementDebit({ billingKind: "view", units: 1.5, ratePerThousand: 1 }), /invalid_units/);
  assert.throws(() => m.calculateChannelEngagementDebit({ billingKind: "view", units: 1, ratePerThousand: 0 }), /invalid_rate/);
});

test("ledger-ready serialization: decimals, conservation, signed adjustment, legacy bucket stays zero", () => {
  const r = m.calculateV101ChannelAllocation({ billingKind: "click", units: 1, ratePerThousand: 65, split: split60, qualityMultiplier: "0.95" });
  assert.deepEqual(
    [r.advertiserDebit, r.publisherBaseAllocation, r.publisherAllocation, r.platformAllocation, r.reserveBaseAllocation, r.reserveAllocation, r.qualityAdjustment, r.qualityAdjustmentSigned],
    ["0.06500000", "0.03900000", "0.03705000", "0.01950000", "0.00650000", "0.00845000", "0.00000000", "-0.00195000"],
  );
  const sum = m.decimalToUnits(r.publisherAllocation) + m.decimalToUnits(r.platformAllocation) + m.decimalToUnits(r.reserveAllocation) + m.decimalToUnits(r.qualityAdjustment);
  assert.equal(sum, m.decimalToUnits(r.advertiserDebit));
  assert.equal(m.decimalToUnits(r.publisherAllocation), m.decimalToUnits(r.publisherBaseAllocation) + m.decimalToUnits(r.qualityAdjustmentSigned));
  assert.equal(m.decimalToUnits(r.reserveAllocation), m.decimalToUnits(r.reserveBaseAllocation) - m.decimalToUnits(r.qualityAdjustmentSigned));
  // deterministic: identical input -> identical output (stable for hashing / duplicate recognition)
  const again = m.calculateV101ChannelAllocation({ billingKind: "click", units: 1, ratePerThousand: 65, split: split60, qualityMultiplier: "0.95" });
  assert.equal(JSON.stringify(again), JSON.stringify(r));
});

test("source files: V1.01 helpers are inert, DB-free, and legacy callers untouched", () => {
  const math = fs.readFileSync(path.join(root, "src/lib/channelAllocationMath.ts"), "utf8");
  assert.doesNotMatch(math, /from "@\/lib\/db"|mysql2|INSERT |UPDATE |fetch\(/);
  for (const file of ["src/lib/channelFastBilling.ts", "src/lib/channelSettlement.ts", "src/lib/channelGrowth.ts", "src/lib/teaser.ts", "src/lib/channelAllocationLedger.ts", "src/app/api/admin/settings/route.ts"]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    const phase2Source = file === "src/lib/channelFastBilling.ts"
      ? src.replaceAll("CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED", "") : src;
    assert.doesNotMatch(phase2Source, /calculateV101ChannelAllocation|calculateDirectGrossSplit|resolveChannelAllocationPolicy|CHANNEL_V101/, `${file} must not use other V1.01 helpers in Phase 2`);
  }
  const guards = fs.readFileSync(path.join(root, "src/lib/schemaGuards.ts"), "utf8");
  const fn = guards.slice(guards.indexOf("isChannelV101LedgerSchemaReady"));
  assert.doesNotMatch(fn, /ALTER |CREATE |INSERT |UPDATE |DELETE /);
});

test("prepared migration is additive, data-free, and keeps legacy constraints", () => {
  const dir = path.join(root, "db/migrations");
  const file = fs.readdirSync(dir).filter((f) => f.includes("channel_v101_financial_foundation") && f.endsWith(".sql"));
  assert.equal(file.length, 1);
  const sql = fs.readFileSync(path.join(dir, file[0]), "utf8");
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|DATABASE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bRENAME\s+TABLE\b/im);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS quality_adjustment_signed DECIMAL\(24,8\) NULL/);
  assert.match(sql, /chk_channel_allocation_v101_signed/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS channel_reserve_treasury_ledger/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS channel_cpc_reserve_advances/);
  assert.match(sql, /UNIQUE KEY uniq_cpc_reserve_advance_campaign_publisher \(campaign_id, publisher_id\)/);
  assert.match(sql, /UNIQUE KEY uniq_reserve_treasury_idempotency/);
  assert.match(sql, /quality_multiplier BETWEEN 0\.95 AND 1\.05/);
});
