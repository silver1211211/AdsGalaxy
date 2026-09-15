import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "./reward-callback-production-loader.mjs";

const validation = await import("../src/lib/campaignCreationValidation.ts");
const schema = await import("../src/lib/campaignCreationReadiness.ts");
const route = readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
const transaction = readFileSync("src/lib/campaignCreationTransaction.ts", "utf8");
const validationSource = readFileSync("src/lib/campaignCreationValidation.ts", "utf8");
const postRoute = route.slice(route.indexOf("export async function POST"));

test("production objective validation accepts only persisted objectives", () => {
  for (const objective of ["views", "clicks", "broadcast"]) {
    assert.equal(validation.validateCampaignObjective(objective), objective);
  }
  for (const objective of ["CHANNEL", "BOT", "BOTH", "unknown", "Views", "", null]) {
    assert.throws(
      () => validation.validateCampaignObjective(objective),
      (error) => error.code === "INVALID_CAMPAIGN_TYPE" && error.status === 400,
    );
  }
});

test("objective rejection happens before upload, connection, debit, campaign, and ledger mutation", () => {
  const objective = postRoute.indexOf("validateCampaignObjective(formData.get");
  for (const later of [
    "Campaign image upload",
    "pool.getConnection()",
    "executeCampaignCreationTransaction",
    "INSERT INTO campaigns",
  ]) {
    assert.ok(objective >= 0 && objective < postRoute.indexOf(later), `${later} must follow objective validation`);
  }
});

test("readiness check is read-only and missing schema is classified safely", async () => {
  const attempted = [];
  const db = {
    async query(sql) {
      attempted.push(sql);
      return [[]];
    },
  };
  await assert.rejects(
    schema.assertCampaignCreationSchemaReady(db),
    (error) => error.code === "CAMPAIGN_SCHEMA_NOT_READY" && error.missing.length > 0,
  );
  assert.equal(attempted.length, 1);
  assert.match(attempted[0], /INFORMATION_SCHEMA\.COLUMNS/);
  assert.doesNotMatch(attempted[0], /\b(?:CREATE|ALTER|DROP)\b/i);
  assert.match(validationSource, /CAMPAIGN_SCHEMA_NOT_READY/);
  assert.match(validationSource, /status: 503/);
  assert.ok(postRoute.indexOf("assertCampaignCreationSchemaReady") < postRoute.indexOf("executeCampaignCreationTransaction"));
  assert.doesNotMatch(route.slice(0, route.indexOf("export async function GET")), /ensureClassicSettlementColumns|ALTER TABLE/);
});

test("production text and destination validation is safe and actionable", () => {
  const valid = {
    name: "Launch",
    campaignTitle: "A valid campaign",
    messageText: "A useful message",
    link: "https://example.com/landing",
    buttonText: "Learn More",
  };
  assert.doesNotThrow(() => validation.validateCampaignText(valid));
  for (const [patch, code] of [
    [{ name: "x" }, "INVALID_CAMPAIGN_NAME"],
    [{ campaignTitle: "" }, "INVALID_CAMPAIGN_TITLE"],
    [{ messageText: "" }, "INVALID_AD_TEXT"],
    [{ link: "javascript:alert(1)" }, "INVALID_DESTINATION_URL"],
    [{ buttonText: "" }, "MISSING_CTA"],
  ]) {
    assert.throws(
      () => validation.validateCampaignText({ ...valid, ...patch }),
      (error) => error.code === code && error.status === 400,
    );
  }
});

test("views, clicks, and broadcast use one atomic creation pipeline without a historical pre-debit", () => {
  assert.match(route, /type === "clicks" \? submittedCpc/);
  assert.match(route, /inventoryType: type === "broadcast" \? "bot" : "channel"/);
  const begin = transaction.indexOf("beginTransaction()");
  const campaign = route.indexOf("INSERT INTO campaigns");
  const targeting = route.indexOf("campaign_direct_inventory_targets");
  const commit = transaction.indexOf("commit()");
  assert.ok(begin >= 0 && begin < commit);
  assert.ok(campaign < targeting);
  assert.doesNotMatch(transaction, /(?:ad_balance|advertiser_transactions|locked_balance)/);
  assert.match(transaction, /catch \(error\)[\s\S]*rollback\(\)[\s\S]*throw error/);
  assert.match(transaction, /success: true as const, id: campaignId/);
});

test("unexpected failures are sanitized and optional media preserves text-only behavior", () => {
  assert.match(validationSource, /CAMPAIGN_CREATE_FAILED/);
  assert.doesNotMatch(route, /NextResponse\.json\(\{ error: error\?\.message/);
  assert.match(route, /let imageUrl = null/);
  assert.match(route, /Campaign image upload provider was unavailable/);
  assert.ok(postRoute.indexOf("Campaign image upload provider was unavailable") < postRoute.indexOf("executeCampaignCreationTransaction"));
});
