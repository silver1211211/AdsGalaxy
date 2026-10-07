import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts", "utf8");
const scheduler = readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
const exclusions = readFileSync("src/lib/campaignInventoryExclusions.ts", "utf8");

test("Main and Silver emergency push both enforce advertiser exclusions", () => {
  assert.match(route, /campaignExcludesChannel, campaignExcludesIdentifier, loadCampaignExclusions/);
  assert.match(route, /loadCampaignExclusions\(pool, "campaign", \[Number\(campaign\.id\)\], "channel"\)/);
  assert.match(route, /campaignExcludesChannel\(channelExclusions, Number\(campaign\.id\), channel\)/);
  assert.match(route, /skippedByExclusion: channels\.length - eligibleChannels\.length/);
  assert.match(route, /const skipped = skippedByLimit \+ skippedByExclusion/);
});

test("Replace in Every Channel settles and removes only the selected victim", () => {
  assert.match(route, /settleChannelCampaigns\(\{/);
  assert.match(route, /campaignId:Number\(victim\.campaign_id\)/);
  assert.match(route, /replacement_victim_settlement_failed/);
  assert.match(route, /deleteCampaignPostsByIds\(\[scheduleSlot\.replacesPostId\]/);
  assert.ok(route.indexOf("let result = await send()") < route.indexOf("deleteCampaignPostsByIds([scheduleSlot.replacesPostId]"));
});

test("Replacement applies exclusions before per-channel victim selection", () => {
  assert.match(route, /campaignExcludesChannel\(channelExclusions, Number\(campaign\.id\), channel\)/);
  assert.ok(route.indexOf("getEligibleChannels(campaign") < route.indexOf("selectEmergencyScheduleSlot(pool"));
});

test("public and private channel identifiers are excluded before scheduler or emergency delivery", () => {
  assert.match(exclusions, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(exclusions, /channel\.username, channel\.invite_link_hash/);
  assert.match(scheduler, /campaignExcludesChannel\(channelExclusions, campaign\.id, channel\)/);
  assert.match(route, /campaignExcludesChannel\(channelExclusions, Number\(campaign\.id\), channel\)/);
});

test("emergency broadcast push enforces campaign bot exclusions before posting", () => {
  assert.match(route, /loadCampaignExclusions\(pool, "campaign", \[Number\(campaign\.id\)\], "bot"\)/);
  assert.match(route, /healthyBots\.filter\(\(bot\) => !campaignExcludesIdentifier\(botExclusions, Number\(campaign\.id\), bot\.bot_username\)\)/);
  assert.match(route, /skippedByExclusion: healthyBots\.length - exclusionFilteredBots\.length/);
  assert.match(route, /eligible\.skippedByExclusion/);
});

test("emergency exclusions preserve canonical settlement and do not touch moderation or UI routes", () => {
  assert.doesNotMatch(route, /campaignLifecycleActions|channelSettlementLedger|publisher_revenue|advertiser_debit|creative_review_status|\/edit/);
  assert.match(route, /settleChannelCampaigns\(\{campaignId:Number\(victim\.campaign_id\),skipGlobalMaintenance:true,campaignStatuses:\["active","paused"\]\}/);
});
