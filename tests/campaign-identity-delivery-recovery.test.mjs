import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("db/migrations/20260926_0147_campaign_identity_delivery_fairness.sql");
const identity = read("src/lib/campaignIdentity.ts");
const adjustments = read("src/lib/campaignAnalyticsAdjustments.ts");
const channelDelivery = read("src/lib/channelDelivery.ts");
const scheduled = read("src/app/api/cron/process-ads/route.ts");
const emergency = read("src/app/api/admin/campaigns/[id]/emergency-push/route.ts");
const click = read("src/app/api/clicks/[id]/[postId]/route.ts");
const advertiserStatistics = read("src/lib/advertiserCampaignStatistics.ts");
const adminDetails = read("src/app/api/admin/campaigns/[id]/route.ts");
const broadcast = read("src/app/api/cron/process-broadcast/route.ts");
const readyPool = read("src/lib/botDeliveryReadyPool.ts");
const botLifecycle = read("src/lib/botLifecycle.ts");
const botIntegration = read("src/app/api/bot/integration/[botId]/[secret]/route.ts");
const manualBotAudience = read("src/app/api/admin/bots/[id]/users/manual/route.ts");

test("public campaign identity is durable and campaign 60 maps to internal row 64", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS public_id/);
  assert.match(migration, /SET public_id=60\s+WHERE id=64 AND user_id=149284 AND name='Views'/);
  assert.match(migration, /uq_campaigns_public_id/);
  assert.match(identity, /COALESCE\(\$\{alias\}\.public_id,\$\{alias\}\.id\)/);
});

test("historical click recovery is an auditable zero-financial baseline", () => {
  assert.match(migration, /campaign_analytics_adjustments/);
  assert.match(migration, /200,'baseline','historical_click_tracking_outage_recovery',0/);
  assert.doesNotMatch(migration, /INSERT INTO campaign_clicks/i);
  assert.match(adjustments, /Math\.max\(Math\.max\(0,actual\),Math\.max\(0,baseline\)\)/);
});

test("advertiser and admin reporting distinguish actual recovery and displayed clicks", () => {
  assert.match(advertiserStatistics, /actual_tracked_clicks/);
  assert.match(advertiserStatistics, /historical_click_recovery_adjustment/);
  assert.match(advertiserStatistics, /displayed_clicks/);
  assert.match(adminDetails, /actual_tracked_clicks/);
  assert.match(adminDetails, /historical_click_recovery_adjustment/);
});

test("scheduled and emergency Views placements always use tracked CTA URLs", () => {
  assert.match(scheduled, /trackedChannelCtaUrl\(host,Number\(campaign\.public_id\|\|campaign\.id\),postId\)/);
  assert.match(emergency, /trackedChannelCtaUrl\(host,Number\(campaign\.public_id\|\|campaign\.id\),postId\)/);
  assert.doesNotMatch(scheduled, /campaign\.type\s*===\s*["']clicks["']\s*\?\s*trackedChannelCtaUrl/);
});

test("click endpoint resolves public identity while storing the internal campaign FK", () => {
  assert.match(click, /WHERE COALESCE\(c\.public_id,c\.id\) = \? AND cp\.id = \?/);
  assert.match(click, /campaignId:Number\(campaignPost\?\.id\|\|0\)/);
  assert.match(click, /debitChannelClick\(Number\(postId\), clickRecorded\.id\)/);
});

test("channel claims are database-backed across scheduled and emergency delivery", () => {
  assert.match(migration, /uq_campaign_posts_delivery_claim/);
  assert.match(channelDelivery, /INSERT IGNORE INTO campaign_posts/);
  assert.match(scheduled, /reserveChannelPlacement\(conn/);
  assert.match(emergency, /reserveChannelPlacement\(reservationConnection/);
  assert.match(scheduled, /delivery_claim_exists/);
  assert.match(emergency, /delivery_claim_exists/);
});

test("replacement creates a new delivery generation instead of duplicating the current one", () => {
  assert.match(emergency, /channel_delivery_generation=channel_delivery_generation\+1/);
  assert.match(migration, /channel_delivery_generation INT UNSIGNED NOT NULL DEFAULT 1/);
});

test("broadcast delivery reservation has a unique financial claim", () => {
  assert.match(migration, /uq_broadcast_delivery_claim/);
  assert.match(broadcast, /INSERT IGNORE INTO broadcast_deliveries/);
  assert.match(broadcast, /delivery_already_claimed/);
  assert.ok(broadcast.indexOf("INSERT IGNORE INTO broadcast_deliveries") < broadcast.indexOf("UPDATE campaigns SET budget = budget - ?"));
});

test("broadcast scheduler uses one global paced worker and a sixty-slot minute batch", () => {
  assert.match(broadcast, /CRON_BROADCAST_BATCH_SIZE \|\| "60"/);
  assert.match(broadcast, /const maxWorkerCount = 1/);
  assert.match(broadcast, /nextGlobalSendAt.*\+ 1000/s);
});

test("campaign fairness is persistent and a failed campaign cannot consume every slot", () => {
  assert.match(migration, /bot_broadcast_campaign_state/);
  assert.match(broadcast, /campaignQuota/);
  assert.match(broadcast, /fairness_deliveries/);
  assert.match(broadcast, /successful_deliveries_window=IF\(fairness_window_date=CURDATE\(\)/);
});

test("only delivery-ready bots are selected and bot opportunity is fair", () => {
  assert.match(broadcast, /JOIN bot_delivery_ready_pool ready/);
  assert.match(broadcast, /ready\.active_audience_count > 0/);
  assert.match(broadcast, /ready_successful_deliveries/);
  assert.match(broadcast, /audience_cursor/);
});

test("ready pool updates as audience eligibility changes", () => {
  assert.match(readyPool, /refreshBotDeliveryReadinessForUser/);
  assert.match(botLifecycle, /await refreshBotDeliveryReadinessForUser\(userId, db\)/);
  assert.match(botLifecycle, /await markBotReadyState\(botId, false, db\)/);
  assert.match(botIntegration, /refreshBotDeliveryReadiness\(bot\.id, connection\)/);
  assert.match(manualBotAudience, /refreshBotDeliveryReadiness\(botId, connection\)/);
});

test("three consecutive permanent recipient failures cool the bot", () => {
  assert.match(broadcast, /consecutive_permanent_failures\+1>=3/);
  assert.match(broadcast, /DATE_ADD\(NOW\(\),INTERVAL 30 MINUTE\)/);
  assert.match(broadcast, /classifyBotUserSendFailure/);
  assert.match(broadcast, /await markBotUserInactive\(user\.id, userFailure\)/);
});

test("transient send failures are retried and do not directly inactivate audience", () => {
  assert.match(broadcast, /scheduleBroadcastRetry/);
  const inactivation = broadcast.indexOf("await markBotUserInactive(user.id, userFailure)");
  const classification = broadcast.lastIndexOf("classifyBotUserSendFailure", inactivation);
  assert.ok(classification >= 0 && classification < inactivation);
});

test("raw click rows remain truthful and analytics recovery cannot invoke billing", () => {
  assert.doesNotMatch(adjustments, /campaign_clicks.*INSERT|INSERT.*campaign_clicks/is);
  assert.doesNotMatch(adjustments, /debit|credit|publisher_reward|fraud/i);
  assert.match(migration, /financial_effect DECIMAL\(18,8\) NOT NULL DEFAULT 0/);
});
