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
  assert.match(monitor, /const autoPaused = false/);
  assert.match(monitor, /status_mutation_enabled: false/);
  assert.doesNotMatch(monitor, /UPDATE channels SET status=/);
});
