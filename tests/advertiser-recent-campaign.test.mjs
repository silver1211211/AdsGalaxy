import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = process.cwd();
const read = (path) => fs.readFileSync(`${root}/${path}`, "utf8");

test("advertiser stats bounds the newest campaign deterministically", () => {
  const route = read("src/app/api/advertiser/stats/route.ts");
  assert.match(route, /FROM campaigns WHERE user_id=\? ORDER BY created_at DESC,id DESC LIMIT 1/);
  assert.match(route, /FROM miniapp_rewarded_campaigns WHERE advertiser_id=\? ORDER BY created_at DESC,id DESC LIMIT 1/);
  assert.match(route, /ORDER BY created_at DESC,id DESC,source ASC LIMIT 1/);
  assert.match(route, /CASE WHEN type='broadcast'.*broadcast_deliveries.*ELSE channel_spend END spend/s);
});

test("dashboard recent campaign is compact and links to the exact statistics record", () => {
  const dashboard = read("src/app/advertiser/page.tsx");
  const section = dashboard.slice(dashboard.indexOf("{/* Recent Campaign */}"), dashboard.indexOf("{/* Quick Actions */}"));
  assert.match(section, /recent_campaigns\.slice\(0, 1\)/);
  assert.match(section, /statisticsSource.*campaign\.id/);
  assert.match(section, /\/advertiser\/campaigns\?statistics=/);
  assert.match(section, /campaign-statistics-target/);
  assert.match(section, /common\.campaigns/);
  assert.match(section, /advertiser\.dashboard\.spent/);
  assert.match(section, /common\.statistics/);
  for (const obsolete of ["today_impressions", "yesterday_impressions", "today_spend", "engagementMetric", "Impressions"]) {
    assert.doesNotMatch(section, new RegExp(obsolete));
  }
});

test("campaign list consumes its canonical statistics deep link without changing list bounds", () => {
  const campaigns = read("src/app/advertiser/campaigns/page.tsx");
  assert.match(campaigns, /get\("statistics"\)/);
  assert.match(campaigns, /campaigns\.find\(\(item\) => item\.id === id/);
  assert.match(campaigns, /setViewingCampaign\(campaign\)/);
  assert.match(campaigns, /miniapp-rewarded-campaigns\/\$\{id\}/);
  assert.match(campaigns, /api\/advertiser\/campaigns\/\$\{id\}/);
  assert.match(campaigns, /campaign-statistics-target/);
  assert.match(campaigns, /statisticsRequestHandled\.current = true/);
  assert.doesNotMatch(campaigns, /setStatisticsRequestHandled\(true\)/);
});

test("recent campaign labels are localized in English and Russian", () => {
  const en = read("src/i18n/en.ts");
  const ru = read("src/i18n/ru.ts");
  for (const key of [
    "advertiser.dashboard.recentCampaigns",
    "advertiser.dashboard.viewAll",
    "advertiser.dashboard.spent",
    "advertiser.dashboard.miniAppCampaign",
    "advertiser.dashboard.rewardedViews",
  ]) {
    assert.match(en, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
    assert.match(ru, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
  }
  assert.match(en, /"advertiser\.dashboard\.recentCampaigns": "Recent Campaign"/);
});

test("dashboard uses the shared human-readable campaign status badge", () => {
  const dashboard = read("src/app/advertiser/page.tsx");
  assert.match(dashboard, /CampaignStatusBadge status=\{campaign\.status\}/);
  assert.doesNotMatch(dashboard, /<StatusText value=\{campaign\.status\}/);
});
