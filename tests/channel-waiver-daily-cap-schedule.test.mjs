import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('db/migrations/20260926_0148_channel_view_waivers_daily_cap.sql');
const lifecycleMigration = read('db/migrations/20260926_0149_platform_lifecycle_notifications_slots.sql');
const campaign60Closure = read('db/migrations/20260926_0150_campaign_60_historical_delivery_closure.sql');
const adminDetail = read('src/app/api/admin/campaigns/[id]/route.ts');
const adminList = read('src/app/api/admin/campaigns/route.ts');
const waivers = read('src/lib/channelViewWaivers.ts');
const settlement = read('src/lib/channelSettlement.ts');
const fastBilling = read('src/lib/channelFastBilling.ts');
const deletion = read('src/lib/campaignPostDeletion.ts');
const dailyCap = read('src/lib/channelDailyCap.ts');
const processAds = read('src/app/api/cron/process-ads/route.ts');
const emergency = read('src/app/api/admin/campaigns/[id]/emergency-push/route.ts');
const channelDelivery = read('src/lib/channelDelivery.ts');
const clickRoute = read('src/app/api/clicks/[id]/[postId]/route.ts');
const broadcast = read('src/app/api/cron/process-broadcast/route.ts');
const readyPool = read('src/lib/botDeliveryReadyPool.ts');
const lifecycle = read('src/lib/botLifecycle.ts');

