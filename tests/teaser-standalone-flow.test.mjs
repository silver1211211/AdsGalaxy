import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Teaser is offered as a standalone campaign and has no bundled Views toggle", () => {
  const chooser = read("src/app/advertiser/campaigns/new/page.tsx");
  const dashboard = read("src/app/advertiser/page.tsx");
  const wizard = read("src/app/advertiser/campaigns/new/[kind]/page.tsx");
  assert.match(chooser, /key: "teaser".*type=teaser/);
  assert.match(dashboard, /new\/growth/);
  assert.match(dashboard, /type=teaser/);
  assert.doesNotMatch(wizard, /standard_plus_teaser/);
  assert.doesNotMatch(wizard, /Discover a faster way to grow/);
  assert.match(wizard, /useState\(\["", ""\]\)/);
});

test("server rejects creation of a new Views plus Teaser campaign", () => {
  const create = read("src/app/api/advertiser/campaigns/route.ts");
  const update = read("src/app/api/advertiser/campaigns/[id]/route.ts");
  assert.match(create, /requestedTeaserMode==="standard_plus_teaser".*TEASER_STANDALONE_ONLY/);
  assert.match(update, /requestedTeaserMode==="standard_plus_teaser".*campaign\.teaser_mode/);
});

test("Emergency Teaser Push lives in detailed Admin campaign view, not analytics", () => {
  const analytics = read("src/app/admin/teaser-analytics/page.tsx");
  const details = read("src/app/admin/campaigns/[id]/page.tsx");
  const control = read("src/components/admin/AdminTeaserEmergencyPanel.tsx");
  assert.doesNotMatch(analytics, /teaser\/emergency-push|recentJobs|confirmPush/);
  assert.match(details, /teaser_mode === "teaser_only".*AdminTeaserEmergencyPanel/);
  assert.match(details, /teaser_mode !== "teaser_only"/);
  assert.match(control, /api\/admin\/teaser\/emergency-push/);
  assert.match(control, /idempotency_key/);
});

test("campaign statistics use one period-based presentation without a Teaser split", () => {
  const panel = read("src/components/advertiser/CampaignStatisticsPanel.tsx");
  const details = read("src/components/advertiser/CampaignDetailsScreen.tsx");
  const route = read("src/app/api/advertiser/campaigns/[id]/statistics/route.ts");
  assert.doesNotMatch(panel, /sourceBreakdown/);
  assert.match(panel, /campaignLabel/);
  assert.match(details, /usesUnifiedStatistics/);
  assert.match(route, /miniapp.*bot.*growth/);
});

test("standalone campaign labels exist in both catalogs", () => {
  const en = read("src/i18n/en.ts");
  const ru = read("src/i18n/ru.ts");
  for (const key of ["advertiser.chooser.teaser.title", "advertiser.chooser.teaser.description"]) {
    assert.ok(en.includes(`"${key}"`));
    assert.ok(ru.includes(`"${key}"`));
  }
});

test("dashboard and campaign-section objective pickers expose concise standalone choices", () => {
  const dashboard = read("src/app/advertiser/page.tsx");
  const campaigns = read("src/app/advertiser/campaigns/page.tsx");
  const en = read("src/i18n/en.ts");
  const ru = read("src/i18n/ru.ts");
  for (const source of [dashboard, campaigns]) {
    assert.match(source, /campaigns\/new\/growth/);
    assert.match(source, /campaigns\/new\/channel\?type=teaser/);
    assert.match(source, /advertiser\.chooser\.growth\.description/);
    assert.match(source, /advertiser\.chooser\.teaser\.description/);
  }
  assert.match(en, /"advertiser\.chooser\.growth\.description": "Pay per subscriber"/);
  assert.match(en, /"advertiser\.chooser\.teaser\.description": "Short sponsored messages"/);
  assert.match(ru, /"advertiser\.chooser\.growth\.description": "Оплата за подписчика"/);
  assert.match(ru, /"advertiser\.chooser\.teaser\.description": "Короткие рекламные сообщения"/);
});
