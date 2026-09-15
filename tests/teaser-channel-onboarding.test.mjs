import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("channel onboarding exposes independent default-on Teaser configuration", () => {
  const page = read("src/app/publisher/monetize/page.tsx");
  assert.match(page, /chTeaserEnabled.*useState\(true\)/);
  assert.match(page, /chTeaserDailyLimit.*useState\(2\)/);
  assert.match(page, /\[2, 3, 4, 5\]\.map/);
  assert.match(page, /teaser_enabled: chTeaserEnabled/);
  assert.match(page, /teaser_daily_limit: chTeaserDailyLimit/);
  assert.match(page, /teaser\.independentPosting/);
  assert.match(page, /teaser\.targetingHint/);
});

test("channel creation persists Teaser settings and derives edit permission independently", () => {
  const route = read("src/app/api/publisher/channels/route.ts");
  const chatInfo = read("src/app/api/telegram/chat-info/route.ts");
  assert.match(route, /validateTeaserDailyLimit\(teaser_daily_limit \?\? 2\)/);
  assert.match(route, /member\?\.can_edit_messages === true/);
  assert.match(route, /"teaser_enabled"/);
  assert.match(route, /"teaser_daily_limit"/);
  assert.match(route, /"teaser_status"/);
  assert.match(chatInfo, /can_edit_messages: isCreator \|\| member\.can_edit_messages === true/);
});

test("publisher channel payload returns persisted Teaser configuration", () => {
  const route = read("src/app/api/publisher/channels/route.ts");
  for (const column of ["c.teaser_enabled", "c.teaser_daily_limit", "c.teaser_status"]) {
    assert.ok(route.includes(column));
  }
});

test("Teaser ingestion and permission checks resolve channels by numeric chat_id", () => {
  const ingestion = read("src/app/api/internal/bot/teaser/route.ts");
  const settings = read("src/app/api/publisher/channels/[id]/route.ts");
  assert.match(ingestion, /WHERE chat_id=\? AND teaser_enabled=1/);
  assert.match(ingestion, /WHERE ch\.chat_id=\?/);
  assert.doesNotMatch(ingestion, /WHERE ch\.channel_id=\?/);
  assert.match(settings, /SELECT chat_id FROM channels/);
  assert.match(settings, /rows\[0\]\.chat_id/);
});
