import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(file, "utf8");
const migration = read("db/migrations/20260903_0125_miniapp_request_id_collation.sql");
const joinSources = [
  read("src/lib/miniappRevenueOptimizer.ts"),
  read("src/lib/miniappOptimization.ts"),
  read("src/app/api/admin/miniapps/route.ts"),
];

test("Mini App request IDs use one permanent schema collation", () => {
  assert.match(migration, /ALTER TABLE ad_click_attribution/);
  assert.match(
    migration,
    /request_id VARCHAR\(100\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL/
  );
  assert.match(migration, /ALGORITHM=COPY, LOCK=SHARED/);
  assert.doesNotMatch(migration, /miniapp_mediation_requests\s+MODIFY/i);
});

test("all same-key Mini App joins remain plain indexed equality joins", () => {
  for (const source of joinSources) {
    assert.match(source, /mr\.request_id = ac\.request_id/);
    assert.doesNotMatch(source, /(?:COLLATE|CAST|LOWER)\s*\([^\n]*request_id/i);
    assert.doesNotMatch(source, /request_id\s+COLLATE/i);
  }
});

test("migration is idempotent and preserves the indexed column shape", () => {
  assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(migration, /@request_id_collation <> 'utf8mb4_unicode_ci'/);
  assert.doesNotMatch(migration, /DROP\s+(?:INDEX|KEY)/i);
  assert.doesNotMatch(migration, /UPDATE\s+/i);
});
