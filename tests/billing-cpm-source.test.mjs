import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const billing = readFileSync("src/lib/channelBilling.ts", "utf8");
const settlement = readFileSync("src/lib/channelSettlement.ts", "utf8");
const fastBilling = readFileSync("src/lib/channelFastBilling.ts", "utf8");
const processAds = readFileSync("src/app/api/cron/process-ads/route.ts", "utf8");
const campaignCreate = readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
const adminCampaignRoute = readFileSync("src/app/api/admin/campaigns/[id]/route.ts", "utf8");
const advertiserWizard = readFileSync("src/app/advertiser/campaigns/new/[kind]/page.tsx", "utf8");
const channelReports = readFileSync("src/lib/channelReports.ts", "utf8");
const miniappReports = readFileSync("src/lib/miniappReports.ts", "utf8");
const miniappDashboard = readFileSync("src/components/publisher/MiniAppAnalyticsDashboard.tsx", "utf8");
const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
const cpcMigration = readFileSync("db/migrations/20260708_0098_campaign_cpc_billing.sql", "utf8");

function debit(units, bidPerThousand) {
  return Number((Math.floor(units) * (bidPerThousand / 1000)).toFixed(8));
}

test("view campaign billing uses CPM divided by 1000", () => {
  assert.equal(debit(1000, 3), 3);
  assert.equal(debit(1, 3), 0.003);
  assert.match(billing, /input\.type === "clicks" \? Number\(input\.cpc \|\| 0\) : Number\(input\.cpm \|\| 0\)/);
  assert.match(settlement, /getChannelUnitPrice\(\{ type: post\.campaign_type, cpm: post\.cpm, cpc: post\.cpc \}\)/);
});

test("click campaign billing uses CPC divided by 1000", () => {
  assert.equal(debit(1000, 50), 50);
  assert.equal(debit(1, 50), 0.05);
  assert.match(fastBilling, /getChannelUnitPrice\(\{ type: post\.campaign_type, cpm: post\.cpm, cpc: post\.cpc \}\)/);
  assert.match(processAds, /CASE WHEN c\.type = 'clicks' THEN COALESCE\(c\.cpc, 0\) ELSE COALESCE\(c\.cpm, 0\) END \/ 1000/);
});

test("CPC schema and campaign forms agree without opening financial counters", () => {
  assert.match(cpcMigration, /ALTER TABLE campaigns ADD COLUMN cpc DECIMAL\(18,8\) NOT NULL DEFAULT 0 AFTER cpm/);
  assert.match(cpcMigration, /UPDATE campaigns\s+SET cpc = cpm\s+WHERE type = 'clicks'/);
  assert.match(campaignCreate, /const cpc = type === "clicks"/);
  assert.match(campaignCreate, /budget, total_budget, cpm, cpc, category/);
  assert.match(adminCampaignRoute, /cpc: \{ type: "number", min: 0 \}/);
  assert.match(advertiserWizard, /bidField = formData\.type === "clicks" \? "cpc" : "cpm"/);
  for (const field of ["budget", "channel_spend", "settled_views", "settled_clicks", "status"]) {
    assert.doesNotMatch(adminCampaignRoute, new RegExp(`${field}: \\{`));
  }
});

test("publisher channel earnings remain merged for views and clicks", () => {
  assert.match(channelReports, /const earnings = rows\.reduce\(\(sum, row\) => sum \+ metricNumber\(row\.earnings\), 0\)/);
  assert.match(channelReports, /viewEarnings/);
  assert.match(channelReports, /clickEarnings/);
  assert.match(channelReports, /publisher_revenue: fixedMetric\(earnings, 8\)/);
});

test("Mini App CPM display and selected average use daily CPM values", () => {
  const dailyCpms = [1.2, 5, 3, 2, 8, 2, 1.2];
  assert.equal(Number((dailyCpms.reduce((sum, value) => sum + value, 0) / dailyCpms.length).toFixed(8)), 3.2);
  assert.match(miniappReports, /averageSelectedDailyCpm/);
  assert.match(miniappReports, /metricNumber\(row\.total_impressions\) > 0 && metricNumber\(row\.total_revenue\) > 0/);
  assert.match(miniappDashboard, /kind === "cpm" \? sample > 0 && value > 0 : hasMinimumCpcSample\(sample\)/);
});

test("publisher Earnings sidebar item is removed", () => {
  const publisherLinksBlock = sidebar.match(/const publisherLinks = \[[\s\S]*?\];/)?.[0] || "";
  assert.doesNotMatch(publisherLinksBlock, /name: "Earnings"/);
  assert.doesNotMatch(publisherLinksBlock, /\/publisher\/earnings/);
});