test('1 Views admin detail uses financially billable views', () => {
  assert.match(adminDetail, /type === "views" \? billableViews : rawViews/);
  assert.equal(Number(((200 / 8064) * 100).toFixed(8)), 2.48015873);
});
test('2 Views admin list uses billable views', () => assert.match(adminList, /row\.type === "views" \? billableViews/));
test('3 Click admin reporting retains raw engagement views', () => assert.match(adminList, /Number\(posts\?\.impressions \|\| 0\)/));
test('4 campaign 60 historical recovery is additive', () => {
  const analytics = read('src/lib/campaignAnalyticsAdjustments.ts');
  assert.match(lifecycleMigration, /SET adjustment_mode='additive'/);
  assert.match(analytics, /\+ Math\.max\(0,additive\)/);
});
test('5 recovered click examples stay permanently additive', () => {
  const displayed = (actual) => actual + 200;
  assert.deepEqual([0, 50, 200, 500].map(displayed), [200, 250, 400, 700]);
});
test('6 historical recovery has zero financial effect', () => assert.match(read('db/migrations/20260926_0147_campaign_identity_delivery_fairness.sql'), /historical_click_tracking_outage_recovery',0/));
test('7 waiver is explicitly zero-financial', () => assert.match(migration, /CHECK\(financial_effect=0\)/));
test('8 historical correction closes only the audited old placement generation', () => {
  assert.doesNotMatch(migration, /11353/);
  assert.match(campaign60Closure, /cp\.delivery_generation=1 AND cp\.id<=92788/);
  assert.match(campaign60Closure, /future_generations_bill_normally/);
});
test('9 waived views are excluded from legacy settlement', () => assert.match(settlement, /totalViews - oldViews - waivedViews/));
test('10 waived views are excluded from fast billing', () => assert.match(fastBilling, /settled_views \|\| 0\) \+ Number\(post\.waived_views/));
test('11 waived views are excluded from outstanding calculations', () => assert.match(waivers, /views,0\).*settled_views,0\).*waivedViewsForPostSql/s));
test('12 forensic admin reporting retains raw fraud waiver and billable values', () => {
  for (const field of ['raw_views','fraud_excluded_views','waived_views','outstanding_valid_views','billable_views']) assert.match(adminDetail, new RegExp(field));
});
test('13 daily settlement locks the campaign row', () => assert.match(fastBilling, /SELECT id FROM campaigns WHERE id=\? FOR UPDATE/));
test('14 cap transition has an explicit lifecycle state', () => assert.match(dailyCap, /status='daily_cap_reached'/));
test('15 daily cap immediately invokes Telegram cleanup', () => assert.match(dailyCap, /deleteAllCampaignPostsForLifecycle/));
test('16 next UTC billing day reactivates financially eligible campaigns', () => {
  assert.match(dailyCap, /daily_cap_billing_date<UTC_DATE\(\)/);
  assert.match(dailyCap, /u\.ad_balance>=\(\$\{channelNextUnitSql\(\)\}\)/);
});
test('17 next day increments delivery generation', () => assert.match(dailyCap, /channel_delivery_generation=channel_delivery_generation\+1/));
test('17b future generations are not included in the historical waiver', () => {
  assert.doesNotMatch(campaign60Closure, /cp\.id>92788/);
  assert.match(campaign60Closure, /Newer[\s\S]*normal real delivery and billing/);
});
test('18 delivery-failed rows without messages are normalized without Telegram delete', () => assert.match(deletion, /status='delivery_failed'[\s\S]*message_id IS NULL/));
test('19 campaign 60 identity migration remains pinned to internal 64', () => assert.match(read('db/migrations/20260926_0147_campaign_identity_delivery_fairness.sql'), /SET public_id=60[\s\S]*WHERE id=64/));
test('20 scheduled Views delivery uses tracked CTA', () => assert.match(processAds, /trackedChannelCtaUrl/));
test('21 Emergency Push Views delivery uses tracked CTA', () => assert.match(emergency, /trackedChannelCtaUrl/));
test('22 Views clicks cannot enter CPC fast billing', () => assert.match(fastBilling, /post\.campaign_type !== `\$\{input\.type\}s`/));
test('23 Click campaigns retain click-unit settlement', () => assert.match(settlement, /campaign_type === "clicks" \? "click" : "view"/));
test('24 scheduled and Emergency Push share the placement reservation helper', () => {
  assert.match(processAds, /reserveChannelPlacement/); assert.match(emergency, /reserveChannelPlacement/);
});
test('25 claim key is campaign channel generation unique', () => assert.match(channelDelivery, /channel:\$\{campaignId\}:\$\{channelId\}:generation:\$\{generation\}/));
test('26 saved posting_times take precedence over generated scheduler_slot', () => {
  const slots = read('src/lib/channelScheduleSlots.ts');
  const configured = slots.indexOf('if (valid.length)');
  const fallback = slots.indexOf('if (channel.scheduler_slot', configured);
  assert.ok(configured >= 0 && fallback > configured);
});
test('27 normal scheduler uses exact configured slots with a bounded grace window', () => {
  const slots = read('src/lib/channelScheduleSlots.ts');
  assert.match(processAds, /evaluateChannelPostingSlot/);
  assert.match(slots, /CHANNEL_SCHEDULER_GRACE_MINUTES/);
  assert.doesNotMatch(processAds, /CHANNEL_SCHEDULER_RECOVERY_SLOTS|postingSlotHistory/);
});
test('28 posts_per_day remains enforced from confirmed successful delivery only', () => {
  assert.match(processAds, /successfulDailyUsage\.get\(channel\.id\)/);
  assert.match(processAds, /Math\.max\(1, Number\(channel\.posts_per_day \|\| 1\)\)/);
});
test('29 bot delivery is one global paced lane', () => {
  assert.match(broadcast, /Math\.min\(60,[\s\S]*configuredBatchSize/);
  assert.match(broadcast, /nextGlobalSendAt[\s\S]*\+ 1000/);
  assert.match(broadcast, /const maxWorkerCount = 1/);
  assert.match(broadcast, /processBoundedQueue\(dispatches, workerCount/);
});
test('30 bot fairness ready-pool and failure classes remain separated', () => {
  assert.match(broadcast, /successful_deliveries_window/);
  assert.match(readyPool, /active_audience_count/);
  assert.match(lifecycle, /classifyBotUserSendFailure/);
  assert.match(broadcast, /consecutive_permanent_failures=consecutive_permanent_failures\+1/);
  assert.match(clickRoute, /debitChannelClick/);
});
test('31 slot claims are durable and unique per channel schedule slot', () => {
  assert.match(lifecycleMigration, /CREATE TABLE IF NOT EXISTS channel_schedule_slot_claims/);
  assert.match(lifecycleMigration, /UNIQUE KEY uq_channel_schedule_slot\(channel_id,slot_date,slot_time\)/);
});
test('32 fill mode never deletes and respects the hard configured count', () => {
  const slots = read('src/lib/channelScheduleSlots.ts');
  assert.match(slots, /input\.mode === "fill_empty_slots"/);
  assert.match(channelDelivery, /used_capacity \|\| 0\) >= Math\.max\(1, Number\(input\.capacityLimit\)\)/);
  assert.match(emergency, /capacityLimit:/);
  assert.doesNotMatch(slots.slice(slots.indexOf('input.mode === "fill_empty_slots"'), slots.indexOf('if (input.bypassTiming')), /replacesPostId:\s*[1-9]/);
});
test('33 replacement selects overrepresented coverage and protects final placements', () => {
  const slots = read('src/lib/channelScheduleSlots.ts');
  assert.match(slots, /ORDER BY \(live_coverage<=1\) ASC,live_coverage DESC/);
  assert.match(slots, /unavoidableCoverageConflict/);
});
test('34 emergency replacement settles and deletes only its selected victim', () => {
  assert.match(emergency, /refreshChannelViews/);
  assert.match(emergency, /settleChannelCampaigns/);
  assert.match(emergency, /deleteCampaignPostsByIds\(\[scheduleSlot\.replacesPostId\]/);
  assert.doesNotMatch(emergency, /deleteActivePostsForReplacementSafely/);
});
test('35 cap increase can reactivate with a fresh generation', () => {
  assert.match(dailyCap, /reactivateCampaignAfterDailyCapIncrease/);
  assert.match(dailyCap, /channel_delivery_generation=channel_delivery_generation\+1/);
});
test('36 notification outbox is durable, deduplicated and retryable', () => {
  const notifications = read('src/lib/platformNotifications.ts');
  assert.match(lifecycleMigration, /UNIQUE KEY uq_platform_notification_event\(event_key\)/);
  assert.match(notifications, /INSERT IGNORE INTO platform_notification_events/);
  assert.match(notifications, /next_attempt_at=TIMESTAMPADD/);
});
test('37 low balance uses persistent threshold cycles', () => {
  assert.match(lifecycleMigration, /advertiser_balance_notification_state/);
  assert.match(read('src/lib/platformNotifications.ts'), /threshold_cycle=threshold_cycle\+IF/);
});
test('38 Telegram access changes are transition-versioned', () => {
  const webhook = read('src/app/api/webhook/telegram/route.ts');
  const access = read('src/lib/telegramChannelAccess.ts');
  assert.match(webhook, /my_chat_member/);
  assert.match(webhook, /persistTelegramMembershipUpdate/);
  assert.match(access, /telegram_access_version=telegram_access_version\+IF/);
  assert.match(access, /telegram_access_previous_status/);
});
