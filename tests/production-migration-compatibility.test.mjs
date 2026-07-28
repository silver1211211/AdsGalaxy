import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const webhookMigration = read("db/migrations/20260727_0104_developer_webhook_v2_outbox.sql");
const descriptionMigration = read("db/migrations/20260728_0107_normalize_advertiser_transaction_description.sql");
const deployment = read("deploy-vps.sh");

const webhookColumns = [
  "secret_version",
  "previous_secret",
  "previous_secret_version",
  "previous_secret_expires_at",
  "secret_rotated_at",
  "event_id",
  "webhook_version",
  "signature_version",
  "signing_secret",
  "logical_delivery_key",
  "manual_retry_sequence",
  "claimed_at",
  "claim_token",
  "claim_expires_at",
  "last_attempt_at",
  "terminal_at",
  "manually_retried_from_id",
];

const webhookIndexes = [
  "uniq_developer_webhook_delivery_logical",
  "idx_developer_webhook_delivery_claim",
  "idx_developer_webhook_delivery_event_id",
  "idx_developer_webhook_delivery_manual_source",
];

test("0104 guards tables, columns, indexes, and its self-referencing foreign key", () => {
  assert.match(webhookMigration, /CREATE TABLE IF NOT EXISTS developer_webhook_action_audits/);
  assert.match(webhookMigration, /CREATE TABLE IF NOT EXISTS developer_reward_action_audits/);

  for (const column of webhookColumns) {
    assert.match(
      webhookMigration,
      new RegExp(`INFORMATION_SCHEMA\\.COLUMNS[\\s\\S]*?COLUMN_NAME = '${column}'[\\s\\S]*?ADD COLUMN ${column}`)
    );
  }
  for (const index of webhookIndexes) {
    assert.match(
      webhookMigration,
      new RegExp(`INFORMATION_SCHEMA\\.STATISTICS[\\s\\S]*?INDEX_NAME = '${index}'[\\s\\S]*?ADD (?:UNIQUE )?KEY ${index}`)
    );
  }
  assert.match(webhookMigration, /INFORMATION_SCHEMA\.REFERENTIAL_CONSTRAINTS/);
  assert.match(webhookMigration, /CONSTRAINT_NAME = 'fk_developer_webhook_delivery_manual_source'/);
});

test("0104 can safely rerun and complete an interrupted column/index sequence", () => {
  const guardedAlters = webhookMigration.match(/SET @ddl = IF\(/g) || [];
  const prepares = webhookMigration.match(/PREPARE migration_stmt FROM @ddl/g) || [];
  const deallocations = webhookMigration.match(/DEALLOCATE PREPARE migration_stmt/g) || [];

  assert.equal(guardedAlters.length, 23);
  assert.equal(prepares.length, guardedAlters.length);
  assert.equal(deallocations.length, guardedAlters.length);
  assert.doesNotMatch(webhookMigration, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE)\b/im);
});

test("0107 adds, normalizes, or no-ops while preserving existing values", () => {
  assert.match(descriptionMigration, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(descriptionMigration, /DATA_TYPE = 'text'/);
  assert.match(descriptionMigration, /IS_NULLABLE = 'YES'/);
  assert.match(descriptionMigration, /WHEN @description_exists = 0[\s\S]*ADD COLUMN description TEXT NULL AFTER type/);
  assert.match(descriptionMigration, /WHEN @description_is_compatible = 0[\s\S]*MODIFY COLUMN description TEXT NULL/);
  assert.match(descriptionMigration, /ELSE\s+'SELECT 1'/);
  assert.doesNotMatch(descriptionMigration, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|REPLACE)\b/i);
});

test("deployment orders reward, description, and bonus migrations through 0107", () => {
  const names = [
    "20260727_0103_production_miniapp_reward_events.sql",
    "20260727_0104_developer_webhook_v2_outbox.sql",
    "20260728_0105_add_advertiser_transaction_description.sql",
    "20260728_0106_deposit_bonus_promotion.sql",
    "20260728_0107_normalize_advertiser_transaction_description.sql",
  ];
  const positions = names.map((name) => deployment.indexOf(name));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("compatibility migrations use MariaDB 11.4 and MySQL 8.4 common SQL", () => {
  for (const migration of [webhookMigration, descriptionMigration]) {
    assert.match(migration, /PREPARE \w+ FROM @\w+/);
    assert.match(migration, /EXECUTE \w+/);
    assert.match(migration, /DEALLOCATE PREPARE \w+/);
    assert.doesNotMatch(migration, /\bADD\s+(?:COLUMN\s+)?IF\s+NOT\s+EXISTS\b/i);
    assert.doesNotMatch(migration, /\bJSON\s+DEFAULT\b/i);
  }
});
