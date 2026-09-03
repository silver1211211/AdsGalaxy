import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const broadcast = readFileSync("src/lib/platformBroadcast.ts", "utf8");
const worker = readFileSync("src/app/api/cron/platform-broadcasts/route.ts", "utf8");
const attribution = readFileSync("src/lib/referralAttribution.ts", "utf8");

test("platform broadcasts target users known to be reachable by the official bot", () => {
  assert.match(broadcast, /official_bot_started_at IS NOT NULL/);
  assert.match(broadcast, /previous\.status = 'sent'/);
  assert.match(attribution, /official_bot_started_at = NOW\(\)/);
});

test("image retrieval failures fall back once to text and counters stay live", () => {
  assert.match(worker, /BROADCAST_IMAGE_FETCH_FAILED/);
  assert.match(worker, /textOnlyBroadcasts/);
  assert.match(worker, /failed to get http url content/i);
  assert.match(worker, /syncBroadcastCounts\(broadcast\.id\)/);
});
