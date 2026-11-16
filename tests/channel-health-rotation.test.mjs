import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const monitor = readFileSync("src/lib/channelHealthMonitor.ts", "utf8");

test("health monitor rotates across eligible channels instead of repeating oldest IDs", () => {
  assert.match(monitor, /channel_health_monitor_cursor/);
  assert.match(monitor, /ORDER BY \(ch\.id>\$\{cursor\}\) DESC,ch\.id ASC/);
  assert.match(monitor, /channels\[channels\.length - 1\]\.id/);
});

test("private channel access failure uses the verified access pause path", () => {
  assert.match(monitor, /autoPauseActive: channel.channel_type === "private"/);
  assert.match(monitor, /const autoPaused = telegramAutoPaused/);
  assert.match(monitor, /status_mutation_enabled: true/);
  assert.doesNotMatch(monitor, /UPDATE channels SET status=/);
});
