import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const status = readFileSync("src/lib/miniappExternalDeliveryStatus.ts", "utf8");
const migration = readFileSync("db/migrations/20261007_0156_system_hardening_integrity.sql", "utf8");
const values = ["scheduled", "running", "paused", "daily_cap_paused", "insufficient_balance_paused", "funding_paused", "budget_exhausted", "incomplete", "completed", "cancelled", "failed"];
test("every canonical Mini App external-sync state fits the persisted status contract", () => { assert.match(status, /MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUS_COLUMN_LENGTH = 64/); assert.match(migration, /MODIFY COLUMN status VARCHAR\(64\)/); for (const value of values) { assert.match(status, new RegExp(`"${value}"`)); assert.ok(value.length <= 64); } assert.equal("insufficient_balance_paused".length, 27); });
