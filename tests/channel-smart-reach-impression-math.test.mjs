import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports,
    require: name => dependencies[name] ?? (() => { throw new Error(`unexpected_dependency_${name}`); })(),
  }, { filename: path });
  return module.exports;
}
const math = load("src/lib/channelAllocationMath.ts");
const smart = load("src/lib/channelSmartReachImpressionMath.ts", { "@/lib/channelAllocationMath": math });
const base = { previouslyBilledViews: 0, verifiedEligibleViews: 1, effectiveCpm: "0.10000000", maximumCpm: "0.50000000" };

test("Smart Reach charges only newly verified impressions at the stored rate", () => {
  for (const [views, expected] of [[1, "0.00010000"], [100, "0.01000000"], [500, "0.05000000"], [1000, "0.10000000"]]) {
    assert.equal(smart.calculateSmartReachImpressionCharge({ ...base, verifiedEligibleViews: views }).chargeDecimal, expected);
  }
  assert.equal(smart.calculateSmartReachImpressionCharge({ ...base, previouslyBilledViews: 100, verifiedEligibleViews: 500 }).chargeDecimal, "0.04000000");
});

test("Smart Reach rejects stale, invalid and over-maximum observations", () => {
  for (const verifiedEligibleViews of [0, -1, 1.1, Number.NaN]) {
    assert.throws(() => smart.calculateSmartReachImpressionCharge({ ...base, verifiedEligibleViews }));
  }
  assert.throws(() => smart.calculateSmartReachImpressionCharge({ ...base, previouslyBilledViews: 1 }));
  assert.throws(() => smart.calculateSmartReachImpressionCharge({ ...base, effectiveCpm: "0.50000001" }));
});

test("Smart Reach uses exact eight-decimal rounding", () => {
  assert.equal(smart.calculateSmartReachImpressionCharge({ ...base, effectiveCpm: "0.12345678" }).chargeDecimal, "0.00012346");
  const first=smart.calculateSmartReachImpressionCharge({...base,effectiveCpm:"0.12345678"}).chargeUnits;
  const second=smart.calculateSmartReachImpressionCharge({...base,previouslyBilledViews:1,verifiedEligibleViews:2,
    effectiveCpm:"0.12345678"}).chargeUnits;
  const together=smart.calculateSmartReachImpressionCharge({...base,verifiedEligibleViews:2,
    effectiveCpm:"0.12345678"}).chargeUnits;
  assert.equal(first+second,together);
});
