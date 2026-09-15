import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const channelRoute = readFileSync("src/app/api/advertiser/campaigns/route.ts", "utf8");
const miniAppRoute = readFileSync("src/app/api/advertiser/miniapp-rewarded-campaigns/route.ts", "utf8");
const readiness = readFileSync("src/lib/campaignCreationReadiness.ts", "utf8");

function insertShape(source, table) {
  const expression = new RegExp(`INSERT INTO ${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES\\s*\\(([\\s\\S]*?)\\)`);
  const match = source.match(expression);
  assert.ok(match, `${table} INSERT must be present`);
  const columns = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  const values = match[2].split(",").map((value) => value.trim()).filter(Boolean);
  return { columns, values, placeholders: (match[2].match(/\?/g) || []).length };
}

test("channel campaign INSERT preserves objective and direct-debit binding order", () => {
  const shape = insertShape(channelRoute, "campaigns");
  assert.equal(shape.columns.length, shape.values.length);
  assert.equal(shape.placeholders, 39);
  assert.deepEqual(shape.columns.slice(8, 13), [
    "type",
    "campaign_kind",
    "billing_model",
    "funding_model",
    "cost_per_subscriber",
  ]);
  assert.deepEqual(shape.values.slice(8, 13), ["?", "?", "?", "'direct_debit'", "?"]);
  assert.match(
    channelRoute,
    /button_text,\s*type,\s*campaignKind,\s*campaignKind === "channel_growth" \? "cps" : \(type === "clicks" \? "cpc" : "cpm"\),\s*costPerSubscriber/,
  );
});

test("channel readiness covers every always-addressed growth, funding, and Teaser column", () => {
  for (const column of [
    "campaign_kind",
    "billing_model",
    "funding_model",
    "cost_per_subscriber",
    "destination_chat_id",
    "growth_tracking_status",
    "teaser_mode",
    "teaser_enabled",
    "teaser_cta_key",
    "teaser_cpm",
  ]) {
    assert.match(readiness, new RegExp(`"${column}"`));
  }
});

test("unexpected channel creation failures log only a bounded diagnostic code", () => {
  assert.match(channelRoute, /errorCode: safeCampaignCreateDiagnosticCode\(error\)/);
  assert.match(channelRoute, /\^\[A-Z0-9_\]\{1,64\}\$/);
  assert.doesNotMatch(channelRoute, /Campaign creation failed[\s\S]{0,300}sqlMessage/);
});

test("Mini App campaign INSERT has a complete and stable binding shape", () => {
  const shape = insertShape(miniAppRoute, "miniapp_rewarded_campaigns");
  assert.equal(shape.columns.length, shape.values.length);
  assert.equal(shape.placeholders, 36);
  assert.match(
    miniAppRoute,
    /targetCountries \|\| null,\s*\.\.\.targetingDbParams\(targeting\),\s*directPlacementMode,\s*directInventoryScope/,
  );
});
