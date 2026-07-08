import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts", "utf8");

test("emergency channel push enforces campaign channel exclusions before posting", () => {
  assert.match(route, /campaignExcludesIdentifier, loadCampaignExclusions/);
  assert.match(route, /loadCampaignExclusions\(pool, "campaign", \[Number\(campaign\.id\)\], "channel"\)/);
  assert.match(route, /channels\.filter\(\(channel\) => !campaignExcludesIdentifier\(channelExclusions, Number\(campaign\.id\), channel\.username\)\)/);
  assert.match(route, /skippedByExclusion: channels\.length - eligibleChannels\.length/);
  assert.match(route, /let skipped = skippedByLimit \+ skippedByExclusion/);
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
