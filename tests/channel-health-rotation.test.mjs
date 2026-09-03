import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const monitor = readFileSync("src/lib/channelHealthMonitor.ts", "utf8");

test("health monitor rotates across eligible channels instead of repeating oldest IDs", () => {
  assert.match(monitor, /channel_health_monitor_cursor/);
  assert.match(monitor, /ORDER BY \(ch\.id>\$\{cursor\}\) DESC,ch\.id ASC/);
  assert.match(monitor, /channels\[channels\.length - 1\]\.id/);
});

test("permanent Telegram access failures leave the active population", () => {
  assert.match(monitor, /if \(telegramHealth\.permanent\) permanentAccessStatus = telegramHealth\.status/);
  assert.match(monitor, /CASE WHEN \? IS NOT NULL THEN \? WHEN \? THEN 'paused' ELSE status END/);
});
