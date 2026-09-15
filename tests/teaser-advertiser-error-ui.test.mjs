import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const wizard=fs.readFileSync("src/app/advertiser/campaigns/new/[kind]/page.tsx","utf8");
const details=fs.readFileSync("src/components/advertiser/CampaignDetailsScreen.tsx","utf8");

test("advertiser Teaser paths map known failures through the shared mapper",()=>{
  for(const source of [wizard,details]) assert.match(source,/teaserErrorMessageKey/);
  for(const code of ["INVALID_TEASER_CPM","INVALID_TEASER_COPY_COUNT","TEASER_COPY_TOO_SHORT","TEASER_COPY_TOO_LONG","DUPLICATE_TEASER_COPY","TEASER_COPY_CONTAINS_URL","INVALID_TEASER_CTA","TEASER_NOT_AVAILABLE_FOR_CLICK"]) assert.match(wizard,new RegExp(`safeTeaserError\\("${code}"\\)`));
  for(const code of ["TEASER_ENABLE_FAILED","TEASER_DISABLE_FAILED"]) assert.match(details,new RegExp(`safeTeaserError\\("${code}"\\)`));
});
test("advertiser Teaser UI has a safe fallback and no raw error rendering",()=>{
  assert.match(wizard,/safeTeaserError\(data\?\.error\)/);
  assert.match(details,/safeTeaserError\(body\?\.error\)/);
  assert.doesNotMatch(details,/setTeaserError\(error\.message\)/);
  assert.doesNotMatch(wizard,/setError\(data\.error\)/);
  assert.match(details,/teaserCooldownActive/);
});
