import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const analytics=fs.readFileSync("src/app/admin/teaser-analytics/page.tsx","utf8");
const settings=fs.readFileSync("src/app/admin/settings/page.tsx","utf8");
test("admin Teaser paths use safe mapping and persisted override state",()=>{
  assert.match(analytics,/teaserErrorMessageKey/);assert.match(settings,/teaserErrorMessageKey/);
  assert.match(analytics,/override_targeting:overrideTargeting/);assert.match(analytics,/override_confirmation:overrideTargeting\?"CONFIRM_OVERRIDE"/);
  assert.match(analytics,/Boolean\(j\.override_targeting\)/);assert.match(analytics,/jobStatusKey/);
  assert.match(settings,/safeTeaserError\(data\?\.error\s*\|\|\s*"TEASER_SETTINGS_SAVE_FAILED"\)/);assert.match(settings,/safeTeaserError\("TEASER_SPLIT_INVALID"\)/);
});
test("admin Teaser error UI does not render raw server or exception detail",()=>{
  assert.doesNotMatch(analytics,/setError\(e instanceof Error\?e\.message/);assert.doesNotMatch(analytics,/throw new Error\(body\.error/);
  assert.doesNotMatch(settings,/setError\(errorMessage\(err, t\("teaser.settingsSaveError"\)\)/);
});
