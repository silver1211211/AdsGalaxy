import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const broadcast = readFileSync("src/lib/platformBroadcast.ts", "utf8");
const worker = readFileSync("src/app/api/cron/platform-broadcasts/route.ts", "utf8");
const createRoute = readFileSync("src/app/api/admin/platform-broadcasts/route.ts", "utf8");
const dashboardLayout = readFileSync("src/components/layout/DashboardLayout.tsx", "utf8");
const attribution = readFileSync("src/lib/referralAttribution.ts", "utf8");

test("platform broadcasts target users known to be reachable by the official bot", () => {
  assert.match(broadcast, /official_bot_started_at IS NOT NULL/);
  assert.match(broadcast, /previous\.status = 'sent'/);
  assert.match(attribution, /official_bot_started_at = NOW\(\)/);
});

test("image creative is atomic and never silently downgraded to text", () => {
  assert.doesNotMatch(worker, /textOnlyBroadcasts/);
  assert.doesNotMatch(worker, /image_fallback/);
  assert.match(worker, /const photo = broadcast\.image_path \|\| undefined/);
  assert.match(worker, /PLATFORM_BROADCAST_MAX_ATTEMPTS/);
  assert.match(worker, /syncBroadcastCounts\(broadcast\.id\)/);
});

test("recipient discovery uses bounded autocommit batches after the broadcast is committed", () => {
  assert.match(broadcast, /PLATFORM_BROADCAST_DISCOVERY_BATCH_SIZE = 1_000/);
  assert.match(broadcast, /SELECT u\.id,TRIM\(u\.telegram_id\) telegram_id/);
  assert.match(broadcast, /INSERT IGNORE INTO platform_broadcast_recipients \(broadcast_id,user_id,telegram_id\) VALUES/);
  assert.match(broadcast, /LIMIT \?/);
  assert.match(createRoute, /await connection\.commit\(\)/);
  assert.doesNotMatch(createRoute, /discoverRecipients/);
});

test("a status or locale request failure cannot leave the dashboard boot spinner permanent", () => {
  const catchStart = dashboardLayout.indexOf('miniappReloadDebug("dashboard_failed"');
  const catchEnd = dashboardLayout.indexOf("// Authentication retries", catchStart);
  const fallback = dashboardLayout.slice(catchStart, catchEnd);
  assert.doesNotMatch(fallback.split("refreshAccountState")[0], /return|throw/);
  assert.match(dashboardLayout, /if \(bootState === "banned"\)/);
  assert.doesNotMatch(dashboardLayout, /bootState === "loading"/);
});
