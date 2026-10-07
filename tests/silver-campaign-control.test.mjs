import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) =>
  fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Silver isolation is additive and preserves permanent campaign IDs", () => {
  const migration = read(
    "db/migrations/20260919_0143_silver_campaign_control.sql",
  );
  assert.match(migration, /campaign_id INT NOT NULL/);
  assert.match(migration, /UNIQUE KEY uq_campaign_admin_isolation_campaign/);
  assert.doesNotMatch(
    migration,
    /UPDATE campaigns|DELETE FROM campaigns|ALTER TABLE campaigns/,
  );
});
test("existing campaigns default to Main and Main APIs exclude Silver server-side", () => {
  const control = read("src/lib/silverCampaignControl.ts"),
    list = read("src/app/api/admin/campaigns/route.ts"),
    detail = read("src/app/api/admin/campaigns\/[id]\/route.ts");
  assert.match(control, /NOT EXISTS.*campaign_admin_isolation/s);
  assert.match(list, /mainCampaignScopeSql/);
  assert.match(detail, /mainCampaignScopeSql/);
});
test("pull and release are transactional, locked, audited, and preserve IDs", () => {
  const s = read("src/lib/silverCampaignControl.ts");
  assert.match(s, /beginTransaction/);
  assert.match(s, /FOR UPDATE/);
  assert.match(s, /campaign_pull/);
  assert.match(s, /campaign_release/);
  assert.match(s, /DELETE FROM campaign_admin_isolation/);
  assert.match(s, /preserved_real_campaign_id/);
});
test("virtual Main and Silver numbering never mutate IDs", () => {
  const main = read("src/app/api/admin/campaigns/route.ts"),
    silver = read("src/app/api/check/silver/campaigns/route.ts");
  assert.match(main, /main_display_number/);
  assert.match(silver, /ROW_NUMBER\(\) OVER/);
  assert.match(silver, /original_campaign_id/);
});
test("exempt users bind to current publisher ownership and future channels automatically", () => {
  const migration = read(
      "db/migrations/20260919_0143_silver_campaign_control.sql",
    ),
    control = read("src/lib/silverCampaignControl.ts");
  assert.match(migration, /user_id INT NOT NULL/);
  assert.match(control, /seu\.user_id=ch\.user_id/);
  assert.doesNotMatch(migration, /channel_id/);
});
test("scheduled, emergency and Teaser delivery use Silver eligibility plus final pre-post guards", () => {
  const scheduled = read("src/app/api/cron/process-ads/route.ts"),
    emergency = read(
      "src/app/api/admin/campaigns\/[id]\/emergency-push/route.ts",
    ),
    teaser = read("src/lib/teaserPlacement.ts");
  for (const source of [scheduled, emergency, teaser])
    assert.match(source, /isChannelAllowedForCampaign/);
  assert.match(scheduled, /silverExemptPairs/);
  assert.match(emergency, /silver_ad_exempt_users/);
  assert.match(teaser, /silverCampaignDeliverySql/);
});
test("Silver master pause and isolated authorization are explicit", () => {
  const delivery = read("src/app/api/check/silver/delivery/route.ts"),
    auth = read("src/lib/silverCampaignControl.ts"),
    migration = read("db/migrations/20260919_0143_silver_campaign_control.sql");
  assert.match(delivery, /silver_delivery_enabled/);
  assert.match(auth, /silver_admin_access/);
  assert.match(migration, /silver_admin_access/);
});
test("advertiser identity, billing and settlement tables are untouched", () => {
  const migration = read(
    "db/migrations/20260919_0143_silver_campaign_control.sql",
  );
  for (const table of [
    "advertiser_transactions",
    "advertiser_direct_debits",
    "channel_settlement_ledger",
    "ad_settlements",
  ])
    assert.doesNotMatch(
      migration,
      new RegExp(`(?:UPDATE|DELETE FROM|ALTER TABLE) ${table}`),
    );
});
test("pull blocks future allocations and cleans active exempt posts without deleting history", () => {
  const s = read("src/lib/silverCampaignControl.ts"),
    cleanup = read("src/lib/campaignPostDeletion.ts");
  assert.match(s, /message_id IS NULL/);
  assert.match(
    s,
    /status IN \('pending','pending_delivery','queued','scheduled'\)/,
  );
  assert.match(s, /message_id IS NOT NULL/);
  assert.match(s, /deleteCampaignPostsByIds/);
  assert.match(s, /campaign_pull_exempt_cleanup/);
  assert.match(cleanup, /cleanup_status/);
  assert.doesNotMatch(`${s}\n${cleanup}`, /DELETE FROM campaign_posts/);
});
test("adding an exemption activates the owner block before cleaning every Silver post", () => {
  const source = read("src/lib/silverCampaignControl.ts");
  const start = source.indexOf("addSilverExemptUser");
  const activate = source.indexOf("silver_ad_exempt_users", start);
  const select = source.indexOf("cp.message_id IS NOT NULL", activate);
  const commit = source.indexOf("await conn.commit()", select);
  const cleanup = source.indexOf("deleteCampaignPostsByIds", commit);
  assert.ok(start >= 0 && activate > start && select > activate && commit > select && cleanup > commit);
  assert.match(source.slice(start), /JOIN channels ch ON ch\.id=cp\.channel_id/);
  assert.match(source.slice(start), /ch\.user_id=\?/);
});
test("Main and Silver mutations serialize with pull and release", () => {
  const s = read("src/lib/silverCampaignControl.ts"),
    a = read("src/app/api/admin/campaigns\/[id]\/actions/route.ts"),
    e = read("src/app/api/admin/campaigns\/[id]\/emergency-push/route.ts");
  for (const source of [s, a, e]) assert.match(source, /campaign-management-/);
});
test("Silver campaign edits recheck scope while holding the campaign row lock", () => {
  const s = read("src/app/api/admin/campaigns\/[id]\/route.ts");
  assert.match(s, /FOR UPDATE/);
  assert.match(s, /Campaign management scope changed/);
});
test("Silver action audits remain private", () => {
  const a = read("src/app/api/admin/campaigns\/[id]\/actions/route.ts"),
    e = read("src/app/api/admin/campaigns\/[id]\/emergency-push/route.ts"),
    d = read("src/app/api/admin/campaigns\/[id]\/route.ts");
  for (const source of [a, e, d]) assert.match(source, /recordSilverAudit/);
});
test("broadcast delivery honors Silver master pause before Telegram send", () => {
  const b = read("src/app/api/cron/process-broadcast/route.ts");
  assert.match(b, /silverCampaignDeliverySql/);
  assert.match(b, /isCampaignDeliveryAllowed/);
  assert.ok(
    b.indexOf("isCampaignDeliveryAllowed") <
      b.lastIndexOf("sendTelegramMessage"),
  );
});
test("Silver list reuses the normal Admin campaign UI and keeps compact Release", () => {
  const ui = read("src/components/silver/SilverControlClient.tsx"),
    adminUi = read("src/app/admin/campaigns/page.tsx"),
    list = read("src/app/api/check/silver/campaigns/route.ts");
  assert.match(list, /type_label/);
  assert.match(ui, /AdminCampaignsView silverMode/);
  assert.match(adminUi, /export function AdminCampaignsView/);
  assert.match(adminUi, /silverMode \? "\/api\/check\/silver\/campaigns"/);
  assert.match(adminUi, /title="Quick View"/);
  assert.match(adminUi, /title="View Details"/);
  assert.match(adminUi, /title="Release"/);
  assert.match(adminUi, /Emergency Push/);
});
test("normal Admin lookup refuses Silver campaigns before list mutation", () => {
  const s = read("src/app/api/admin/campaigns/route.ts");
  assert.match(s, /if \(!campaign\)[\s\S]*Campaign not found/);
});

