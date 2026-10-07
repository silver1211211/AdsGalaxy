import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Silver details reuse the complete Main campaign details client with Silver API scope", () => {
  const main = read("src/app/admin/campaigns/[id]/page.tsx");
  const silver = read("src/app/check/silver/campaigns/[id]/page.tsx");
  assert.match(main, /silverMode/);
  assert.match(main, /apiBase/);
  assert.match(main, /Placement Statistics/);
  assert.match(main, /Settlement Summary/);
  assert.match(main, /Delivery Status/);
  assert.match(silver, /AdminCampaignDetailsPage silverMode/);
});

test("Silver list uses the shared Admin list, quick view, details, and emergency UX", () => {
  const silver = read("src/components/silver/SilverControlClient.tsx");
  const shared = read("src/app/admin/campaigns/page.tsx");
  assert.match(silver, /AdminCampaignsView silverMode/);
  assert.match(shared, /silverMode/);
  assert.match(shared, /check\/silver\/campaigns/);
  assert.match(shared, /title="Release"/);
  assert.match(shared, /title="Quick View"/);
  assert.match(shared, /title="View Details"/);
  assert.match(shared, /Emergency Push/);
  assert.match(shared, /Release this campaign back to Main Admin/);
});

test("Silver password is verified as a bcrypt hash and never stored in source", () => {
  const login = read("src/app/api/check/silver/auth/login/route.ts");
  const control = read("src/lib/silverCampaignControl.ts");
  assert.match(login, /bcrypt\.compare/);
  assert.match(login, /silver_admin_password_hash/);
  assert.match(control, /timingSafeEqual/);
  assert.match(control, /httpOnly|silver_auth/);
  assert.doesNotMatch(login, /Silver1211/);
  assert.doesNotMatch(control, /Silver1211/);
});

test("Silver statistics support endpoints enforce Silver scope", () => {
  for (const name of [
    "settlement-summary",
    "delivery-status",
    "cleanup-errors",
  ]) {
    const source = read(
      `src/app/api/check/silver/campaigns/[id]/${name}/route.ts`,
    );
    assert.match(source, /requireSilverAdmin/);
    assert.match(source, /campaignBelongsToScope\(Number\(id\), "silver"\)/);
  }
});

test("Silver budget controls preserve direct-debit settlement semantics", () => {
  const route = read("src/app/api/check/silver/campaigns/[id]/budget/route.ts");
  const ui = read("src/app/admin/campaigns/[id]/page.tsx");
  assert.match(route, /funding_model\s*!==\s*"direct_debit"/);
  assert.match(route, /budget=budget\+CAST/);
  assert.match(route, /total_budget=CAST/);
  assert.match(route, /no_immediate_wallet_debit\s*:\s*true/);
  assert.doesNotMatch(route, /UPDATE users SET ad_balance/);
  assert.match(ui, /Add Balance/);
  assert.match(ui, /Edit Budget/);
});

test("Silver APIs never return raw database or internal exception messages", () => {
  const exempt = read("src/app/api/check/silver/exempt-users/route.ts");
  const release = read(
    "src/app/api/check/silver/campaigns/[id]/release/route.ts",
  );
  const budget = read(
    "src/app/api/check/silver/campaigns/[id]/budget/route.ts",
  );
  for (const source of [exempt, release, budget]) {
    assert.doesNotMatch(
      source,
      /NextResponse\.json\(\{\s*error:\s*(?:code|error\.message)/,
    );
    assert.match(source, /Please try again|Refresh and try again/);
  }
  for (const name of [
    "settlement-summary",
    "delivery-status",
    "cleanup-errors",
  ]) {
    const source = read(
      `src/app/api/check/silver/campaigns/[id]/${name}/route.ts`,
    );
    assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
    assert.match(source, /reportSilverApiError/);
  }
});

test("Silver wrappers sanitize thrown errors and every 5xx returned by shared Main campaign handlers", () => {
  const control = read("src/lib/silverCampaignControl.ts");
  assert.match(control, /response\.status < 500/);
  assert.match(control, /Response\.json\(\{ error: fallbackMessage \}/);
  assert.match(control, /handleSilverApiRequest/);
  for (const route of [
    "route.ts",
    "actions/route.ts",
    "emergency-push/route.ts",
  ]) {
    assert.match(
      read(`src/app/api/check/silver/campaigns/[id]/${route}`),
      /handleSilverApiRequest/,
    );
  }
});
