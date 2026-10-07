import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("click redirect fallback is server-authoritative and tracking failures preserve its destination", () => {
 const route=readFileSync("src/app/api/clicks/[id]/[postId]/route.ts","utf8"); const cache=readFileSync("src/lib/clickDestinationCache.ts","utf8");
 assert.match(route,/cachedClickDestination/); assert.match(route,/Click tracking failed; redirect preserved/); assert.match(route,/safeCampaignDestination/);
 assert.match(cache,/Never accepts a request URL/); assert.match(cache,/safeCampaignDestination/); assert.doesNotMatch(cache,/searchParams.*url/i);
});
