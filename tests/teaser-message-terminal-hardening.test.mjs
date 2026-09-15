import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const teaser=fs.readFileSync("src/lib/teaser.ts","utf8");
const placement=fs.readFileSync("src/lib/teaserPlacement.ts","utf8");
const cron=fs.readFileSync("src/app/api/cron/teaser/route.ts","utf8");
test("terminal edit categories separate snapshot, permission, and content failures",()=>{
  for(const category of ["MESSAGE_TERMINAL","CHANNEL_PERMISSION","CONTENT_TERMINAL","RATE_LIMITED","RETRYABLE_NETWORK"])assert.match(teaser,new RegExp(category));
  assert.match(placement,/edit\.category==="CHANNEL_PERMISSION"/);
  assert.match(placement,/edit\.category==="CONTENT_TERMINAL"\?"POST_TOO_LONG"/);
  assert.match(placement,/SNAPSHOT_NOT_EDITABLE/);
});
test("missing views terminalize without manufacturing zero views or altering settlement",()=>{
  assert.match(cron,/missingTelegramMessage/);
  assert.match(cron,/status='already_absent'/);
  assert.doesNotMatch(cron,/baseline_views=0/);
  assert.doesNotMatch(cron,/settled_impressions=0/);
});
test("removal missing messages are idempotently terminal",()=>{
  assert.match(cron,/if\(result\.terminal\).*already_absent/s);
  assert.match(teaser,/message to edit not found/);
});
