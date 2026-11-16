import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const mathSource = readFileSync("src/lib/channelAllocationMath.ts", "utf8");
const javascript = ts.transpileModule(mathSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", javascript)(module, module.exports);
const math = module.exports;
const handoff = readFileSync("src/lib/channelFastBilling.ts", "utf8");
const split = (gross, policy) => math.calculateDirectGrossSplit({
  grossDebit: gross, ...policy,
});
const sum = result => result.publisherBase + result.platform + result.reserveBase;

test("canonical fast-billing handoff uses the exact stored-policy helper", () => {
  assert.match(handoff, /resolveDirectSplitFromStoredPolicy\(settings\.margin, settings\.reserve\)/);
  assert.doesNotMatch(handoff, /const grossReserve = Number\(/);
  assert.match(handoff, /settings\?\.margin == null/);
  assert.match(handoff, /String\(settings\.margin\)\.trim\(\) === ""/);
});

test("live stored settings resolve to exact 60/30/10", () => {
  const policy = math.resolveDirectSplitFromStoredPolicy("30", "14.28571429");
  assert.deepEqual(policy, {
    publisherPercent: "60.00000000", platformPercent: "30.00000000",
    reservePercent: "10.00000000",
  });
  const result = split("100.00000000", policy);
  assert.deepEqual([result.publisherBase, result.platform, result.reserveBase].map(math.unitsToDecimal),
    ["60.00000000", "30.00000000", "10.00000000"]);
  assert.equal(sum(result), result.debit);
});

test("tiny gross charges and eight-decimal remainders conserve every unit", () => {
  const policy = math.resolveDirectSplitFromStoredPolicy("30", "14.28571429");
  for (const gross of ["0.00000001", "0.00000002", "0.00000003", "1.23456789"]) {
    const result = split(gross, policy);
    assert.equal(sum(result), math.decimalToUnits(gross));
  }
  assert.deepEqual(
    [split("0.00000001", policy).publisherBase, split("0.00000001", policy).platform, split("0.00000001", policy).reserveBase].map(math.unitsToDecimal),
    ["0.00000001", "0.00000000", "0.00000000"],
  );
});

test("previous floating-point edge preserves the reserve's exact unit", () => {
  const policy = math.resolveDirectSplitFromStoredPolicy("99.99999999", "50.00000000");
  assert.deepEqual(policy, {
    publisherPercent: "0.00000000", platformPercent: "99.99999999",
    reservePercent: "0.00000001",
  });
  const result = split("100.00000000", policy);
  assert.deepEqual([result.publisherBase, result.platform, result.reserveBase].map(math.unitsToDecimal),
    ["0.00000000", "99.99999999", "0.00000001"]);
  assert.equal(sum(result), result.debit);
});

test("invalid stored percentages fail closed", () => {
  for (const [margin, reserve] of [["101", "10"], ["-1", "10"], ["30", "101"], ["30", "junk"]]) {
    assert.throws(() => math.resolveDirectSplitFromStoredPolicy(margin, reserve));
  }
});
