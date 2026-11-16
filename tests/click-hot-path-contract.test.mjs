import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("click redirect hot path does not discover schema", () => {
  const source = readFileSync("src/app/api/clicks/[id]/[postId]/route.ts", "utf8");
  assert.doesNotMatch(source, /INFORMATION_SCHEMA\.COLUMNS/i);
  assert.match(source, /acceptChannelCampaignClick\(pool/);
  const acceptance = readFileSync("src/lib/channelAcceptedEngagement.ts", "utf8");
  assert.match(acceptance, /fingerprint=\?/);
  assert.match(acceptance, /INSERT INTO campaign_clicks/);
  assert.match(acceptance, /accepted_at/);
});
