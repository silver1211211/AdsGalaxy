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

// Migration history review:
// - originally added by a09c4650b433b0c22e0475df1d646cc0fd0feb59;
// - made safely rerunnable by ec24c5a46a0f67e18b8e03e7a4677f31e7e662d4
//   after production had partially applied the original migration;
// - production was verified to match the effective idempotent schema.
// Hash normalized UTF-8 text so checkout line endings cannot weaken the
// approved integrity check. Reviewed normalized digest: 3490823A...6079.
function protectedMigrationDigest(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .toUpperCase();
}

test("protected migration retains its approved normalized SHA-256", () => {
  const content = readFileSync("db/migrations/20260622_0008_create_miniapp_mediation_health.sql", "utf8");
  assert.equal(
    protectedMigrationDigest(content),
    "3490823A5D64392E1CCF1E595CC61030AA9124463BF2FF1C3BCF1246FB526079"
  );
});

test("protected migration integrity is identical for LF and CRLF checkouts", () => {
  const content = readFileSync("db/migrations/20260622_0008_create_miniapp_mediation_health.sql", "utf8")
    .replace(/\r\n/g, "\n");
  assert.equal(protectedMigrationDigest(content), protectedMigrationDigest(content.replace(/\n/g, "\r\n")));
  assert.equal(
    protectedMigrationDigest(content),
    "3490823A5D64392E1CCF1E595CC61030AA9124463BF2FF1C3BCF1246FB526079"
  );
});
