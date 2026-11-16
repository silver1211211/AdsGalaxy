import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const file = "src/lib/teaserDeliveryEligibility.ts";
const source = fs.readFileSync(file, "utf8");
const compiled = ts.transpileModule(source, {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => ({}) });
const check = exports.teaserPlacementStillEligible;
function fixture(change = {}) {
  const state = {
    placementStatus: "inserting", channelStatus: "active", deleted: false,
    approval: "approved", channelType: "public", tracking: "not_required",
    membership: null, teaserEnabled: true, teaserStatus: "active",
    publisherStatus: "active", banned: false, campaignStatus: "active",
    campaignTeaserEnabled: true, ...change,
  };
  const db = { query: async (sql, params) => {
    assert.deepEqual(Array.from(params), [4, 7, 11]);
    for (const required of [
      "tp.status IN ('inserting','active','awaiting_baseline')",
      "ch.is_deleted=0", "ch.status IN ('active','approved')",
      "COALESCE(ch.marketplace_admin_status,'approved')='approved'",
      "ch.tracking_account_status='active'",
      "ch.tracking_account_member_status IN ('member','already_member')",
      "p.status='active'", "c.status='active'",
    ]) assert.ok(sql.includes(required), required);
    const eligible =
      ["inserting", "active", "awaiting_baseline"].includes(state.placementStatus) &&
      ["active", "approved"].includes(state.channelStatus) && !state.deleted &&
      state.approval === "approved" &&
      (state.channelType !== "private" || (state.tracking === "active" && ["member", "already_member"].includes(state.membership))) &&
      state.teaserEnabled && state.teaserStatus === "active" &&
      state.publisherStatus === "active" && !state.banned &&
      state.campaignStatus === "active" && state.campaignTeaserEnabled;
    return [eligible ? [{ id: 4 }] : []];
  } };
  return () => check(db, { placementId: 4, channelId: 7, campaignId: 11 });
}
test("approved public teaser placement may be inserted", async () => assert.equal(await fixture()(), true));
test("confirmed private teaser membership may be inserted", async () =>
  assert.equal(await fixture({ channelType: "private", tracking: "active", membership: "member" })(), true));
for (const [name, change] of [
  ["pending channel", { channelStatus: "pending" }],
  ["rejected channel", { channelStatus: "rejected" }],
  ["deleted channel", { deleted: true }],
  ["disabled channel", { channelStatus: "disabled" }],
  ["marketplace rejection", { approval: "rejected" }],
  ["publisher ban", { banned: true }],
  ["failed private membership", { channelType: "private", tracking: "pending_manual" }],
  ["stale private membership", { channelType: "private", tracking: "active", membership: "left" }],
  ["removed teaser permission", { teaserStatus: "needs_permission" }],
  ["inactive campaign", { campaignStatus: "paused" }],
  ["cancelled insertion claim", { placementStatus: "removal_pending" }],
]) test(`queued teaser blocks ${name} at edit time`, async () =>
  assert.equal(await fixture(change)(), false));

function extract(path, start, end) {
  const text = fs.readFileSync(path, "utf8");
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, path);
  return text.slice(a, b);
}
test("initial insertion blocks a status change after database commit", async () => {
  const block = extract("src/lib/teaserPlacement.ts",
    "  if (!(await teaserPlacementStillEligible(pool, {",
    "  const edit=await editTelegramTeaser");
  const js = ts.transpileModule("exports.probe=async function(){" + block + "return {ok:true};}", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out = {}, updates = [];
  vm.runInNewContext(js, {
    exports: out, pool: { query: async (sql, params) => { updates.push({ sql, params }); return [{ affectedRows: 1 }]; } },
    teaserPlacementStillEligible: async () => false,
    placementId: 4, ch: { id: 7 }, campaign: { id: 11 }, Number,
  });
  const result = await out.probe();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "CHANNEL_INACTIVE");
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /status='failed'/);
});
test("queued worker blocks a channel changed after row selection and claim", async () => {
  const block = extract("src/app/api/cron/teaser/route.ts",
    " if (!(await teaserPlacementStillEligible(pool, {",
    " const edit=await editTelegramTeaser");
  const js = ts.transpileModule("exports.probe=async function(){" + block + "return 'allowed';}", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out = {}, updates = [];
  vm.runInNewContext(js, {
    exports: out, pool: { query: async (sql, params) => { updates.push({ sql, params }); return [{ affectedRows: 1 }]; } },
    teaserPlacementStillEligible: async () => false,
    row: { id: 4, channel_id: 7, campaign_id: 11 }, Number,
  });
  assert.equal(await out.probe(), "insert_cleanup");
  assert.match(updates[0].sql, /status='removal_pending'/);
});
test("publisher edit cannot reapply an ineligible teaser", async () => {
  const block = extract("src/app/api/internal/bot/teaser/route.ts",
    "  if (!(await teaserPlacementStillEligible(pool, {",
    "  const edit=await editTelegramTeaser");
  const js = ts.transpileModule("exports.probe=async function(){" + block + "return {ok:true};}", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out = {}, updates = [];
  vm.runInNewContext(js, {
    exports: out, pool: { query: async (sql, params) => { updates.push({ sql, params }); return [{ affectedRows: 1 }]; } },
    teaserPlacementStillEligible: async () => false,
    p: { id: 4, channel_id: 7, campaign_id: 11 }, Number,
  });
  const result = await out.probe();
  assert.equal(result.queued_removal, "CHANNEL_INACTIVE");
  assert.match(updates[0].sql, /status='removal_pending'/);
});
test("emergency teaser queue uses the same current-status insertion service", () => {
  const emergency = fs.readFileSync("src/lib/teaserEmergency.ts", "utf8");
  assert.match(emergency, /out=await insertTeaserPlacement\(/);
  const initial = fs.readFileSync("src/lib/teaserPlacement.ts", "utf8");
  const worker = fs.readFileSync("src/app/api/cron/teaser/route.ts", "utf8");
  const publisher = fs.readFileSync("src/app/api/internal/bot/teaser/route.ts", "utf8");
  for (const source of [initial, worker, publisher]) assert.match(source, /teaserPlacementStillEligible\(pool/);
});
