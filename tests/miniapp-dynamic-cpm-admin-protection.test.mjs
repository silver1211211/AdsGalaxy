import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadProtection() {
  const source = read("src/lib/protectedAdminSettings.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", output)(module, module.exports);
  return module.exports;
}

const protection = loadProtection();

test("normal admin mutation protects all Mini App dynamic CPM v2 internals except the paired envelope", () => {
  const protectedKeys = [
    "miniapp_publisher_cpm_v2_geo_multipliers",
    "miniapp_publisher_cpm_v2_absolute_cpm_cap",
    "miniapp_publisher_cpm_v2_required_margin_share",
    "miniapp_publisher_cpm_v2_frequency_decay_rate",
    "miniapp_publisher_cpm_v2_frequency_zero_after",
    "miniapp_publisher_cpm_v2_quality_factor_min",
    "miniapp_publisher_cpm_v2_quality_factor_max",
    "miniapp_publisher_cpm_v2_trust_factor_min",
    "miniapp_publisher_cpm_v2_trust_factor_max",
    "miniapp_publisher_cpm_v2_fraud_factor_min",
    "miniapp_publisher_cpm_v2_fraud_factor_max",
    "miniapp_publisher_cpm_v2_formula_version",
  ];
  assert.deepEqual(protection.protectedAdminSettingKeys(protectedKeys), protectedKeys);
  assert.equal(protection.isProtectedAdminSettingKey("MINIAPP_PUBLISHER_CPM_V2_MAX_SHARE"), false);
  assert.equal(protection.isProtectedAdminSettingKey("miniapp_publisher_cpm_v2_reserve_share"), false);
  assert.equal(protection.isProtectedAdminSettingKey("miniapp_internal_min_cpm"), false);
});

test("settings API blocks protected single and atomic mutations before database writes", () => {
  const route = read("src/app/api/admin/settings/route.ts");
  const atomicGuard = route.indexOf("const protectedKeys = protectedAdminSettingKeys");
  const atomicWrite = route.indexOf("INSERT INTO settings", atomicGuard);
  const singleGuard = route.indexOf("if (isMiniAppDynamicCpmSettingKey(key))");
  const genericWrite = route.lastIndexOf("UPDATE settings SET value");
  assert.ok(atomicGuard > 0 && atomicGuard < atomicWrite);
  assert.ok(singleGuard > 0 && singleGuard < genericWrite);
  assert.match(route, /status: 403/);
  assert.match(route, /atomicSettings\.every\(\(\[settingKey\]\) => MINIAPP_REVENUE_SPLIT_KEYS\.has/);
  assert.match(route, /must be submitted together/);
});

test("admin UI exposes only the Mini App envelope and does not render protected internals", () => {
  const page = read("src/app/admin/settings/page.tsx");
  assert.match(page, /Mini App Revenue Split/);
  assert.match(page, /Publisher max/);
  assert.match(page, /dynamic maximum; payout may be lower or zero/);
  assert.doesNotMatch(page, /miniapp_publisher_cpm_v2_geo_multipliers/);
  assert.doesNotMatch(page, /miniapp_publisher_cpm_v2_absolute_cpm_cap/);
});

test("settings API hides storage knobs and records every supported split change", () => {
  const route = read("src/app/api/admin/settings/route.ts");
  assert.match(route, /!CHANNEL_SETTLEMENT_PERCENT_KEYS\.has\(row\.key\)/);
  assert.match(route, /!MINIAPP_INTERNAL_SPLIT_KEYS\.has\(row\.key\)/);
  assert.match(route, /bot_revenue_split_updated/);
  assert.match(route, /channel_revenue_split_updated/);
  assert.match(route, /miniapp_revenue_split_updated/);
});

test("protection does not alter formula defaults or historical settlements", () => {
  const engine = read("src/lib/miniappPublisherCpmEngine.ts");
  const migration = read("db/migrations/20260902_0124_miniapp_dynamic_cpm_v2.sql");
  assert.match(engine, /max_publisher_share:\.5/);
  assert.match(engine, /absolute_publisher_cpm_cap:11/);
  assert.doesNotMatch(migration, /UPDATE miniapp_internal_ad_impressions|UPDATE miniapp_earnings_settlements/);
});
