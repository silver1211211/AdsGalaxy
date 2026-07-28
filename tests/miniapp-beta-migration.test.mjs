import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationName = "20260622_0011_add_miniapp_beta_access.sql";
const migration = readFileSync(`db/migrations/${migrationName}`, "utf8");
const deployment = readFileSync("deploy-vps.sh", "utf8");

test("0011 guards clean and partially applied schemas and safely reruns", () => {
  assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(migration, /TABLE_SCHEMA = DATABASE\(\)/);
  assert.match(migration, /TABLE_NAME = 'users'/);
  assert.match(migration, /COLUMN_NAME = 'miniapp_beta_access'/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /ADD COLUMN miniapp_beta_access TINYINT\(1\) NOT NULL DEFAULT 1/);
  assert.match(migration, /'SELECT 1'/);
  assert.match(migration, /PREPARE migration_stmt FROM @migration_sql/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE|REPLACE)\b/im);
});

test("0011 preserves its established backfill and deployment position", () => {
  assert.match(migration, /UPDATE users\s+SET miniapp_beta_access = 1\s+WHERE miniapp_beta_access <> 1/);
  assert.ok(deployment.indexOf(migrationName) >= 0);
  assert.ok(
    deployment.indexOf(migrationName)
      < deployment.indexOf("20260622_0012_add_advertiser_targeting_fields.sql")
  );
});
