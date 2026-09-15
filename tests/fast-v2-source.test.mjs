import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("campaign feed is a stable five-at-a-time server page", () => {
  const route = read("src/app/api/advertiser/campaign-feed/route.ts");
  const page = read("src/app/advertiser/campaigns/page.tsx");
  assert.match(route, /const PAGE_SIZE = 5/);
  assert.match(route, /ORDER BY feed\.created_at DESC, feed\.source ASC, feed\.id DESC LIMIT \?/);
  assert.match(route, /next_cursor/);
  assert.match(page, /api\/advertiser\/campaign-feed/);
  assert.match(page, /See More/);
  assert.doesNotMatch(page, /Promise\.all\(\[\s*apiFetch\("\/api\/advertiser\/campaigns"\)/);
});

test("dashboard snapshots are identity-scoped and omit financial authority", () => {
  const snapshot = read("src/lib/dashboardSnapshot.ts");
  assert.match(snapshot, /initDataUnsafe\?\.user\?\.id/);
  assert.match(snapshot, /SNAPSHOT_VERSION/);
  assert.match(snapshot, /MAX_AGE_MS = 48 \* 60 \* 60 \* 1000/);
  for (const field of ["balance_available", "balance_locked", "ad_balance", "advertiser_balance_locked"])
    assert.match(snapshot, new RegExp(field));
});

test("read navigation is bounded and does not mutate deposit state", () => {
  const deposits = read("src/app/api/advertiser/deposits/route.ts");
  const withdrawals = read("src/app/api/publisher/withdrawals/route.ts");
  const depositGet = deposits.slice(deposits.indexOf("export async function GET"), deposits.indexOf("export async function POST"));
  assert.match(depositGet, /getAuthenticatedUserStatus/);
  assert.match(depositGet, /LIMIT 21/);
  assert.doesNotMatch(depositGet, /UPDATE deposits/);
  assert.match(withdrawals, /ORDER BY created_at DESC, id DESC LIMIT 21/);
});

test("broadcast pressure and image-selected campaign failure are safe", () => {
  const platform = read("src/app/api/cron/platform-broadcasts/route.ts");
  const campaigns = read("src/app/api/advertiser/campaigns/route.ts");
  assert.match(platform, /PLATFORM_BROADCAST_CLAIM_LIMIT \|\| 150/);
  assert.match(platform, /TELEGRAM_GLOBAL_SENDS_PER_SECOND \|\| 5/);
  assert.match(campaigns, /Image upload failed\. No campaign was created\./);
  assert.match(campaigns, /Image upload is temporarily unavailable\. No campaign was created\./);
});

test("durable broadcast retries and exact-message recall metadata are retained", () => {
  const botWorker = read("src/app/api/cron/process-broadcast/route.ts");
  const platformWorker = read("src/app/api/cron/platform-broadcasts/route.ts");
  const recall = read("src/app/api/admin/platform-broadcasts/[id]/recall/route.ts");
  const migration = read("db/migrations/20260908_0130_broadcast_delivery_reliability.sql");
  assert.match(botWorker, /status='retry_wait'/);
  assert.match(botWorker, /telegram_message_id = \?/);
  assert.match(botWorker, /bd\.status = 'sent'/);
  assert.match(migration, /next_retry_at/);
  assert.match(migration, /deletion_status/);
  assert.match(recall, /telegram_message_id IS NOT NULL/);
  assert.match(recall, /body\.confirm !== `RECALL-\$\{id\}`/);
  assert.match(platformWorker, /deleteTelegramMessage\(row\.telegram_id, Number\(row\.telegram_message_id\)\)/);
});

test("cron delivery workers bypass public Nginx and are staggered", () => {
  const deploy = read("deploy-vps.sh");
  assert.match(deploy, /http:\/\/127\.0\.0\.1:3007\/api\/cron/);
  for (const delay of [12, 24, 36, 48]) assert.match(deploy, new RegExp(`sleep ${delay}`));
});
