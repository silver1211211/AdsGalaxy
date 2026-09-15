import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTs(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = fs.readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/")) return loadTs(`src/${specifier.slice(2)}.ts`);
    return nativeRequire(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

const audience = loadTs("src/lib/channelAudience.ts");
const analytics = loadTs("src/lib/audienceAnalytics.ts");

function explicit(audiences) {
  return audience.serializeExplicitCampaignAudience(audiences);
}

function matches(campaignAudiences, channelAudience, campaignCategory = "tech", channelCategories = ["Tech"]) {
  return audience.channelCampaignMatchesInventory({
    campaignCategory,
    campaignAudience: campaignAudiences,
    channelCategories,
    channelAudience,
  });
}

test("Global delivery is a wildcard across classified audiences while regional delivery is exact", () => {
  assert.equal(matches(explicit(["global"]), ["global"]), true);
  assert.equal(matches(explicit(["global"]), ["africa"]), true);
  assert.equal(matches(explicit(["global"]), ["asia"]), true);
  assert.equal(matches(explicit(["global"]), ["europe"]), true);
  assert.equal(matches(explicit(["global"]), ["north_america"]), true);
  assert.equal(matches(explicit(["global"]), ["south_america"]), true);
  assert.equal(matches(explicit(["global"]), ["oceania"]), true);
  assert.equal(matches(explicit(["asia"]), ["global"]), false);
  assert.equal(matches(explicit(["asia"]), ["asia"]), true);
  assert.equal(matches(explicit(["asia"]), ["africa"]), false);
  assert.equal(matches(explicit(["europe", "asia"]), ["europe"]), true);
  assert.equal(matches(explicit(["europe", "asia"]), ["asia"]), true);
  assert.equal(matches(explicit(["europe", "asia"]), ["africa"]), false);
  assert.equal(matches(explicit(["europe", "asia"]), ["global"]), false);
});

test("Global is exclusive and explicit targeting requires supported values", () => {
  assert.throws(() => explicit(["global", "africa"]), /Global cannot be combined/);
  assert.throws(() => explicit([]), /at least one/);
  assert.throws(() => explicit(["antarctica"]), /unsupported/);
  assert.throws(() => audience.normalizeChannelAudience(["africa", "asia"]), /exactly one/);
  assert.throws(() => audience.normalizeChannelAudience(["global"]), /specific channel audience/);
  assert.throws(() => audience.normalizeChannelAudience(["antarctica"]), /unsupported/);
});

test("legacy campaigns remain unrestricted while explicit campaigns exclude unclassified channels", () => {
  assert.deepEqual(audience.parseCampaignAudienceTargeting('["global","africa","asia"]'), { mode: "legacy_unrestricted" });
  assert.equal(matches('["global","africa","asia"]', null), true);
  assert.equal(matches(explicit(["asia"]), null), false);
  assert.equal(matches(explicit(["global"]), null), false);
  assert.equal(matches(explicit(["asia"]), ["asia", "europe"]), false);
  assert.equal(matches(explicit(["asia"]), ["asia", "unsupported"]), false);
});

test("category matching remains required by the shared eligibility helper", () => {
  assert.equal(matches(explicit(["asia"]), ["asia"], "tech", ["Finance"]), false);
  assert.equal(matches(explicit(["asia"]), ["asia"], "tech", ["Tech"]), true);
});

test("legacy Global and unknown audiences remain visible in authoritative active inventory", () => {
  assert.equal(audience.classifyChannelAudience(["Global", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"]), "global");
  assert.equal(audience.audienceForCountryCode("NG"), "africa");
  assert.equal(audience.audienceForCountryCode("US"), "north_america");
  assert.equal(audience.audienceForCountryCode("ZZ"), null);
  const channels = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    subscriber_count: 1,
    audience_continents: [["africa"], ["asia"], ["europe"], ["north_america"], ["south_america"], ["oceania"], ["global"], null][index],
  }));
  const result = analytics.buildAudienceAnalytics(channels, []);
  assert.equal(result.find((item) => item.key === "all").channels, 8);
  assert.equal(result.find((item) => item.key === "global").channels, 1);
  assert.equal(result.find((item) => item.key === "unclassified").channels, 1);
});

test("analytics returns Global roll-up plus six regions, period totals, combined Mini App summary, and zero-safe CTR", () => {
  const result = analytics.buildAudienceAnalytics([], []);
  assert.deepEqual(result.map((item) => item.key), [
    "all", "global", "africa", "asia", "europe", "north_america", "south_america", "oceania", "unclassified",
  ]);
  assert.equal(analytics.calculateCtr(10, 0), 0);
  const regional = analytics.buildAudienceAnalytics(
    [{ id: 1, subscriber_count: 1, audience_continents: ["europe"] }],
    [{ channel_id: 1, today_views: 10, today_clicks: 1, weekly_views: 70, weekly_clicks: 7, monthly_views: 300, monthly_clicks: 30 }],
  );
  assert.deepEqual(regional.find((item) => item.key === "europe").weekly, { views: 70, clicks: 7, ctr: 10 });
  assert.deepEqual(regional.find((item) => item.key === "all").weekly, { views: 70, clicks: 7, ctr: 10 });
  const summary = analytics.buildAnalyticsSummary(regional, {
    today_views: 5, today_clicks: 1, weekly_views: 30, weekly_clicks: 3, monthly_views: 100, monthly_clicks: 10,
  });
  assert.deepEqual(summary.weekly, { views: 100, clicks: 10, ctr: 10 });
});

test("publisher channel inputs expose and accept only the six specific regions", () => {
  const form = fs.readFileSync(path.join(root, "src/components/publisher/AddChannelForm.tsx"), "utf8");
  const screen = fs.readFileSync(path.join(root, "src/components/publisher/AddChannelScreen.tsx"), "utf8");
  assert.deepEqual(audience.PUBLISHER_CHANNEL_AUDIENCE_OPTIONS.map((option) => option.value), [
    "africa", "asia", "europe", "north_america", "south_america", "oceania",
  ]);
  assert.match(form, /PUBLISHER_CHANNEL_AUDIENCE_OPTIONS\.map/);
  assert.doesNotMatch(screen, /value: "global", name: "Global"/);
});

test("normal and Emergency delivery call the same shared eligibility helper", () => {
  const normal = fs.readFileSync(path.join(root, "src/app/api/cron/process-ads/route.ts"), "utf8");
  const emergency = fs.readFileSync(path.join(root, "src/app/api/admin/campaigns/[id]/emergency-push/route.ts"), "utf8");
  assert.match(normal, /channelCampaignMatchesInventory\(\{/);
  assert.match(emergency, /channelCampaignMatchesInventory\(\{/);
  assert.match(emergency, /campaignCategory: campaign\.category/);
  assert.match(emergency, /campaignAudience: campaign\.continents/);
  assert.equal(matches(explicit(["global"]), ["africa"]), true);
  assert.equal(matches(explicit(["asia"]), ["global"]), false);
});

test("campaign API stores explicit configuration and UI enforces Global exclusivity", () => {
  const createRoute = fs.readFileSync(path.join(root, "src/app/api/advertiser/campaigns/route.ts"), "utf8");
  const editRoute = fs.readFileSync(path.join(root, "src/app/api/advertiser/campaigns/[id]/route.ts"), "utf8");
  const form = fs.readFileSync(path.join(root, "src/app/advertiser/campaigns/new/[kind]/page.tsx"), "utf8");
  const details = fs.readFileSync(path.join(root, "src/components/advertiser/CampaignDetailsScreen.tsx"), "utf8");
  assert.match(createRoute, /serializeExplicitCampaignAudience\(continents\)/);
  assert.match(editRoute, /serializeExplicitCampaignAudience\(body\.continents\)/);
  assert.match(form, /continents: prev\.continents\.includes\("global"\) \? \[\] : \["global"\]/);
  assert.match(form, /withoutGlobal = prev\.continents\.filter/);
  assert.match(form, /Select at least one target audience/);
  assert.match(details, /Array\.isArray\(\(parsed as \{ audiences\?: unknown \}\)\.audiences\)/);
});

test("admin navigation, dashboard removal, Promote feature, and mobile layout source are preserved", () => {
  const menu = fs.readFileSync(path.join(root, "src/components/layout/AdminLayout.tsx"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "src/app/admin/page.tsx"), "utf8");
  const page = fs.readFileSync(path.join(root, "src/app/admin/audience-analytics/page.tsx"), "utf8");
  assert.match(menu, /href: "\/admin\/audience-analytics"[^\n]+label: "Audience Analytics"/);
  assert.doesNotMatch(menu, /href: "\/admin\/promote-ads-galaxy"[^\n]+label: "Promote AdsGalaxy"/);
  assert.doesNotMatch(dashboard, /Audience by country|UNASSIGNED|Unassigned/);
  assert.equal(fs.existsSync(path.join(root, "src/app/admin/promote-ads-galaxy/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(root, "src/app/api/admin/promote-ads-galaxy/route.ts")), true);
  assert.doesNotMatch(page, /href="\/admin\/promote-ads-galaxy"|Promotion controls/);
  assert.match(page, /Needs audience classification/);
  assert.match(page, /Authoritative active inventory/);
  assert.match(page, /All delivery — channels \+ Mini App/);
  assert.match(page, /Last 7 days — totals/);
  assert.match(page, /Last 30 days — totals/);
  assert.match(page, /grid min-w-0 gap-3 xl:grid-cols-2/);
  assert.doesNotMatch(page, /min-w-\[[0-9]+px\]|overflow-x-auto|<table/);
});

test("current non-conflicting authoritative GEO wins and unknown never becomes Global", () => {
  assert.equal(analytics.effectiveChannelAudience({ id: 1, subscriber_count: 1, audience_continents: ["africa"], geo_authoritative_region: "asia", geo_confidence: "high", geo_conflict_detected: 0, geo_status: "current" }), "asia");
  assert.equal(analytics.effectiveChannelAudience({ id: 2, subscriber_count: 1, audience_continents: null }), "unclassified");
  assert.equal(analytics.effectiveChannelAudience({ id: 3, subscriber_count: 1, audience_continents: ["africa"], geo_authoritative_region: "asia", geo_confidence: "high", geo_conflict_detected: 1, geo_status: "review_required" }), "africa");
});

test("Audience Analytics cache is retained but invalidated by live inventory signature", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/admin/audience-analytics/route.ts"), "utf8");
  assert.match(route, /inventorySignature === inventory\.signature/);
  assert.match(route, /active_checksum/);
  assert.match(route, /MAX\(updated_at\)/);
  assert.match(route, /status='active' AND c\.is_deleted=FALSE/);
});
