import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const source = fs.readFileSync(path.join(process.cwd(), "src/lib/revenueSplitSettings.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", output)(module, module.exports);
const splits = module.exports;

test("Channel direct 15/10/75 split maps exactly to the authoritative settlement policy", () => {
  const stored = splits.channelStoredPolicyFromRevenueSplit(15, 10);
  assert.deepEqual(stored.split, { publisher: 15, reserve: 10, platform: 75 });
  assert.equal(stored.platform_margin_percent, 75);
  assert.equal(stored.safety_reserve_percent, 40);
  assert.deepEqual(
    splits.channelRevenueSplitFromStored(stored.platform_margin_percent, stored.safety_reserve_percent),
    { publisher_percent: 15, reserve_percent: 10, platform_percent: 75 },
  );
});

test("split validation rejects totals over 100 percent", () => {
  assert.throws(() => splits.assertDirectRevenueSplit(91, 10, "Test"), /cannot exceed 100%/);
});

test("Mini App stored decimals display as a 50/10/40 maximum envelope", () => {
  assert.deepEqual(splits.miniAppRevenueSplitFromStored("0.5", "0.1"), {
    publisher_percent: 50,
    reserve_percent: 10,
    platform_percent: 40,
  });
});
