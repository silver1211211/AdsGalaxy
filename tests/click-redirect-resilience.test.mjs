import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("click redirect uses a placement-approved URL and fails closed when placement lookup fails", () => {
 const route=readFileSync("src/app/api/clicks/[id]/[postId]/route.ts","utf8");
 assert.match(route,/cp\.approved_destination_url/);
 assert.match(route,/!campaignPost\.approved_creative_revision_id/);
 assert.match(route,/Click destination resolution failed/);
 assert.match(route,/Click acceptance failed/);
 assert.match(route,/Click billing or tracking failed; accepted redirect preserved/);
 assert.match(route,/safeCampaignDestination/);
 assert.doesNotMatch(route,/cachedClickDestination/);
});
