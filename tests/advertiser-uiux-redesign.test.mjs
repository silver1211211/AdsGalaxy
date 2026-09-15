import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard is wallet-first, compact, and has a dismissible low-balance notice", () => {
  const source = read("src/app/advertiser/page.tsx");
  assert.match(source, /adBalance/);
  assert.match(source, /balance\.available < 2/);
  assert.match(source, /lowBalanceDismissed/);
  assert.match(source, /href="\/advertiser\/deposit"/);
  assert.doesNotMatch(source, /Locked Balance|balance\.locked/);
  assert.doesNotMatch(source, /Large Deposit|Deposit Funds card/);
  assert.match(source, /lg:grid-cols-3/);
});

test("chooser order is Channel, Growth, Mini App, Bot", () => {
  const source = read("src/app/advertiser/campaigns/new/page.tsx");
  const order = ["channel", "growth", "miniapp", "bot"].map((key) => source.indexOf(`key: "${key}"`));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("classic builders use the shared three-step shell and reusable preview", () => {
  const source = read("src/app/advertiser/campaigns/new/[kind]/page.tsx");
  assert.match(source, /CampaignWizardShell/);
  assert.match(source, /TelegramCampaignPreview/);
  assert.match(read("src/components/advertiser/CampaignWizardShell.tsx"), /Campaign creation progress/);
  assert.match(read("src/components/advertiser/TelegramCampaignPreview.tsx"), /break-words/);
});

test("Growth uses CPS settings, floor estimate, and server verification authority", () => {
  const source = read("src/app/advertiser/campaigns/new/[kind]/page.tsx");
  assert.match(source, /cost_per_subscriber: "0\.56"/);
  assert.match(source, /Math\.floor/);
  assert.match(source, /Verify Channel/);
  assert.match(source, /Bot admin ✓/);
  assert.match(source, /Invite permission ✓/);
  assert.match(source, /growthVerification\?\.channel !== formData\.destination_channel/);
  const route = read("src/app/api/advertiser/channel-growth/verify/route.ts");
  assert.match(route, /getAuthenticatedUser/);
  assert.match(route, /verifyGrowthDestination/);
});

test("budget copy describes a spending cap without reservation language", () => {
  for (const path of ["src/app/advertiser/campaigns/new/[kind]/page.tsx", "src/app/advertiser/miniapp-rewarded/page.tsx"] ) {
    const source = read(path);
    assert.match(source, /charged only/);
    assert.doesNotMatch(source, /Locked Budget|funds will be locked|will be reserved|locked funds.*refund/i);
  }
});

test("campaign cards support search, filters, compact grid, and filtered empty state", () => {
  const source = read("src/app/advertiser/campaigns/page.tsx");
  assert.match(source, /Search campaigns/);
  assert.match(source, /Filter by status/);
  assert.match(source, /Filter by type/);
  assert.match(source, /xl:grid-cols-3/);
  assert.match(source, /No campaigns match these filters/);
});

test("lifecycle statuses distinguish insufficient balance and exhausted budget", () => {
  const source = read("src/components/advertiser/CampaignStatusBadge.tsx");
  for (const label of ["Active", "Paused", "Insufficient Balance", "Budget Exhausted", "Completed", "Pending Review", "Rejected"]) assert.match(source, new RegExp(label));
  assert.match(source, /Add funds to your Ad Balance/);
  assert.match(source, /reached its spending limit/);
});

test("details separate campaign budget, actual spend, and remaining allowance", () => {
  const source = read("src/components/advertiser/CampaignDetailsScreen.tsx");
  assert.match(source, /budget_cap/);
  assert.match(source, /actual_spend/);
  assert.match(source, /remaining_allowance/);
  assert.match(source, /Subscribers Acquired/);
  assert.match(source, /Pending Verifications/);
});

test("campaign-level postback stays absent while developer API remains", () => {
  for (const path of ["src/app/advertiser/campaigns/new/[kind]/page.tsx", "src/app/advertiser/miniapp-rewarded/page.tsx", "src/components/advertiser/CampaignDetailsScreen.tsx"]) assert.doesNotMatch(read(path), /postback_url|Postback URL/);
  assert.equal(fs.existsSync(new URL("../src/app/api/postback", import.meta.url)) || fs.existsSync(new URL("../src/app/api/v1/postbacks", import.meta.url)), true);
});

test("crop remains square-first, pointer-safe, continuously zoomable and 1MB-bound", () => {
  const source = read("src/components/advertiser/ImageCropDialog.tsx");
  assert.match(source, /Square/); assert.match(source, /Portrait/); assert.match(source, /Landscape/);
  assert.match(source, /onPointerMove/); assert.match(source, /onPointerCancel/); assert.match(source, /setPointerCapture/);
  assert.match(source, /type="range"/); assert.match(source, /1024 \* 1024/);
});

test("new EN and RU chooser strings have parity and real translations", () => {
  const en = read("src/i18n/en.ts"), ru = read("src/i18n/ru.ts");
  for (const key of ["advertiser.chooser.title", "advertiser.chooser.growth.description", "advertiser.dashboard.lowBalanceTitle", "advertiser.dashboard.availableForSpend"]) {
    assert.match(en, new RegExp(key.replaceAll(".", "\\.")));
    assert.match(ru, new RegExp(key.replaceAll(".", "\\.")));
  }
  assert.match(ru, /проверенных подписчиков/);
});

test("changed advertiser surfaces include mobile overflow and safe-area constraints", () => {
  for (const path of ["src/app/advertiser/page.tsx", "src/app/advertiser/campaigns/page.tsx", "src/components/advertiser/CampaignWizardShell.tsx"]) {
    const source = read(path); assert.match(source, /min-w-0/); assert.match(source, /overflow-hidden/);
  }
  assert.match(read("src/components/advertiser/CampaignWizardShell.tsx"), /safe-area-inset-bottom/);
});

test("API error mapping suppresses database and secret-bearing raw errors", () => {
  const source = read("src/lib/apiErrorMessage.ts");
  assert.match(source, /INSUFFICIENT_AD_BALANCE/);
  assert.match(source, /BUDGET_BELOW_ALREADY_SPENT/);
  assert.match(source, /SQLSTATE\|ER_/);
});
