import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const math = await import(new URL("../src/lib/campaignStatisticMath.ts", import.meta.url));
const panel = read("src/components/advertiser/CampaignStatisticsPanel.tsx");
const details = read("src/components/advertiser/CampaignDetailsScreen.tsx");
const report = read("src/lib/advertiserCampaignStatistics.ts");
const route = read("src/app/api/advertiser/campaigns/[id]/statistics/route.ts");

test("Views campaign makes Views the primary metric", () => {
  assert.match(report, /campaign\.type === "clicks" \? "clicks" : "views"/);
  assert.match(panel, /primary === "views" \? Eye : MousePointer2/);
});

test("Click campaign makes Clicks the primary metric", () => {
  assert.match(panel, /campaignType === "clicks" \? "clicks" : "views"/);
});

test("both Views and Clicks remain visible", () => {
  assert.match(panel, /advertiser\.statistics\.views/);
  assert.match(panel, /advertiser\.statistics\.clicks/);
});

test("CTR calculation is correct", () => {
  assert.equal(math.campaignCtr(35, 1000), 3.5);
});

test("CTR safely returns zero without views", () => {
  assert.equal(math.campaignCtr(4, 0), 0);
});

test("selected-period spend comes from real advertiser charge authorities", () => {
  assert.match(report, /channel_advertiser_debits/);
  assert.match(report, /channel_settlement_ledger/);
  assert.match(report, /metricNumber\(charges\.spend\)/);
  assert.doesNotMatch(report, /Math\.random/);
});

test("Effective CPM uses actual spend and billable views", () => {
  assert.equal(math.campaignEffectiveCpm(18.72, 12_540), 1.49282297);
});

test("Average CPC uses actual spend and billable clicks", () => {
  assert.equal(math.campaignAverageCpc(18.72, 438), 0.04273973);
  assert.equal(math.campaignAverageCpc(18.72, 0), 0);
});

test("Today is default and preset/custom ranges are supported", () => {
  for (const range of ["today", "yesterday", "7d", "14d", "30d", "custom"]) assert.match(panel, new RegExp(`"${range}"`));
  assert.match(panel, /useState<Selection>\(\{ key: "today" \}\)/);
  assert.match(panel, /type="date"/);
  assert.match(report, /MAX_CAMPAIGN_STATISTICS_DAILY_ROWS - 1/);
});

test("statistics response and daily SQL are bounded", () => {
  assert.match(report, /MAX_CAMPAIGN_STATISTICS_DAILY_ROWS = 30/);
  assert.match(report, /LIMIT \$\{MAX_CAMPAIGN_STATISTICS_DAILY_ROWS\}/);
});

test("Campaign page is not globally blocked by statistics loading", () => {
  assert.match(details, /<CampaignStatisticsPanel/);
  assert.match(panel, /loading && !data/);
  assert.match(panel, /AbortController/);
});

test("empty and isolated error states are safe", () => {
  assert.match(panel, /advertiser\.statistics\.empty/);
  assert.match(panel, /advertiser\.statistics\.error/);
  assert.match(panel, /common\.retry/);
});

test("Teaser clicks remain analytics-only and never CPC billable", () => {
  assert.match(report, /FROM teaser_clicks/);
  assert.match(report, /COUNT\(\*\), 0, 0, 0, 0, 0/);
  assert.match(route, /type IN \('views','clicks'\)/);
});

test("direct-debit and campaign financial mutation authority are unchanged", () => {
  assert.doesNotMatch(report, /UPDATE\s+(users|campaigns)|INSERT\s+INTO\s+advertiser_transactions/i);
  assert.doesNotMatch(route, /UPDATE\s+(users|campaigns)|INSERT\s+INTO\s+advertiser_transactions/i);
  assert.match(report, /metricNumber\(charges\.spend\)/);
});

test("selected period controls summary, trend, and daily rows", () => {
  assert.match(report, /fetchAnalyticsSummary\(campaign\.id, range\)/);
  assert.match(report, /fetchChargeSummary\(campaign\.id, range\)/);
  assert.match(report, /fetchDaily\(campaign\.id, range\)/);
  assert.match(panel, /totals\?\.\[primary\]/);
  assert.doesNotMatch(panel, /todayPerformance|todaySpend|todayViews|todayClicks|todayCtr/);
});

test("Average CPC uses selected spend divided by selected actual clicks and renders three decimals", () => {
  assert.match(report, /campaignAverageCpc\(totalSpend, totalClicks\)/);
  assert.match(panel, /toFixed\(3\)/);
});

test("EN and RU statistics catalogs have parity", () => {
  const en = read("src/i18n/en.ts");
  const ru = read("src/i18n/ru.ts");
  for (const key of [
    "advertiser.statistics.title",
    "advertiser.statistics.todayPerformance",
    "advertiser.statistics.range.all",
    "advertiser.statistics.error",
  ]) {
    assert.match(en, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
    assert.match(ru, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
  }
});

test("standard campaign Statistics omits creative preview and placement history", () => {
  const standardBranch = details.slice(details.indexOf("usesUnifiedStatistics ?"), details.indexOf("{/* Stats Grid */}"));
  assert.match(standardBranch, /CampaignStatisticsPanel/);
  assert.doesNotMatch(standardBranch, /Live Preview|Posts History|composeCampaignCreativeText/);
});

test("standard campaign Statistics omits budget overview and progress", () => {
  assert.match(details, /!usesUnifiedStatistics &&/);
  const standardBranch = details.slice(details.indexOf("usesUnifiedStatistics ?"), details.indexOf("{/* Stats Grid */}"));
  assert.doesNotMatch(standardBranch, /Budget Overview|Progress|Campaign Budget|Remaining/);
});
