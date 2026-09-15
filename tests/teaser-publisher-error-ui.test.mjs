import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/components/publisher/ChannelDetailsScreen.tsx", "utf8");

test("publisher Teaser errors use the shared safe mapper", () => {
  assert.match(source, /teaserErrorMessageKey/);
  assert.match(source, /safeTeaserError\(data\?\.error\|\|"TEASER_SETTINGS_SAVE_FAILED"\)/);
  assert.match(source, /safeTeaserError\("TEASER_PERMISSION_CHECK_FAILED"\)/);
  assert.match(source, /safeTeaserError\("TEASER_INVALID_DAILY_LIMIT"\)/);
  assert.match(source, /safeTeaserError\("TEASER_TEMPORARILY_UNAVAILABLE"\)/);
});

test("permission check only changes state on a confirmed response", () => {
  assert.match(source, /if\(response\.ok\)\{if\(data\.status==="needs_permission"\|\|data\.error==="TEASER_EDIT_PERMISSION_REQUIRED"\)setTeaserStatus\("needs_permission"\)/);
  assert.doesNotMatch(source, /catch\{setTeaserStatus\("needs_permission"\)/);
});

test("publisher Teaser path never renders raw server or exception text", () => {
  assert.doesNotMatch(source, /setTeaserError\(data\.error\)/);
  assert.doesNotMatch(source, /setTeaserError\(error\.message\)/);
  assert.match(source, /setTeaserEnabled\(enabled\);setTeaserLimit\(limit\)/);
});
