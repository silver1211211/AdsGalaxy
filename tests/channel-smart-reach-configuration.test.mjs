import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: (name) => dependencies[name] ?? (() => { throw new Error(`unexpected dependency: ${name}`); })(),
  }, { filename: path });
  return module.exports;
}
const math = load("src/lib/channelAllocationMath.ts");
const policy = load("src/lib/channelPhase1FinancialPolicy.ts", { "@/lib/channelAllocationMath": math });
const smart = load("src/lib/channelSmartReachConfiguration.ts", {
  "@/lib/channelAllocationMath": math,
  "@/lib/channelPhase1FinancialPolicy": policy,
});
const enabled = { CHANNEL_PHASE1_FINANCIAL_ENABLED: "true", CHANNEL_SMART_REACH_CONFIG_ENABLED: "true" };
const input = { requestedMode: "smart_reach", maximumCpm: "0.10", campaignType: "clicks", campaignKind: "channel", teaserMode: "none", env: enabled };

test("Smart Reach stays disabled unless both flags are enabled", () => {
  assert.equal(smart.isSmartReachConfigurationEnabled({}), false);
  assert.equal(smart.isSmartReachConfigurationEnabled({ CHANNEL_SMART_REACH_CONFIG_ENABLED: "true" }), false);
  assert.equal(smart.isSmartReachConfigurationEnabled(enabled), true);
  assert.throws(() => smart.resolveSmartReachCreationConfiguration({ ...input, env: {} }), /disabled/);
});

test("standard CPC configuration remains unchanged", () => {
  assert.equal(smart.resolveSmartReachCreationConfiguration({ ...input, requestedMode: "", maximumCpm: null }).policyVersion, null);
  assert.equal(smart.resolveSmartReachCreationConfiguration({ ...input, requestedMode: "standard_cpc", maximumCpm: null }).smartReach, false);
  assert.throws(() => smart.resolveSmartReachCreationConfiguration({ ...input, requestedMode: "standard_cpc" }), /cannot_set/);
});

test("Smart Reach maximum boundaries start at exactly 0.10 CPM", () => {
  for (const maximumCpm of ["0.10", "0.50"]) {
    const actual = smart.resolveSmartReachCreationConfiguration({ ...input, maximumCpm });
    assert.equal(actual.maxCpm, `${maximumCpm}000000`.slice(0, 10));
    assert.equal(actual.effectiveCpm, "0.10000000");
    assert.equal(actual.billingMode, "smart_reach");
    assert.equal(actual.policyVersion, smart.SMART_REACH_POLICY_VERSION);
    assert.equal(actual.lastEvaluatedAt, null);
  }
});

test("Smart Reach rejects invalid maximum bids", () => {
  for (const maximumCpm of ["0.09999999", "0.50000001", "0", "-0.10", "NaN", "0.100000001", 0.25]) {
    assert.throws(() => smart.resolveSmartReachCreationConfiguration({ ...input, maximumCpm }), /invalid|out_of_range/);
  }
});

test("Smart Reach requires an eligible ordinary Channel CPC campaign", () => {
  for (const changes of [{ campaignType: "views" }, { campaignKind: "channel_growth" }, { teaserMode: "teaser_only" }]) {
    assert.throws(() => smart.resolveSmartReachCreationConfiguration({ ...input, ...changes }), /requires_standard_channel_cpc/);
  }
});

test("client cannot override financial policy or effective CPM", () => {
  for (const field of smart.SMART_REACH_INTERNAL_FIELDS) {
    assert.throws(() => smart.resolveSmartReachCreationConfiguration({ ...input, clientInternalFields: [field] }), /forbidden/);
  }
});

test("creation permits a zero-balance Smart Reach draft but preserves ordinary funding checks", () => {
  const route = readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
  assert.match(route, /!smartReach\.smartReach && Number\(walletRows\[0\]\?\.ad_balance \|\| 0\)/);
  assert.match(route, /const cpc = type === "clicks" \? submittedCpc : 0/);
  assert.match(route, /if \(!smartReach\.smartReach\) await evaluateCampaignAutomation/);
  assert.match(route, /smartReach\.policyVersion \|\| \(selectStandardCpcClickPolicy/);
});

test("manual approval holds Smart Reach delivery until billing exists", () => {
  const admin = readFileSync("src/app/api/admin/campaigns/route.ts", "utf8");
  const settlement = readFileSync("src/lib/channelUnifiedSettlement.ts", "utf8");
  assert.match(admin, /current\.financial_policy_version === SMART_REACH_POLICY_VERSION/);
  assert.match(admin, /status='paused',pause_reason='smart_reach_billing_pending'/);
  assert.match(settlement, /financial_policy_version===SMART_REACH_POLICY_VERSION/);
  assert.match(settlement, /smart_reach_billing_not_enabled/);
});
