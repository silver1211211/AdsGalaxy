import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineMiniAppCampaignMetricSources } from "../src/lib/miniappCampaignMetricMath.ts";
import { calculateCumulativeExternalDue } from "../src/lib/miniappExternalDeliveryMath.ts";

const worker = readFileSync("src/lib/miniappExternalDeliverySync.ts", "utf8");
const directDebit = readFileSync("src/lib/advertiserDirectDebit.ts", "utf8");
const billing = readFileSync("src/lib/miniappInternalAds.ts", "utf8");
const notifications = readFileSync("src/lib/miniappCampaignNotifications.ts", "utf8");
const migration = readFileSync("db/migrations/20260831_0122_miniapp_external_delivery_sync.sql", "utf8");
const cron = readFileSync("src/app/api/cron/miniapp-external-delivery-sync/route.ts", "utf8");
const adminRoute = readFileSync("src/app/api/admin/miniapp-rewarded-campaigns/[id]/external-delivery-sync/route.ts", "utf8");
const adminPage = readFileSync("src/app/admin/miniapp-rewarded/page.tsx", "utf8");
const campaignMetrics = readFileSync("src/lib/miniappCampaignMetrics.ts", "utf8");
const reportingRoutes = [
  "src/app/api/admin/campaigns/route.ts",
  "src/app/api/admin/miniapp-rewarded-campaigns/route.ts",
  "src/app/api/advertiser/stats/route.ts",
  "src/app/api/advertiser/miniapp-rewarded-campaigns/route.ts",
  "src/app/api/advertiser/miniapp-rewarded-campaigns/[id]/route.ts",
].map((path) => readFileSync(path, "utf8"));

function due(required, platform, external, progress) {
  return calculateCumulativeExternalDue({
    requiredExternal: required,
    platformDeliveredDuring: platform,
    externalAlreadyAdded: external,
    progress,
  });
}

test("cumulative pacing gradually reaches the final target", () => {
  assert.equal(due(1000, 0, 0, 0.25), 250);
  assert.equal(due(1000, 0, 250, 0.5), 250);
  assert.equal(due(1000, 0, 500, 1), 500);
});

test("platform traffic reduces external delivery and never causes a decrement", () => {
  assert.equal(due(1000, 300, 0, 0.5), 200);
  assert.equal(due(1000, 1200, 0, 1), 0);
  assert.equal(due(1000, 900, 200, 1), 0);
});

test("4000/200 synchronizes to combined 5000/300 with 6 percent CTR", () => {
  const final = combineMiniAppCampaignMetricSources({
    platform_impressions: 4200,
    external_impressions: 800,
    platform_clicks: 220,
    external_clicks: 80,
    platform_spend: 4.2,
    external_spend: 0.8,
  });
  assert.equal(final.impressions, 5000);
  assert.equal(final.clicks, 300);
  assert.equal(final.ctr, 6);
  assert.equal(final.spend, 5);
});

test("platform traffic can exceed the target and retries do not duplicate delivery", () => {
  const beyondTarget = combineMiniAppCampaignMetricSources({
    platform_impressions: 4500,
    external_impressions: 800,
    platform_clicks: 250,
    external_clicks: 80,
    platform_spend: 4.5,
    external_spend: 0.8,
  });
  assert.equal(beyondTarget.impressions, 5300);
  assert.equal(beyondTarget.clicks, 330);
  assert.equal(due(1000, 200, 800, 1), 0);
  assert.equal(due(1000, 500, 800, 1), 0);
});

test("schema enforces one active sync and preserves source/batch history", () => {
  assert.match(migration, /UNIQUE KEY uniq_miniapp_external_sync_active \(campaign_id, active_slot\)/);
  assert.match(migration, /miniapp_external_delivery_batches/);
  assert.match(migration, /UNIQUE KEY uniq_miniapp_campaign_notification/);
});

test("all advertiser and admin campaign reporting reuses combined authoritative metrics", () => {
  assert.match(campaignMetrics, /miniapp_internal_ad_impressions/);
  assert.match(campaignMetrics, /miniapp_external_delivery_batches/);
  assert.match(campaignMetrics, /combineMiniAppCampaignMetricSources/);
  for (const route of reportingRoutes) {
    const usesSharedMetrics = /getMiniAppCampaignMetrics/.test(route)
      && /applyMiniAppCampaignMetrics|miniAppMetrics\.values/.test(route);
    const directlyCombinesBothSources = /miniapp_internal_ad_impressions/.test(route)
      && /miniapp_external_delivery_batches/.test(route);
    assert.ok(usesSharedMetrics || directlyCombinesBothSources);
  }
});

test("worker uses transactions, row locks, guarded debits, and combined source totals", () => {
  assert.match(worker, /beginTransaction\(\)/);
  assert.match(worker, /FOR UPDATE/);
  assert.match(worker, /claimAdvertiserDirectDebit/);
  assert.match(directDebit, /UPDATE users SET ad_balance=ad_balance-\? WHERE id=\? AND ad_balance>=\?/);
  assert.match(worker, /remaining_budget >= \?/);
  assert.match(worker, /platformDeliveredDuring/);
  assert.match(worker, /external_impressions_added/);
  assert.match(worker, /daily_budget_limit/);
});

test("billing shares CPM rounding and queues one exhaustion notification cycle", () => {
  assert.match(billing, /miniAppImpressionCost\(cpm\)/);
  assert.match(billing, /enqueueMiniAppBudgetExhaustedNotification/);
  assert.match(notifications, /INSERT IGNORE/);
  assert.match(notifications, /sendTelegramMessage/);
});

test("cron and admin controls are protected and UI is responsive", () => {
  assert.match(cron, /requireCronSecret/);
  assert.match(cron, /acquireCronLock/);
  assert.match(adminRoute, /requireAdminPermission\("operate"\)/);
  assert.match(adminRoute, /"pause", "resume", "cancel"/);
  assert.match(adminPage, /Update delivery totals/);
  assert.match(adminPage, /grid-cols-1 gap-4 sm:grid-cols-3/);
});
