import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts", "utf8");
const scheduler = readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
const exclusions = readFileSync("src/lib/campaignInventoryExclusions.ts", "utf8");

test("emergency channel push enforces campaign channel exclusions before posting", () => {
  assert.match(route, /campaignExcludesChannel, campaignExcludesIdentifier, loadCampaignExclusions/);
  assert.match(route, /loadCampaignExclusions\(pool, "campaign", \[Number\(campaign\.id\)\], "channel"\)/);
  assert.match(route, /channels\.filter\(\(channel\) => !campaignExcludesChannel\(channelExclusions, Number\(campaign\.id\), channel\)\)/);
  assert.match(route, /skippedByExclusion: channels\.length - eligibleChannels\.length/);
  assert.match(route, /let skipped = skippedByLimit \+ skippedByExclusion/);
});

test("Replace Everything continues only after safe rolled-back settlement failures", () => {
  assert.match(route, /function classifySettlementFailure/);
  assert.match(route, /"payout_safety_check_failed"/);
  assert.match(route, /fatalSettlementFailures\.length > 0/);
  assert.match(route, /deleteSummary = await deleteActivePostsForReplacementSafely/);
  assert.match(route, /warnings: safeSettlementWarnings/);
});

test("Replace Everything protects excluded campaign channels from cleanup and reposting", () => {
  assert.match(route, /SELECT DISTINCT ch\.id, ch\.username, ch\.invite_link_hash/);
  assert.match(route, /\.filter\(\(channel\) => campaignExcludesChannel\(channelExclusions, Number\(campaign\.id\), channel\)\)/);
  assert.match(route, /deleteActivePostsForReplacementSafely\(campaign\.id, excludedChannelIds\)/);
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
  assert.match(route, /const skipped = skippedByLimit \+ skippedByExclusion/);
});

test("emergency exclusions do not change lifecycle settlement billing moderation or UI routes", () => {
  assert.doesNotMatch(route, /campaignLifecycleActions|channelSettlementLedger|publisher_revenue|advertiser_debit|creative_review_status|\/edit/);
  assert.match(route, /settleChannelCampaigns\(\{\s*campaignId: campaign\.id,\s*skipGlobalMaintenance: true,\s*campaignStatuses: \["active"\],\s*\}\)/);
});
