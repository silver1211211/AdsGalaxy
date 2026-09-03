import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const broadcast = readFileSync("src/lib/platformBroadcast.ts", "utf8");
const route = readFileSync("src/app/api/admin/platform-broadcasts/route.ts", "utf8");
const page = readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");
const auth = readFileSync("src/lib/auth.ts", "utf8");
const telegram = readFileSync("src/lib/telegramWebApp.ts", "utf8");

test("broadcast recipients support fixed joined and active time windows", () => {
  assert.match(broadcast, /joined_within/);
  assert.match(broadcast, /active_within/);
  assert.match(broadcast, /u\.created_at/);
  assert.match(broadcast, /u\.last_active_at/);
  assert.match(route, /target_since/);
  assert.match(page, /Send to everybody/);
  assert.match(page, /Send to fetched users/);
  assert.match(auth, /last_active_at = NOW\(\)/);
});

test("Mini App can recover signed initData from Telegram launch parameters", () => {
  assert.match(telegram, /getLaunchParam\("tgWebAppData"\)/);
});
