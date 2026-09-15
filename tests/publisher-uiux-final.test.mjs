import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("publisher dashboard prioritizes authoritative today's earnings", () => {
  const page = read("src/app/publisher/page.tsx");
  const api = read("src/app/api/publisher/stats/route.ts");
  assert.match(page, /today_earnings/);
  assert.match(page, /publisher\.dashboard\.todayEarnings/);
  assert.match(api, /today_earnings: publisherSummary\.today\?\.earnings/);
  assert.doesNotMatch(page, /Refresh Pending|% CTR/);
});

test("publisher balances preserve available and locked earnings", () => {
  const page = read("src/app/publisher/page.tsx");
  assert.match(page, /balance_available/);
  assert.match(page, /balance_locked/);
  assert.match(page, /publisher\.dashboard\.lockedBalance/);
});

test("dashboard has compact inventory summary and actions", () => {
  const page = read("src/app/publisher/page.tsx");
  for (const token of ["total_channels", "total_bots", "total_miniapps", "addChannel", "addBot", "addMiniApp", "viewEarnings"]) assert.match(page, new RegExp(token));
  assert.match(page, /grid-cols-3/);
});

test("inventory filters are ordered, counted, searchable, and session persistent", () => {
  const page = read("src/app/publisher/monetize/page.tsx");
  const keys = ["all", "channels", "miniapps", "bots"].map((key) => page.indexOf(`[\"${key}\", t(\"publisher.inventory`));
  assert.ok(keys.every((value) => value >= 0));
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  assert.match(page, /publisher\.inventory\.type/);
  assert.match(page, /sessionStorage/);
  assert.match(page, /inventorySearch/);
  assert.match(page, /filteredCount === 0/);
});

test("inventory cards retain useful analytics and safe mobile constraints", () => {
  const page = read("src/app/publisher/monetize/page.tsx");
  for (const token of ["total_impressions", "total_clicks", "total_revenue", "active_count"]) assert.match(page, new RegExp(token));
  assert.match(page, /min-w-0/);
  assert.match(page, /truncate/);
});

test("publisher Growth presentation never exposes advertiser CPS", () => {
  const publisher = [read("src/app/publisher/page.tsx"), read("src/app/publisher/monetize/page.tsx"), read("src/app/publisher/earnings/page.tsx")].join("\n");
  assert.doesNotMatch(publisher, /Cost Per Subscriber|Pay Per Subscriber|\bCPS\b/);
});

test("publisher navigation keeps AI Support last and has no subscriber campaign menu", () => {
  const sidebar = read("src/components/layout/Sidebar.tsx");
  const publisherBlock = sidebar.slice(sidebar.indexOf("const publisherLinks"), sidebar.indexOf("const advertiserLinks"));
  assert.ok(publisherBlock.lastIndexOf("/publisher/ai-support") > publisherBlock.lastIndexOf("/publisher/faqs"));
  assert.doesNotMatch(publisherBlock, /Pay Per Subscriber|Subscriber Campaigns/);
});

test("publisher EN and RU keys have parity and real translations", () => {
  const en = read("src/i18n/en.ts");
  const ru = read("src/i18n/ru.ts");
  const keys = ["publisher.dashboard.todayEarnings", "publisher.dashboard.totalEarnings", "publisher.inventory.all", "publisher.inventory.searchPlaceholder", "publisher.inventory.noMatches"];
  for (const key of keys) {
    assert.match(en, new RegExp(`\"${key.replaceAll(".", "\\.")}\"`));
    assert.match(ru, new RegExp(`\"${key.replaceAll(".", "\\.")}\"`));
  }
  assert.match(ru, /Заработок сегодня/);
});

test("publisher stats returns inventory counts and hides raw backend errors", () => {
  const api = read("src/app/api/publisher/stats/route.ts");
  assert.match(api, /total_bots: assetCounts\.total_bots/);
  assert.match(api, /total_miniapps: assetCounts\.total_miniapps/);
  assert.doesNotMatch(api, /error: error\.message/);
});

test("direct-debit migrations and managed Growth cron remain integrated", () => {
  const deploy = read("deploy-vps.sh");
  assert.match(deploy, /20260908_0132_channel_growth\.sql/);
  assert.match(deploy, /20260909_0133_advertiser_direct_debit\.sql/);
  assert.match(deploy, /CRON_BASE\/channel-growth/);
});
