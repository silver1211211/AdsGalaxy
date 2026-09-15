import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const ingest=fs.readFileSync("src/app/api/internal/bot/teaser/route.ts","utf8");
const cron=fs.readFileSync("src/app/api/cron/teaser/route.ts","utf8");
test("publisher edits use render-hash self-edit protection and exact suffix reconciliation",()=>{
 assert.match(ingest,/rendered_content_hash/);assert.match(ingest,/ignored:"SELF_EDIT"/);assert.match(ingest,/stripExactTeaserSuffix\(input\.text,p\.rendered_suffix\)/);assert.match(ingest,/saveOrganicSnapshot/);assert.match(ingest,/teaserContentFits/);
});
test("removal prefers the latest organic snapshot and safely falls back to the durable placement snapshot",()=>{
 assert.match(cron,/ORDER BY last_seen_update_id DESC LIMIT 1/);assert.match(cron,/latest\?\.organic_text\?\?row\.organic_text/);assert.match(cron,/latest\?entities\(/);assert.match(cron,/stripExactTeaserSuffix/);assert.doesNotMatch(cron,/split\("Sponsored"/);
});
