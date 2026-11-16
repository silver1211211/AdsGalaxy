import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const runner = readFileSync("scripts/run-verified-migrations.mjs", "utf8");
const deployment = readFileSync("deploy-vps.sh", "utf8");
const allFiles = readdirSync("db/migrations").filter(name => name.endsWith(".sql")).sort();
const expected = [
  "20261101_0701_referral_revenue_commissions_compat.sql",
  "20261101_0800_publisher_balance_events.sql",
  "20261102_1200_channel_cpm_pending.sql",
  "20261102_1210_cpm_window_finalization.sql",
  "20261102_1220_cpm_allocation_plan.sql",
  "20261103_1200_channel_cpc_priority_scan.sql",
  "20261103_1230_channel_click_evidence.sql",
];

test("release migration selection includes required files in dependency order", () => {
  const allowlist = runner.match(/const V101_RELEASE_MIGRATIONS = \[([\s\S]*?)\];/);
  assert.ok(allowlist);
  const selected = [...allowlist[1].matchAll(/"([^"]+\.sql)"/g)].map(match => match[1]);
  assert.deepEqual(selected, expected);
  assert.ok(expected.every(name => allFiles.includes(name)));
  assert.ok(!selected.includes("20261101_0801_historical_financial_evidence_candidates.sql"));
  const selector = runner.match(/const pendingNames = allFiles\.filter\(([\s\S]*?)\n    \);/);
  assert.ok(selector);
  const actual = new Function("allFiles", "V101_RELEASE_MIGRATIONS",
    "return allFiles.filter(" + selector[1] + ");")(allFiles, selected);
  assert.deepEqual(actual.filter(name => name.startsWith("202611")), expected);
});

test("runner verifies schema, checksums, and postconditions before recording", () => {
  assert.match(runner, /record\.checksum !== currentChecksum/);
  assert.match(runner, /verifyTablesExist\(conn, spec\.tables\)/);
  assert.match(runner, /verifyIndexesExist\(conn, spec\.indexes\)/);
  assert.match(runner, /verifyTriggersExist\(conn, spec\.triggers\)/);
  assert.match(runner, /INSERT INTO \$\{LEDGER_TABLE\} \(migration_name, checksum_sha256\)/);
  for (const file of expected.slice(2)) assert.ok(runner.includes('"' + file + '": {'));
});

test("deployment invokes verified procedure before building", () => {
  const verify = deployment.indexOf('node "$APP_DIR/scripts/run-verified-migrations.mjs"');
  const build = deployment.indexOf('BUILD_DIR=".next-build"');
  assert.ok(verify > 0 && build > verify);
});
