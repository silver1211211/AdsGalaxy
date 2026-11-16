import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("click dedupe has a composite index matching the hot redirect predicate", () => {
 const route=readFileSync("src/app/api/clicks/[id]/[postId]/route.ts","utf8");
 const acceptance=readFileSync("src/lib/channelAcceptedEngagement.ts","utf8");
 const migration=readFileSync("db/migrations/20261007_0157_click_dedupe_hot_path_index.sql","utf8");
 assert.match(route,/acceptChannelCampaignClick\(pool/);
 assert.match(acceptance,/post_id=\? AND fingerprint=\?[\s\S]*created_at>NOW\(\)-INTERVAL 1 DAY/);
 assert.match(migration,/\(post_id, fingerprint, created_at\)/);
});
