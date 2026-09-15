import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("deploy runner tracks successful migrations and validates checksums", () => {
  const source = read("deploy-vps.sh");
  assert.match(source, /adsfusion_schema_migrations/);
  assert.match(source, /sha256sum/);
  assert.match(source, /Applied migration checksum changed/);
  assert.match(source, /INSERT INTO \$MIGRATION_LEDGER/);
  assert.ok(source.indexOf('mysql -h "$DB_HOST"') < source.indexOf('INSERT INTO $MIGRATION_LEDGER (migration_name, checksum_sha256)'));
});

test("verified 0130 production schema bootstraps the legacy baseline", () => {
  const source = read("deploy-vps.sh");
  assert.match(source, /LEGACY_BASELINE="20260908_0130_broadcast_delivery_reliability\.sql"/);
  assert.match(source, /baseline_markers.*-eq 10/s);
  assert.match(source, /already covered by verified production baseline/);
});

test("historical campaign-title backfill is a true no-op when satisfied", () => {
  const source = read("db/migrations/20260707_0090_campaign_creative_title.sql");
  assert.match(source, /EXISTS\s*\(/);
  assert.match(source, /LIMIT 1/);
  assert.match(source, /'SELECT 1'/);
  assert.match(source, /PREPARE campaign_title_backfill_stmt/);
});
