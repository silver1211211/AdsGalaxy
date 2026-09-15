import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("Teza summary is scoped to active channels and omits campaign and financial cards", async () => {
  const [page, route] = await Promise.all([
    read("admin-teaser-analytics-page.tsx"),
    read("admin-teaser-analytics-route.ts"),
  ]);

  assert.doesNotMatch(page, /Active Teaser Campaigns|Active Teza Campaigns/);
  assert.match(page, /Active Placements/);
  assert.match(page, /Needs Permission — Active Channels/);
  assert.doesNotMatch(page, /Advertiser Spend|Publisher Earnings|Platform Revenue|Top Channels|Top Campaigns|Creative Performance/);
  assert.match(route, /status='active' AND teaser_enabled=1 AND teaser_status='needs_permission'/);
  assert.match(route, /status='active' AND teaser_enabled=1 AND teaser_status='active'/);
});

test("Teza analytics exposes audience delivery with correctly dated click metrics", async () => {
  const [page, route] = await Promise.all([
    read("admin-teaser-analytics-page.tsx"),
    read("admin-teaser-analytics-route.ts"),
  ]);

  assert.match(page, /Teza Audience Delivery/);
  assert.match(page, /Teza Category Delivery/);
  assert.match(page, /divided proportionally/);
  assert.match(page, /All eligible Teza channels/);
  assert.match(page, /Estimated Subscribers/);
  assert.match(page, /Last 7 Days — Totals/);
  assert.match(page, /Last 30 Days — Totals/);
  assert.match(route, /buildAudienceAnalytics/);
  assert.match(route, /buildCategoryAnalytics/);
  assert.match(route, /normalizeCampaignCategoryList/);
  assert.match(route, /weight: 1 \/ assignedCategories\.length/);
  assert.match(route, /JOIN teaser_clicks tc/);
  assert.match(route, /tc\.created_at >= UTC_DATE\(\)/);
  assert.doesNotMatch(route, /SUM\(tp\.clicks\)/);
});