const mainRows = (realIds, silverIds) =>
  realIds
    .filter((id) => !silverIds.includes(id))
    .map((id, index) => ({ main: index + 1, real: id }));
const silverRows = (silverIds) =>
  silverIds.map((real, index) => ({ silver: index + 1, original: real }));

test("pull 1: Main #60 resolves to permanent real 60", () => {
  const real = Array.from({ length: 62 }, (_, index) => index + 1),
    silver = [];
  const target = mainRows(real, silver).find((row) => row.main === 60);
  assert.equal(target.real, 60);
  silver.push(target.real);
  assert.deepEqual(silverRows(silver), [{ silver: 1, original: 60 }]);
  assert.deepEqual(mainRows(real, silver).slice(59), [
    { main: 60, real: 61 },
    { main: 61, real: 62 },
  ]);
});
test("pull 2: shifted Main #60 resolves to real 61 and keeps Original Campaign #61", () => {
  const real = Array.from({ length: 62 }, (_, index) => index + 1),
    silver = [60];
  const target = mainRows(real, silver).find((row) => row.main === 60);
  assert.equal(target.real, 61);
  silver.push(target.real);
  assert.deepEqual(silverRows(silver), [
    { silver: 1, original: 60 },
    { silver: 2, original: 61 },
  ]);
  assert.deepEqual(mainRows(real, silver).slice(59), [{ main: 60, real: 62 }]);
});
test("release 3: releasing Original 60 restores it at Main #60 and compacts Silver", () => {
  const real = Array.from({ length: 62 }, (_, index) => index + 1),
    silver = [60, 61];
  silver.splice(silver.indexOf(60), 1);
  assert.deepEqual(mainRows(real, silver).slice(59), [
    { main: 60, real: 60 },
    { main: 61, real: 62 },
  ]);
  assert.deepEqual(silverRows(silver), [{ silver: 1, original: 61 }]);
});
test("release 4: releasing Original 61 restores original Main numbering", () => {
  const real = Array.from({ length: 62 }, (_, index) => index + 1),
    silver = [61];
  silver.splice(silver.indexOf(61), 1);
  assert.deepEqual(mainRows(real, silver).slice(59), [
    { main: 60, real: 60 },
    { main: 61, real: 61 },
    { main: 62, real: 62 },
  ]);
  assert.deepEqual(silverRows(silver), []);
});
test("real IDs and campaign economics are never rewritten by virtual-number pull/release", () => {
  const source = read("src/lib/silverCampaignControl.ts");
  assert.match(source, /permanent_real_campaign_id/);
  assert.doesNotMatch(
    source,
    /UPDATE campaigns SET (?:id|budget|total_budget|channel_spend)/,
  );
  assert.doesNotMatch(source, /DELETE FROM campaigns/);
});
test("Pull resolves the Main number and writes isolation inside one transaction", () => {
  const source = read("src/lib/silverCampaignControl.ts");
  const begin = source.indexOf(
      "await conn.beginTransaction()",
      source.indexOf("pullMainCampaignNumberToSilver"),
    ),
    resolve = source.indexOf("main_display_number=?", begin),
    insert = source.indexOf("INSERT INTO campaign_admin_isolation", resolve),
    commit = source.indexOf("await conn.commit()", insert);
  assert.ok(
    begin >= 0 && resolve > begin && insert > resolve && commit > insert,
  );
  assert.match(source, /campaign-main-numbering/);
  assert.match(source, /FOR UPDATE/);
});
test("invalid Main display numbers return the required friendly error", () => {
  const route = read("src/app/api/check/silver/campaigns/route.ts");
  assert.match(
    route,
    /Main campaign #\$\{mainDisplayNumber\} is not currently available\./,
  );
});
test("a changed list is rechecked and never silently selects another campaign", () => {
  const source = read("src/lib/silverCampaignControl.ts"),
    route = read("src/app/api/check/silver/campaigns/route.ts");
  assert.match(source, /recheck/);
  assert.match(source, /CAMPAIGN_LIST_CHANGED/);
  assert.match(route, /Campaign list changed\. Refresh and try again\./);
});
test("Silver direct actions and release continue to use permanent real IDs", () => {
  const ui = read("src/app/admin/campaigns/page.tsx"),
    release = read("src/app/api/check/silver/campaigns/[id]/release/route.ts");
  assert.match(ui, /\$\{apiBase\}\/\$\{id\}\/release/);
  assert.match(release, /releaseCampaignToMain\(Number\(id\)/);
});
test("Main and Silver emergency pushes use only per-campaign locks", () => {
  const route = read("src/app/api/admin/campaigns/[id]/emergency-push/route.ts");
  assert.match(route, /campaign-management-\$\{id\}/);
  assert.doesNotMatch(route, /emergency-push-global|global-emergency|campaign-emergency-global/);
});
