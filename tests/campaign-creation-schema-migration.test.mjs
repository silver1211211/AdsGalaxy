import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync("db/migrations/20260728_0105_add_advertiser_transaction_description.sql", "utf8");
const deploy = readFileSync("deploy-vps.sh", "utf8");
const route = readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
const postRoute = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function GET"));

test("0105 is an additive idempotent advertiser transaction description migration", () => {
  assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(migration, /TABLE_SCHEMA = DATABASE\(\)/);
  assert.match(migration, /TABLE_NAME = 'advertiser_transactions'/);
  assert.match(migration, /COLUMN_NAME = 'description'/);
  assert.match(migration, /@description_exists = 0/);
  assert.match(migration, /ADD COLUMN description TEXT NULL AFTER type/);
  assert.match(migration, /PREPARE description_statement/);
  assert.match(migration, /EXECUTE description_statement/);
  assert.match(migration, /DEALLOCATE PREPARE description_statement/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
});

test("deployment orders campaign schema and reward migrations chronologically", () => {
  const ordered = [
    "20260707_0090_campaign_creative_title.sql",
    "20260708_0098_campaign_cpc_billing.sql",
    "20260711_0102_bot_user_verification.sql",
    "20260727_0103_production_miniapp_reward_events.sql",
    "20260727_0104_developer_webhook_v2_outbox.sql",
    "20260728_0105_add_advertiser_transaction_description.sql",
  ].map((name) => deploy.indexOf(name));
  assert.ok(ordered.every((position) => position >= 0));
  assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
});

test("campaign creation contains no request-time DDL", () => {
  assert.doesNotMatch(postRoute, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|DATABASE|INDEX)\b/i);
  assert.doesNotMatch(postRoute, /ensureClassicSettlementColumns/);
});

test("protected migration retains its approved SHA-256", () => {
  const hash = createHash("sha256")
    .update(readFileSync("db/migrations/20260622_0008_create_miniapp_mediation_health.sql"))
    .digest("hex")
    .toUpperCase();
  assert.equal(hash, "D5B028A2D73E23F65CC10A78EE787DFB6CCC7E9B750BFD13E74FB56D09B541BA");
});
