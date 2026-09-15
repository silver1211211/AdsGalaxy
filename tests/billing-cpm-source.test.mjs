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
const statFormulas = readFileSync("src/lib/statFormulas.ts", "utf8");
const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
const cpcMigration = readFileSync("db/migrations/20260708_0098_campaign_cpc_billing.sql", "utf8");
const adminDeposits = readFileSync("src/app/api/admin/deposits/route.ts", "utf8");
const emergencyPush = readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts", "utf8");
const modal = readFileSync("src/components/ui/Modal.tsx", "utf8");
const discountSource = readFileSync("src/lib/advertiserDiscount.ts", "utf8");
const discountMigration = readFileSync("db/migrations/20260905_0127_advertiser_rate_discounts.sql", "utf8");
const discountApi = readFileSync("src/app/api/advertiser/rate-discount/route.ts", "utf8");
const adminUsers = readFileSync("src/app/api/admin/users/route.ts", "utf8");
const adminUsersPage = readFileSync("src/app/admin/users/page.tsx", "utf8");
const processBroadcast = readFileSync("src/app/api/cron/process-broadcast/route.ts", "utf8");

function debit(units, bidPerThousand) {
  return Number((Math.floor(units) * (bidPerThousand / 1000)).toFixed(8));
}

test("view campaign billing uses CPM divided by 1000", () => {
  assert.equal(debit(1000, 3), 3);
  assert.equal(debit(1, 3), 0.003);
  assert.match(billing, /input\.type === "clicks" \? Number\(input\.cpc \|\| 0\) : Number\(input\.cpm \|\| 0\)/);
  assert.match(settlement, /getChannelUnitPrice\(\{ type: post\.campaign_type, cpm: post\.cpm, cpc: post\.cpc, discount: post\.advertiser_discount \}\)/);
});

test("click campaign billing uses CPC divided by 1000", () => {
  assert.equal(debit(1000, 50), 50);
  assert.equal(debit(1, 50), 0.05);
  assert.match(fastBilling, /getChannelUnitPrice\(\{ type: post\.campaign_type, cpm: post\.cpm, cpc: post\.cpc, discount: post\.advertiser_discount \}\)/);
  assert.match(processAds, /ard\.expires_at > UTC_TIMESTAMP\(\)/);
});

