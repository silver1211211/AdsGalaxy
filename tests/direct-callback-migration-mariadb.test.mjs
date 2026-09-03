import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const client = process.env.MARIADB_TEST_CLIENT;
const password = process.env.MARIADB_TEST_PASSWORD;
const port = process.env.MARIADB_TEST_PORT || "3407";
const migration = readFileSync("db/migrations/20260801_0109_direct_miniapp_reward_callbacks.sql", "utf8");
const createCallbackTable = migration.slice(0, migration.indexOf("ALTER TABLE developer_webhook_deliveries"));

const baseSchema = `
CREATE TABLE miniapps (id BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE developer_webhook_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  webhook_id BIGINT UNSIGNED NULL,
  application_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  event_id VARCHAR(120) NOT NULL,
  webhook_version VARCHAR(10) NOT NULL DEFAULT 'v2',
  signature_version VARCHAR(10) NOT NULL DEFAULT 'v2',
  secret_version INT UNSIGNED NOT NULL DEFAULT 1,
  signing_secret VARCHAR(120) NULL,
  logical_delivery_key VARCHAR(255) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending','retrying','delivered','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  claim_token VARCHAR(64) NULL,
  claimed_at DATETIME NULL,
  claim_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_delivery_logical_key (logical_delivery_key)
) ENGINE=InnoDB;
INSERT INTO miniapps(id) VALUES (13);
INSERT INTO developer_webhook_deliveries
  (webhook_id,application_id,event_type,event_id,logical_delivery_key,payload)
VALUES (7,9,'reward.eligible','rwe_existing','developer-existing','{}');
`;

function sql(database, input, raw = false) {
  const args = ["--host=127.0.0.1", `--port=${port}`, "--user=root", `--password=${password}`];
  if (database) args.push(database);
  if (raw) args.push("--batch", "--skip-column-names");
  return execFileSync(client, args, { input, encoding: "utf8" }).trim();
}

test("guarded migration succeeds twice and recovers a partial MariaDB 11.4 schema", { skip: !client || !password }, () => {
  sql(null, "DROP DATABASE IF EXISTS agx_callback_clean; DROP DATABASE IF EXISTS agx_callback_partial; CREATE DATABASE agx_callback_clean; CREATE DATABASE agx_callback_partial;");
  sql("agx_callback_clean", baseSchema);
  sql("agx_callback_clean", migration);
  sql("agx_callback_clean", migration);

  const clean = sql("agx_callback_clean", `
    SELECT VERSION();
    SELECT COUNT(*) FROM developer_webhook_deliveries WHERE logical_delivery_key='developer-existing';
    SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='developer_webhook_deliveries' AND COLUMN_NAME IN ('miniapp_reward_callback_id','miniapp_id');
    SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='developer_webhook_deliveries' AND INDEX_NAME='idx_direct_miniapp_reward_delivery';
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='developer_webhook_deliveries' AND CONSTRAINT_NAME IN ('fk_direct_reward_delivery_callback','fk_direct_reward_delivery_miniapp');
    SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME REGEXP 'balance|financial|withdrawal|allocation|ledger';
  `, true).split(/\r?\n/);
  assert.match(clean[0], /^11\.4\.4-MariaDB/);
  assert.deepEqual(clean.slice(1), ["1", "2", "3", "2", "0"]);

  sql("agx_callback_clean", `
    INSERT INTO miniapp_reward_callbacks(miniapp_id,callback_url,status,signing_secret)
    VALUES(13,'https://callbacks.example/reward','active','test-only-secret');
    INSERT INTO developer_webhook_deliveries
      (webhook_id,miniapp_reward_callback_id,application_id,miniapp_id,event_type,event_id,
       webhook_version,signature_version,secret_version,signing_secret,logical_delivery_key,payload)
    VALUES(NULL,1,NULL,13,'reward.eligible','rwe_direct','v2','v2',1,'test-only-secret','direct-test','{}');
  `);
  assert.equal(sql("agx_callback_clean", "SELECT application_id IS NULL FROM developer_webhook_deliveries WHERE logical_delivery_key='direct-test';", true), "1");
  assert.deepEqual(sql("agx_callback_clean", `
    SELECT COUNT(*) FROM developer_webhook_deliveries
      WHERE status IN ('pending','retrying') AND (0 = 1 OR miniapp_reward_callback_id IS NULL);
    SELECT COUNT(*) FROM developer_webhook_deliveries
      WHERE status IN ('pending','retrying') AND (1 = 1 OR miniapp_reward_callback_id IS NULL);
    SELECT SUM(attempts) FROM developer_webhook_deliveries;
  `, true).split(/\r?\n/), ["1", "2", "0"]);

  sql("agx_callback_partial", baseSchema);
  sql("agx_callback_partial", createCallbackTable);
  sql("agx_callback_partial", "ALTER TABLE developer_webhook_deliveries ADD COLUMN miniapp_reward_callback_id BIGINT UNSIGNED NULL AFTER webhook_id;");
  sql("agx_callback_partial", migration);
  assert.deepEqual(sql("agx_callback_partial", `
    SELECT COUNT(*) FROM developer_webhook_deliveries WHERE logical_delivery_key='developer-existing';
    SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='developer_webhook_deliveries' AND COLUMN_NAME IN ('miniapp_reward_callback_id','miniapp_id');
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='developer_webhook_deliveries' AND CONSTRAINT_NAME IN ('fk_direct_reward_delivery_callback','fk_direct_reward_delivery_miniapp');
  `, true).split(/\r?\n/), ["1", "2", "2"]);
});
