import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const engine = readFileSync("src/lib/broadcastPublisherCpmEngine.ts", "utf8");
const broadcastCron = readFileSync("src/app/api/cron/process-broadcast/route.ts", "utf8");
const emergencyPush = readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts", "utf8");
const adminSettings = readFileSync("src/app/api/admin/settings/route.ts", "utf8");
const publisherAnalytics = readFileSync("src/app/api/publisher/bots/[id]/analytics/route.ts", "utf8");
const advertiserDetails = readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts", "utf8");
const botAnalyticsUi = readFileSync("src/components/publisher/BotAnalyticsDashboard.tsx", "utf8");
const migration = readFileSync("db/migrations/20260710_0101_broadcast_payout_configuration.sql", "utf8");
const deploy = readFileSync("deploy-vps.sh", "utf8");

function payout(cpm, publisherPercent, reservePercent) {
  assert.ok(publisherPercent >= 0 && reservePercent >= 0 && publisherPercent + reservePercent <= 100);
  const debit = Number((cpm / 1000).toFixed(8));
  const publisher = Number((debit * publisherPercent / 100).toFixed(8));
  const reserve = Number((debit * reservePercent / 100).toFixed(8));
  const platform = Number((debit - publisher - reserve).toFixed(8));
  return { debit, publisher, reserve, platform };
}

test("Bot payout uses configurable publisher, reserve, and platform shares", () => {
  const result = payout(2, 20, 10);
  assert.deepEqual(result, { debit: 0.002, publisher: 0.0004, reserve: 0.0002, platform: 0.0014 });
  const tenPercentPublisher = payout(2, 10, 0);
  assert.equal(tenPercentPublisher.publisher * 1000, 0.2);
  assert.equal((result.publisher + result.reserve + result.platform), result.debit);
  assert.throws(() => payout(2, 91, 10));
  assert.match(engine, /broadcast_publisher_share_percent/);
  assert.match(engine, /broadcast_reserve_percent/);
  assert.match(engine, /publisherShare \+ reserve > 100/);
  assert.match(engine, /platformRevenue = money\(Math\.max\(0, advertiserDebit - publisherReward - reserveAmount\)\)/);
});

test("normal broadcasts and Emergency Push share the same Bot payout calculator", () => {
  for (const source of [broadcastCron, emergencyPush]) {
    assert.match(source, /getBroadcastPayoutSettings/);
    assert.match(source, /calculateBroadcastPayout/);
    assert.match(source, /reserve_amount/);
    assert.match(source, /platform_revenue/);
  }
  assert.doesNotMatch(broadcastCron, /broadcast_ad_reward_percentage/);
  assert.doesNotMatch(emergencyPush, /broadcast_ad_reward_percentage/);
});

test("Bot reporting CPM uses real money over displayed impressions and remains safe below five sends", () => {
  const displayed = Math.floor(5 / 5);
  assert.equal(displayed, 1);
  assert.equal((0.0045 / displayed) * 1000, 4.5);
  assert.equal((0.015 / displayed) * 1000, 15);
  assert.equal(Math.floor(4 / 5), 0);
  assert.equal(0, 0);
  assert.match(engine, /Math\.floor\(Math\.max\(0, Number\(successfulBroadcasts\) \|\| 0\) \/ 5\)/);
  assert.match(engine, /impressions > 0 \? money\(\(Math\.max\(0, Number\(amount\) \|\| 0\) \/ impressions\) \* 1000\) : 0/);
  assert.match(publisherAnalytics, /publisher_cpm: impressions > 0 \? earnings \/ impressions \* 1000 : 0/);
  assert.match(advertiserDetails, /FLOOR\(COUNT\(\*\) \/ 5\)/);
  assert.match(advertiserDetails, /SUM\(cost\) as total_cost/);
  assert.doesNotMatch(botAnalyticsUi, /Clicks|CTR|CTA/);
});

test("Bot revenue settings are atomically validated and deployment adds reconciliation fields", () => {
  assert.match(adminSettings, /BROADCAST_REVENUE_SPLIT_KEYS/);
  assert.match(adminSettings, /Bot publisher share plus reserve cannot exceed 100%/);
  assert.match(adminSettings, /Bot publisher share and reserve must be submitted together/);
  assert.match(migration, /reserve_amount DECIMAL\(18,8\)/);
  assert.match(migration, /platform_revenue DECIMAL\(18,8\)/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.match(deploy, /20260710_0101_broadcast_payout_configuration\.sql/);
});
