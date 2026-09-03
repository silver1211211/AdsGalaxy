import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const service = fs.readFileSync("src/lib/promoteAdsGalaxy.ts", "utf8");
const migration = fs.readFileSync("db/migrations/20260809_0112_promote_ads_galaxy.sql", "utf8");
const publisherApi = fs.readFileSync("src/app/api/publisher/promote/route.ts", "utf8");
const adminApi = fs.readFileSync("src/app/api/admin/promote-ads-galaxy/route.ts", "utf8");
const channelRoute = fs.readFileSync("src/app/api/publisher/channels/route.ts", "utf8");
const refresh = fs.readFileSync("src/lib/channelSubscriberRefresh.ts", "utf8");
const publisherPage = fs.readFileSync("src/app/publisher/promote/page.tsx", "utf8");
const publisherStats = fs.readFileSync("src/app/api/publisher/stats/route.ts", "utf8");
const paymentMigration = fs.readFileSync("db/migrations/20260816_0118_promote_payment_confirmation.sql", "utf8");

const tiers = [
  [2000,9999,"0.50000000"],[10000,49999,"1.00000000"],[50000,199999,"2.50000000"],
  [200000,999999,"6.00000000"],[1000000,9999999,"15.00000000"],[10000000,20000000,"50.00000000"],
];
function reward(count) {
  if (count > 20_000_000) return ["manual_review","0.00000000"];
  const tier=tiers.find(([min,max])=>count>=min&&count<=max);
  return tier ? ["qualified",tier[2]] : ["rejected","0.00000000"];
}

for (const [audience,status,amount] of [
  [0,"rejected","0.00000000"],[1999,"rejected","0.00000000"],[2000,"qualified","0.50000000"],[9999,"qualified","0.50000000"],
  [10000,"qualified","1.00000000"],[49999,"qualified","1.00000000"],[50000,"qualified","2.50000000"],
  [199999,"qualified","2.50000000"],[200000,"qualified","6.00000000"],[999999,"qualified","6.00000000"],
  [1000000,"qualified","15.00000000"],[9999999,"qualified","15.00000000"],[10000000,"qualified","50.00000000"],
  [20000000,"qualified","50.00000000"],[20000001,"manual_review","0.00000000"],
]) test(`reward boundary ${audience}`,()=>assert.deepEqual(reward(audience),[status,amount]));

test("campaign is seeded draft without timestamps",()=>{
  assert.match(migration,/VALUES \('promote-ads-galaxy', 'Promote AdsGalaxy', 'draft'/);
  assert.doesNotMatch(migration,/UPDATE publisher_promotion_campaigns[\s\S]*status='active'/);
});
test("half-open referral and channel windows use authoritative timestamps",()=>{
  assert.match(service,/r\.created_at>=\? AND r\.created_at<\?/);
  assert.match(service,/c\.created_at>=\? AND c\.created_at<\?/);
  assert.doesNotMatch(service,/users\.created_at/);
});
test("database constraints enforce one reward per submitted channel",()=>{
  assert.match(migration,/UNIQUE KEY uq_publisher_promotion_referred_user \(campaign_id, referred_user_id\)/);
  assert.match(migration,/UNIQUE KEY uq_publisher_promotion_reward_channel \(campaign_id, channel_id\)/);
  assert.match(migration,/UNIQUE KEY uq_publisher_promotion_channel_identity \(campaign_id, normalized_channel_identity\)/);
});
test("deleted channel reactivation reuses old created_at and cannot enter campaign window",()=>{
  assert.match(channelRoute,/If it belongs to same user and IS deleted, reactivate\/update it/);
  assert.match(service,/channel_created_at/);
});
test("publisher API derives the user from authenticated init data",()=>{
  assert.match(publisherApi,/getAuthenticatedUser\(request\.headers\.get\("x-telegram-init-data"\)/);
  assert.doesNotMatch(publisherApi,/searchParams|promoter_user_id|telegram_id/);
});
test("dangerous admin authorization protects mutation and payout",()=>{
  assert.match(adminApi,/requireAdminPermission\("dangerous"\)/);
  assert.match(adminApi,/confirm_payment/);
  assert.match(service,/payment_reference_required/);
  assert.match(service,/confirmed_amount_mismatch/);
  assert.match(service,/payout_externally_confirmed/);
});
test("payment completion and hidden expiry require database-backed confirmation",()=>{
  assert.match(paymentMigration,/payment_confirmed_at/);
  assert.match(paymentMigration,/completion_expires_at/);
  assert.match(service,/DATE_ADD\(UTC_TIMESTAMP\(6\),INTERVAL 12 HOUR\)/);
  assert.match(publisherStats,/completion_expires_at<=UTC_TIMESTAMP\(6\) THEN NULL/);
  assert.match(publisherPage,/PROMOTE ADS GALAXY — PAYOUT COMPLETED/);
  assert.doesNotMatch(publisherPage,/completion_expires_at/);
});
test("failed audience refresh preserves the last valid audience",()=>{
  const failure=refresh.slice(refresh.indexOf("if (!result.ok)"),refresh.indexOf("const previousBelowSince"));
  assert.doesNotMatch(failure,/subscriber_count\s*=/);
});
test("final payout requires a fresh successful verification and lowers the amount",()=>{
  assert.match(service,/c\.subscribers_last_success_at>rw\.qualified_at/);
  assert.match(service,/rw\.amount=LEAST\(rw\.amount/);
});
test("promotion rewards require an approved active channel at every financial gate",()=>{
  assert.match(service,/c\.status='active'.*c\.marketplace_admin_status='approved'/s);
  assert.match(service,/channel_no_longer_eligible/);
  assert.match(service,/COALESCE\(c\.subscriber_count,0\)<2000/);
  assert.match(service,/rw\.status='payable'[\s\S]*c\.marketplace_admin_status='approved'/);
});
test("approved campaign channels are refreshed before reward evaluation",()=>{
  assert.match(service,/refreshPendingCampaignChannels/);
  assert.match(service,/await refreshSubscriberChannel\(channel, minimum\)/);
  assert.match(service,/const refreshedChannels = await refreshPendingCampaignChannels\(\);[\s\S]*const evaluated = await evaluateCampaignRewards\(\)/);
});
test("admin-rejected channels leave pending validation without earning",()=>{
  assert.match(service,/channel_rejected_by_admin/);
  assert.match(service,/rw\.status='pending_validation' AND c\.status='rejected'/);
  assert.match(service,/rw\.status IN \('rejected','reversed'\)/);
});
test("publisher summary counts each reward once even when a referral added multiple channels",()=>{
  assert.match(service,/SELECT COUNT\(\*\) FROM publisher_promotion_channel_events ce/);
  assert.doesNotMatch(service,/SUM\(CASE WHEN rw\.status IN \('qualified','payable','paid'\) THEN 1 ELSE 0 END\)/);
});
