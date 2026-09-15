import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const publisherBots = readFileSync("src/app/api/publisher/bots/route.ts", "utf8");
const publisherStats = readFileSync("src/app/api/publisher/stats/route.ts", "utf8");
const earnings = readFileSync("src/app/api/publisher/earnings/route.ts", "utf8");
const advertiserStats = readFileSync("src/app/api/advertiser/stats/route.ts", "utf8");
const botDetails = readFileSync("src/app/api/publisher/bots/[id]/route.ts", "utf8");
const advertiserCampaignDetails = readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts", "utf8");
const botDetailsScreen = readFileSync("src/components/publisher/BotDetailsScreen.tsx", "utf8");

test("Bot reporting displays one impression per successful delivery while preserving earnings sums", () => {
  for (const source of [publisherBots, publisherStats, advertiserStats]) {
    assert.match(source, /COUNT\(\*\)|COUNT\(CASE WHEN bd\.status = 'sent' THEN 1 END\)|SUM\(CASE WHEN bd\.status = 'sent' THEN 1 ELSE 0 END\)/);
  }
  assert.match(publisherBots, /SUM\(bd\.publisher_reward\)/);
  assert.match(publisherStats, /SUM\(CASE WHEN bd\.status = 'sent' THEN bd\.publisher_reward ELSE 0 END\)/);
});

test("Bot earnings history reads successful broadcast rewards without writing duplicates", () => {
  assert.match(earnings, /FROM broadcast_deliveries bd/);
  assert.match(earnings, /bd\.status = 'sent'/);
  assert.match(earnings, /SUM\(bd\.publisher_reward\) as amount/);
  assert.doesNotMatch(earnings, /INSERT INTO|UPDATE broadcast_deliveries/);
});

test("Bot details tolerates a missing optional integration-events table", () => {
  assert.match(botDetails, /tableExists\("bot_integration_events"\)/);
  assert.match(botDetails, /const eventRows = hasBotIntegrationEvents/);
});

test("Bot delivery counts remain real while CPM uses displayed impressions", () => {
  assert.match(publisherBots, /const botDeliveredExpr/);
  assert.match(publisherBots, /\$\{botImpressionsExpr\} as total_impressions/);
  assert.match(publisherBots, /\$\{botDeliveredExpr\} as successful_sends/);
  assert.match(botDetails, /const botDeliveredExpr/);
  assert.match(botDetails, /\$\{botDeliveredExpr\} as successful_sends/);
  assert.match(botDetails, /\$\{botRevenueExpr\} \/ \$\{botSuccessfulExpr\}/);
});

test("Bot campaign details use the compatible Bot-only field set and invalid IDs return 404", () => {
  assert.match(advertiserCampaignDetails, /const isBotCampaign = campaignKinds\[0\]\.type === "broadcast"/);
  assert.match(advertiserCampaignDetails, /isBotCampaign\s*\? `SELECT id, name, campaign_title, message_text/);
  assert.match(advertiserCampaignDetails, /\{ error: "Campaign not found" \}, \{ status: 404 \}/);
});

test("Bot detail parsing accepts MySQL numeric strings from the listing response", () => {
  assert.match(botDetailsScreen, /successful_sends: Number\(data\.successful_sends/);
  assert.match(botDetailsScreen, /publisher_revenue: Number\(data\.publisher_revenue/);
  assert.match(botDetailsScreen, /effective_cpm: Number\(data\.effective_cpm/);
});
