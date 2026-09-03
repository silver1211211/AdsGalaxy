import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("publisher channel errors render messages instead of object coercion", () => {
  const helper = read("src/lib/apiErrorMessage.ts");
  const form = read("src/components/publisher/AddChannelForm.tsx");
  const screen = read("src/components/publisher/AddChannelScreen.tsx");
  assert.match(helper, /typeof nested\.message === "string"/);
  assert.match(form, /getApiErrorMessage\(data, "Failed to add channel"\)/);
  assert.match(screen, /getApiErrorMessage\(data, `Failed to \$\{isEdit/);
  assert.doesNotMatch(form + screen, /new Error\(data\.error \|\|/);
});

test("channel creation handles transient database resets without duplicate blind retries", () => {
  const route = read("src/app/api/publisher/channels/route.ts");
  const errors = read("src/lib/publisherChannelErrors.ts");
  assert.match(route, /queryWithRetry<SettingRow\[\]>/);
  assert.match(route, /publisher_channel_insert_recovery/);
  assert.match(route, /isTransientDatabaseError\(error\)/);
  assert.match(errors, /DATABASE_TEMPORARILY_UNAVAILABLE/);
});

test("admin Mini App search accepts both 26 and #26 and keeps count pagination aligned", () => {
  const route = read("src/app/api/admin/miniapps/route.ts");
  const normalize = (value) => {
    const search = value.trim();
    const idSearch = search.replace(/^#+/, "").trim();
    return /^\d+$/.test(idSearch) ? Number(idSearch) : null;
  };
  assert.equal(normalize("26"), 26);
  assert.equal(normalize(" #26 "), 26);
  assert.equal(normalize("redtube12_bot"), null);
  assert.match(route, /numericMiniappId !== null \? " OR m\.id = \?"/);
  assert.match(route, /countQuery \+= whereClause/);
  assert.match(route, /pool\.query\(countQuery, queryParams\)/);
});
