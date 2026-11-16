import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(source, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports,
    require: name => dependencies[name] ?? (() => { throw new Error(`unexpected_dependency_${name}`); })(),
  }, { filename: source });
  return module.exports;
}
const math = load("src/lib/channelAllocationMath.ts");
const policy = load("src/lib/channelPhase1FinancialPolicy.ts", { "@/lib/channelAllocationMath": math });

test("Phase 1 financial changes are disabled by default", () => {
  assert.equal(policy.isPhase1FinancialBackendEnabled({}), false);
  assert.equal(policy.isPhase1FinancialBackendEnabled({CHANNEL_PHASE1_FINANCIAL_ENABLED:"true"}), true);
});

test("Standard CPC allowance is a revolving $5 outstanding cap", () => {
  const first = policy.standardCpcAllowance({ issued: "3", recovered: "1", requested: "4", campaignKind: "standard_cpc" });
  assert.equal(first.outstandingDecimal, "2.00000000");
  assert.equal(first.capacityDecimal, "3.00000000");
  assert.equal(first.permittedDecimal, "3.00000000");
  const later = policy.standardCpcAllowance({ issued: "8", recovered: "5", requested: "2", campaignKind: "standard_cpc" });
  assert.equal(later.permittedDecimal, "2.00000000");
});

test("allowance excludes Smart Reach and CPM", () => {
  for (const campaignKind of ["smart_reach", "cpm"]) {
    assert.equal(policy.standardCpcAllowance({issued:"1",recovered:"0",requested:"1",campaignKind}).permitted, 0n);
  }
  assert.throws(() => policy.standardCpcAllowance({issued:"1",recovered:"2",requested:"1",campaignKind:"standard_cpc"}));
});

test("Smart Reach starts at ten cents and reprices only after evidence gates", () => {
  const base = { selectedMaximum:"0.50", activeCpm:"0.10", qualifiedImpressions:3000n,
    settledClicks:0n, observedMinutes:30n, minutesSinceLastReprice:30n };
  assert.equal(policy.smartReachCpm(base).nextDecimal,"0.20000000");
  assert.equal(policy.smartReachCpm({...base,qualifiedImpressions:2999n}).nextDecimal,"0.10000000");
  assert.equal(policy.smartReachCpm({...base,observedMinutes:29n}).nextDecimal,"0.10000000");
  assert.equal(policy.smartReachCpm({...base,minutesSinceLastReprice:29n}).nextDecimal,"0.10000000");
  assert.equal(policy.smartReachCpm({...base,activeCpm:"0.20",selectedMaximum:"0.25"}).nextDecimal,"0.25000000");
});

test("CTR ceilings use exact boundary comparisons and improve downward", () => {
  const base={selectedMaximum:"0.50",activeCpm:"0.50",qualifiedImpressions:10000n,observedMinutes:60n,minutesSinceLastReprice:60n};
  assert.equal(policy.smartReachCpm({...base,settledClicks:100n}).nextDecimal,"0.10000000");
  assert.equal(policy.smartReachCpm({...base,settledClicks:81n}).nextDecimal,"0.30000000");
  assert.equal(policy.smartReachCpm({...base,settledClicks:80n}).nextDecimal,"0.40000000");
  assert.equal(policy.smartReachCpm({...base,settledClicks:61n}).nextDecimal,"0.40000000");
  assert.equal(policy.smartReachCpm({...base,settledClicks:60n}).nextDecimal,"0.50000000");
});

test("Smart Reach impression charge conserves exact eight-decimal money", () => {
  const charge=policy.smartReachImpressionCharge({qualifiedNewViews:3n,activeCpm:"0.10"});
  assert.equal(charge.grossDecimal,"0.00030000");
  assert.equal(charge.publisherDecimal,"0.00018000");
  assert.equal(charge.platformDecimal,"0.00009000");
  assert.equal(charge.reserveDecimal,"0.00003000");
  const tiny=policy.smartReachImpressionCharge({qualifiedNewViews:1n,activeCpm:"0.11"});
  assert.equal(tiny.publisher+tiny.platform+tiny.reserve,tiny.gross);
});
