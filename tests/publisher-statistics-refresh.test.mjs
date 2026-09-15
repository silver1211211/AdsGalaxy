import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("publisher statistics combines channel, growth, and teaser sources with filtering", async () => {
  const [dashboard, route] = await Promise.all([
    read("ChannelAnalyticsDashboard.tsx"),
    read("channel-analytics-route.ts"),
  ]);

  assert.match(dashboard, /from=\$\{range\.start\}&to=\$\{range\.end\}&source=\$\{source\}/);
  assert.match(dashboard, /DateRangeCalendarPopup/);
  assert.match(dashboard, /return "Last 7 Days"/);
  assert.match(dashboard, /<option value="all">All<\/option>/);
  assert.match(dashboard, /<option value="channel">Channel<\/option>/);
  assert.match(dashboard, /<option value="teaser">Teza<\/option>/);
  assert.doesNotMatch(dashboard, />\s*Clear\s*</);

  assert.match(route, /FROM teaser_settlements/);
  assert.match(route, /FROM teaser_clicks/);
  assert.match(route, /FROM channel_growth_conversions/);
  assert.match(route, /FROM channel_growth_seed_ledger/);
  assert.match(route, /channelEarnings \+ teaserEarnings/);
});

test("channel statistics detail is simplified and edit keeps teaser configuration", async () => {
  const [details, editor, route] = await Promise.all([
    read("ChannelDetailsScreen.tsx"),
    read("AddChannelScreen.tsx"),
    read("channel-id-route.ts"),
  ]);

  assert.doesNotMatch(details, /General Information/);
  assert.doesNotMatch(details, /Resume Channel/);
  assert.doesNotMatch(details, /Low Trust Score/);
  assert.match(details, /ChannelAnalyticsDashboard/);
  assert.match(details, />\s*Close\s*</);

  assert.match(editor, /teaser_enabled: teaserEnabled/);
  assert.match(editor, /teaser_daily_limit: teaserDailyLimit/);
  assert.match(editor, /\[2, 3, 4, 5\]/);
  assert.match(route, /teaser_enabled = \?/);
  assert.match(route, /teaser_daily_limit = \?/);
});

test("monetize inventory and admin settings use the refreshed compact controls", async () => {
  const [monetize, admin] = await Promise.all([
    read("monetize-page.tsx"),
    read("admin-settings-page.tsx"),
  ]);

  assert.match(monetize, /placeholder="Search assets"/);
  assert.match(monetize, /value="all">All<\/option>/);
  assert.match(monetize, /value="channel">Channels<\/option>/);
  assert.match(monetize, /value="bot">Bots<\/option>/);
  assert.match(monetize, /value="miniapp">Mini Apps<\/option>/);
  assert.match(monetize, />\s*Statistics\s*</);
  assert.doesNotMatch(monetize, /PUBLISHER STUDIO/);

  assert.match(admin, /title: "Teaser CPM"/);
  assert.match(admin, /Teaser Revenue Split/);
  assert.doesNotMatch(admin, /Pricing & Revenue Split/);
});

test("green channel configuration uses a green or dark Teza switch", async () => {
  const monetize = await read("monetize-page.tsx");
  assert.match(monetize, /chTeaserEnabled \? "bg-emerald-500" : "bg-slate-700"/);
  assert.match(monetize, /absolute left-0 top-1 h-5 w-5/);
});
