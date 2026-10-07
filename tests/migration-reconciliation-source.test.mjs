import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("migration reconciliation is dry-run first and protects 0150", () => {
 const source=readFileSync("scripts/reconcile-migration-ledger.mjs","utf8");
 assert.match(source,/Read-only by default/); assert.match(source,/ADSGALAXY_EXPLICIT_SCHEMA_BASELINE/); assert.match(source,/0150_/); assert.match(source,/checksum_mismatch/); assert.match(source,/ALREADY_PRESENT_AND_COMPATIBLE/); assert.match(source,/PARTIALLY_PRESENT/); assert.match(source,/MISSING/); assert.match(source,/UNKNOWN/); assert.doesNotMatch(source,/query\(source/);
});
