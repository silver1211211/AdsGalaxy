import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/lib/channelAllocationLedger.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../db/migrations/20260801_0108_canonical_channel_allocation_ledger.sql", import.meta.url), "utf8");
const fast = fs.readFileSync(new URL("../src/lib/channelFastBilling.ts", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../src/lib/channelSettlement.ts", import.meta.url), "utf8");
const math = await import(new URL("../src/lib/channelAllocationMath.ts", import.meta.url));

test("canonical ledger is additive, immutable-keyed, and fixed point", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS channel_allocation_ledger/);
  assert.match(migration, /UNIQUE KEY uniq_channel_allocation_source_key/);
  assert.match(migration, /DECIMAL\(24,8\)/);
  assert.match(migration, /quality_adjustment/);
  assert.match(migration, /advertiser_debit = publisher_allocation \+ platform_allocation \+ reserve_allocation \+ quality_adjustment/);
  assert.doesNotMatch(migration, /\b(?:DROP|RENAME|TRUNCATE)\b|\bDELETE\s+FROM\b|(?:^|;)\s*UPDATE\s+/im);
});

test("reversal linkage is relationship-safe", () => {
  assert.match(migration, /source_type = 'reversal' AND reversal_of_event_id IS NOT NULL AND reversal_of_event_id <> event_id/);
  assert.match(migration, /source_type <> 'reversal' AND reversal_of_event_id IS NULL/);
  assert.match(migration, /CONSTRAINT fk_channel_allocation_reversal_event/);
  assert.match(migration, /FOREIGN KEY \(reversal_of_event_id\) REFERENCES channel_allocation_ledger\(event_id\)/);
  assert.match(migration, /ON UPDATE RESTRICT ON DELETE RESTRICT/);

  const checkAllows = ({ sourceType, eventId, reversalOf }) =>
    (sourceType === "reversal" && reversalOf !== null && reversalOf !== eventId)
    || (sourceType !== "reversal" && reversalOf === null);
  assert.equal(checkAllows({ sourceType: "reversal", eventId: "new", reversalOf: "original" }), true);
  assert.equal(checkAllows({ sourceType: "reversal", eventId: "new", reversalOf: null }), false);
  assert.equal(checkAllows({ sourceType: "reversal", eventId: "same", reversalOf: "same" }), false);
  for (const sourceType of ["view", "click", "adjustment"]) {
    assert.equal(checkAllows({ sourceType, eventId: "new", reversalOf: "original" }), false);
  }
  // The self-referencing FK supplies the remaining existence guarantee: a
  // non-null missing event ID cannot be inserted unless that event exists.
});

test("policy uses bigint fixed-point and separates quality holdback", () => {
  const fullQuality = math.calculateCurrentCanonicalAllocation({ advertiserDebit: "1.00000000", platformMarginPercent: "40", safetyReservePercent: "10", qualityWeight: "1" });
  assert.deepEqual(Object.fromEntries(Object.entries(fullQuality).map(([key, value]) => [key, math.unitsToDecimal(value)])), {
    debit: "1.00000000", publisher: "0.54000000", platform: "0.40000000", reserve: "0.06000000", qualityAdjustment: "0.00000000",
  });
  const weighted = math.calculateCurrentCanonicalAllocation({ advertiserDebit: "1", platformMarginPercent: "40", safetyReservePercent: "10", qualityWeight: "0.5" });
  assert.equal(math.unitsToDecimal(weighted.publisher), "0.27000000");
  assert.equal(math.unitsToDecimal(weighted.qualityAdjustment), "0.27000000");
  assert.equal(weighted.publisher + weighted.platform + weighted.reserve + weighted.qualityAdjustment, weighted.debit);
});

test("shadow mode is explicitly disabled unless exactly true", () => {
  assert.match(source, /CHANNEL_ALLOCATION_LEDGER_SHADOW_WRITE_ENABLED === "true"/);
  assert.match(source, /return \{ status: "disabled" as const \}/);
  assert.match(source, /canonical_source_key_payload_conflict/);
  assert.match(source, /Canonical channel allocation shadow write failed/);
});

test("both fast and legacy financial paths invoke the shadow writer", () => {
  assert.match(fast, /shadowWriteChannelAllocation/);
  assert.match(legacy, /shadowWriteChannelAllocation/);
  assert.match(fast, /fast:\$\{row\.source_key\}/);
  assert.match(legacy, /legacy:\$\{kind\}:\$\{post\.post_id\}:\$\{settledThrough\}/);
  assert.ok(fast.indexOf("await conn.commit()") < fast.indexOf("await shadowWriteChannelAllocation(conn"));
  assert.ok(legacy.indexOf("await connection.commit()", legacy.indexOf("INSERT INTO channel_settlement_ledger")) < legacy.indexOf("await shadowWriteChannelAllocation(connection"));
});

test("canonical reporting covers all allocation components and reversals", () => {
  for (const field of ["advertiser_spend", "publisher_allocation", "platform_allocation", "reserve_allocation", "quality_holdback", "reversals"]) {
    assert.match(source, new RegExp(field));
  }
});

test("canonical code cannot mutate balances or create duplicate legacy financial events", () => {
  assert.doesNotMatch(source, /UPDATE\s+(users|campaigns|campaign_posts)|INSERT\s+INTO\s+(channel_advertiser_debits|ad_settlements|ad_settlements_views)/i);
  assert.equal((fast.match(/INSERT INTO channel_advertiser_debits/g) || []).length, 1);
  assert.equal((fast.match(/creditUserLockedBalance\(/g) || []).length, 1);
  assert.equal((legacy.match(/creditUserLockedBalance\(/g) || []).length, 1);
  for (const kind of ["view", "click", "reversal", "adjustment"]) assert.match(source, new RegExp(`\\"${kind}\\"`));
});
