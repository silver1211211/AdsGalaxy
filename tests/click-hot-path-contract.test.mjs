import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("click redirect hot path does not discover schema", () => {
  const source = readFileSync("src/app/api/clicks/[id]/[postId]/route.ts", "utf8");
  assert.doesNotMatch(source, /INFORMATION_SCHEMA\.COLUMNS/i);
  assert.match(source, /WHERE post_id = \? AND fingerprint = \?/);
  assert.match(source, /INSERT INTO campaign_clicks \(campaign_id,post_id,ip_address,user_agent,fingerprint,is_bot\)/);
});