test("per-user CPM and CPC discounts are absolute, expiring, and applied to live billing", () => {
  assert.equal(debit(1000, 65 - 3), 62);
  assert.equal(debit(1000, 3 - 0.2), 2.8);
  assert.match(discountSource, /Math\.max\(0\.01, gross - reduction\)/);
  assert.match(discountSource, /expires_at > UTC_TIMESTAMP\(\)/);
  assert.match(discountMigration, /CREATE TABLE IF NOT EXISTS advertiser_rate_discounts/);
  assert.match(discountApi, /getAuthenticatedUser/);
  assert.match(adminUsers, /action === "set_advertiser_discount"/);
  assert.match(adminUsersPage, /CPM\/CPC discount/);
  assert.match(advertiserWizard, /charged \$\{effectiveBid\.toFixed\(2\)\} \/ 1k/);
  assert.match(processBroadcast, /calculateBroadcastPayout\(campaign\.effective_cpm/);
  assert.match(emergencyPush, /campaign\.effective_cpm \?\? campaign\.cpm/);
});

test("channel budget exhaustion uses the next billable unit for CPM and CPC", () => {
  const affordable = (remaining, bidPerThousand) => Math.max(0, Math.floor((remaining + 1e-10) / (bidPerThousand / 1000)));
  assert.equal(debit(4000, 2.5), 10);
  assert.equal(affordable(0.01, 2.5), 4);
  assert.equal(debit(4, 2.5), 0.01);
  assert.equal(affordable(0.0025, 2.5), 1);
  assert.equal(affordable(0.0024, 2.5), 0);
  assert.equal(affordable(0, 2.5), 0);
  assert.equal(debit(1, 50), 0.05);
  assert.equal(affordable(0.05, 50), 1);
  assert.equal(affordable(0.049, 50), 0);
  assert.match(settlement, /const isExhausted = remaining < unitPrice \|\| remaining <= 0/);
  assert.match(settlement, /if \(currentBudget \+ 1e-10 < unitPrice\)[\s\S]*markCampaignBudgetExhausted/);
  assert.match(fastBilling, /remaining <= 0 \|\| remaining \+ 1e-10 < unitPrice/);
  assert.match(fastBilling, /SELECT id FROM channel_advertiser_debits WHERE source_key=\?/);
  assert.match(fastBilling, /const unbilledUnits = Math\.max\(0, confirmedUnits - alreadySettled\)/);
  assert.match(fastBilling, /catch \(error\) \{ await conn\.rollback\(\)/);
});

test("CPC schema and campaign forms agree without opening financial counters", () => {
  assert.match(cpcMigration, /ALTER TABLE campaigns ADD COLUMN cpc DECIMAL\(18,8\) NOT NULL DEFAULT 0 AFTER cpm/);
  assert.match(cpcMigration, /UPDATE campaigns\s+SET cpc = cpm\s+WHERE type = 'clicks'/);
  assert.match(campaignCreate, /const cpc = type === "clicks"/);
  for (const column of ["budget", "total_budget", "cpm", "cpc", "category", "teaser_mode", "teaser_enabled", "teaser_cpm"]) {
    assert.match(campaignCreate, new RegExp(`\\b${column}\\b`));
  }
  assert.match(adminCampaignRoute, /cpc: \{ type: "number", min: 0 \}/);
  assert.match(advertiserWizard, /bidField = formData\.type === "clicks" \? "cpc" : "cpm"/);
  for (const field of ["budget", "channel_spend", "settled_views", "settled_clicks", "status"]) {
    assert.doesNotMatch(adminCampaignRoute, new RegExp(`${field}: \\{`));
  }
});

test("publisher channel earnings remain merged for views and clicks", () => {
  assert.match(channelReports, /const earnings = rows\.reduce\(\(sum, row\) => sum \+ metricNumber\(row\.earnings\), 0\)/);
  assert.match(channelReports, /clickEarnings/);
  assert.match(channelReports, /publisher_revenue: fixedMetric\(earnings, 8\)/);
});

test("publisher CPM and CPC display from the first qualifying event", () => {
  assert.match(miniappReports, /averageSelectedDailyCpm/);
  assert.match(miniappReports, /return cpm\(totals\.revenue, totals\.impressions\)/);
  assert.match(miniappDashboard, /kind === "cpm" \? hasMinimumCpmSample\(sample\) : hasMinimumCpcSample\(sample\)/);
  assert.match(miniappDashboard, /formatDisplayedCpmFromRevenue\(row\.publisher_revenue, row\.impressions\)/);
  assert.match(statFormulas, /MIN_CPM_SAMPLE_SIZE = 1/);
  assert.match(statFormulas, /MIN_CPC_SAMPLE_SIZE = 1/);
  assert.match(channelReports, /average_cpm: cpm\(earnings, views\)/);
  assert.match(channelReports, /cpm_eligible: views > 0 && \(viewEarnings > 0 \|\| clicks > 0\)/);
  assert.match(miniappDashboard, /\(revenue \/ impressions\) \* 1000/);
});

test("publisher Earnings sidebar item is removed", () => {
  const publisherLinksBlock = sidebar.match(/const publisherLinks = \[[\s\S]*?\];/)?.[0] || "";
  assert.doesNotMatch(publisherLinksBlock, /name: "Earnings"/);
  assert.doesNotMatch(publisherLinksBlock, /\/publisher\/earnings/);
});

test("admin production blockers stay fixed", () => {
  assert.match(modal, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(modal, /overflow-y-auto/);
  assert.doesNotMatch(adminDeposits, /d\.tx_hash/);
  assert.match(adminDeposits, /d\.txn_id LIKE \?/);
  assert.match(adminDeposits, /d\.status LIKE \?/);
  assert.match(emergencyPush, /hasActiveUndeletedCampaignPost/);
  assert.match(emergencyPush, /mode === "fill_empty_slots" && followRules/);
  assert.match(emergencyPush, /await hasRecentChannelPost\(channel\.id\)/);
  assert.match(emergencyPush, /await hasCampaignPostWithin24Hours\(campaign\.id, channel\.id\)/);
  assert.match(emergencyPush, /mode === "replace_everything" && await hasActiveUndeletedCampaignPost/);
  assert.match(emergencyPush, /channelCampaignMatchesInventory\(\{/);
});
