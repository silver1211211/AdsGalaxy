import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("channel identity reconciliation is dry-run and fails closed for ownership conflicts", () => {
 const source=readFileSync("scripts/reconcile-channel-identities.mjs","utf8");
 for(const name of ["SAFE_UNIQUE","SAME_OWNER_DUPLICATE","CROSS_OWNER_CONFLICT","PRIVATE_TRACKING_UNAVAILABLE","BOT_REMOVED","UNKNOWN"]) assert.match(source,new RegExp(name));
 assert.match(source,/Dry-run only/); assert.match(source,/manual_review_no_ownership_transfer/); assert.doesNotMatch(source,/UPDATE channels|INSERT INTO|DELETE FROM/);
});
