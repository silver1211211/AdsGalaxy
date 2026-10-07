import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("views campaigns separate raw traffic, billable display, clicks, CTR and CPM", () => {
  const rawViews = 100;
  const billableViews = 30;
  const actualClicks = 7;
  const spend = 0.3;

  assert.equal(billableViews, 30);
  assert.equal(actualClicks, 7);
  assert.equal(Number(((actualClicks / billableViews) * 100).toFixed(8)), 23.33333333);
  assert.equal((spend / billableViews) * 1000, 10);
  assert.notEqual((spend / rawViews) * 1000, 10);

  const math = read("src/lib/campaignStatisticMath.ts");
  assert.match(math, /visibleViews:\s*input\.kind === "views" \? billableViews : rawViews/);
  assert.match(math, /visibleClicks:\s*actualClicks/);
  assert.match(math, /ctr:\s*campaignCtr\(actualClicks, input\.kind === "views" \? billableViews : rawViews\)/);
  assert.match(math, /campaignEffectiveCpm\(spend, billableViews\)/);
  assert.match(math, /averageCpc:\s*input\.kind === "clicks"/);
});

test("advertiser statistics use the shared semantics while retaining named raw views", () => {
  const source = read("src/lib/advertiserCampaignStatistics.ts");
  assert.match(source, /channelAdvertiserMetrics\(/);
  assert.match(source, /views:\s*metrics\.visibleViews/);
  assert.match(source, /clicks:\s*metrics\.visibleClicks/);
  assert.match(source, /raw_views:\s*metrics\.rawViews/);
  assert.match(source, /effective_cpm:\s*metrics\.effectiveCpm/);
});

test("advertiser list, feed, details and dashboard source billable view units", () => {
  const list = read("src/app/api/advertiser/campaigns/route.ts");
  const feed = read("src/app/api/advertiser/campaign-feed/route.ts");
  const details = read("src/app/api/advertiser/campaigns/[id]/route.ts");
  const dashboard = read("src/app/api/advertiser/stats/route.ts");
  for (const source of [list, feed, details, dashboard]) {
    assert.match(source, /channel_advertiser_debits/);
    assert.match(source, /channel_settlement_ledger/);
    assert.match(source, /settlement_type='view'/);
  }
  assert.match(list, /channelSettledSpendExpr/);
  assert.match(feed, /settled_spend/);
  assert.match(details, /settled_spend/);
  assert.match(dashboard, /delivery\.channel_spend/);
  assert.match(details, /raw_total_views/);
});

test("raw publisher traffic is never rewritten to billable traffic", () => {
  const fast = read("src/lib/channelFastBilling.ts");
  const settlement = read("src/lib/channelSettlement.ts");
  assert.match(fast, /Math\.min\(Math\.max\(0, Math\.floor\(input\.requestedUnits\)\), unbilledUnits, affordableUnits\)/);
  assert.doesNotMatch(fast, /UPDATE campaign_posts SET views\s*=/);
  assert.doesNotMatch(settlement, /UPDATE campaign_posts SET views\s*=/);
  assert.match(settlement, /const settledColumn = kind === "view" \? "settled_views" : "settled_clicks"/);
});

test("budget-exhausted raw excess is terminal for cleanup without changing raw views", () => {
  const cleanup = read("src/lib/campaignPostDeletion.ts");
  assert.match(cleanup, /c\.status = 'budget_exhausted'[\s\S]*COALESCE\(cp\.views, 0\) <= COALESCE\(cp\.settled_views, 0\)/);
  assert.match(cleanup, /NOT EXISTS \([\s\S]*channel_advertiser_debits[\s\S]*publisher_status <> 'settled'/);
});

test("click campaign commercial settlement remains click-unit based", () => {
  const fast = read("src/lib/channelFastBilling.ts");
  const settlement = read("src/lib/channelSettlement.ts");
  assert.match(fast, /input\.type === "click" \? Number\(post\.settled_clicks/);
  assert.match(settlement, /kind === "view" \? totalViews - oldViews - waivedViews : totalClicks - oldClicks/);
  assert.match(settlement, /kind === "view" \? "settled_views" : "settled_clicks"/);
});

test("15-minute view fetch leaves publisher rollups to the hourly settlement job", () => {
  const fetcher = read("src/app/api/cron/update-views/route.ts");
  const settlement = read("src/lib/channelSettlement.ts");
  assert.doesNotMatch(fetcher, /import \{ aggregateChannelStatistics \}/);
  assert.match(fetcher, /hourly_channel_settlement_job/);
  assert.match(settlement, /aggregateChannelStatistics\(\)/);
});

test("numeric view timestamps support both epoch milliseconds and legacy YYYYMMDDHHMMSS", () => {
  const fetcher = read("src/app/api/cron/update-views/route.ts");
  assert.match(fetcher, /ELSE FROM_UNIXTIME\(cp\.last_views_update \/ 1000\)/);
  assert.match(fetcher, /cp\.last_views_update >= 10000000000000/);
  assert.match(fetcher, /STR_TO_DATE\(CAST\(cp\.last_views_update AS CHAR\), '%Y%m%d%H%i%s'\)/);
  assert.match(fetcher, /TIMESTAMPDIFF\(SECOND, \$\{lastUpdateOrder\}, NOW\(\)\)/);
});

test("MTProto cooldown skips cannot mask the precise attempted-account failure", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");
  assert.match(mtproto, /const actualFailureCodes: string\[\] = \[\]/);
  assert.match(mtproto, /actualFailures === 0 && codes\.includes\("rate_limited"\)/);
  assert.match(mtproto, /actualFailureCodes\.every\(\(code\) => code === actualFailureCodes\[0\]\)/);
});
