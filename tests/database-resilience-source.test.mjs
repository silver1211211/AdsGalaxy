import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const db = fs.readFileSync("src/lib/db.ts", "utf8");
const resilience = fs.readFileSync("src/lib/dbResilience.ts", "utf8");
const settings = fs.readFileSync("src/app/api/settings/route.ts", "utf8");
const monetag = fs.readFileSync("src/lib/miniappMonetagProtection.ts", "utf8");
const healthcheck = fs.readFileSync("scripts/adsgalaxy-app-healthcheck.sh", "utf8");

test("database pool has bounded connection, idle, and queue settings", () => {
  assert.match(db, /connectTimeout:\s*DB_CONNECT_TIMEOUT_MS/);
  assert.match(db, /idleTimeout:/);
  assert.match(db, /queueLimit:/);
  assert.match(db, /maxIdle:\s*connectionLimit/);
});

test("public settings query is time bounded and retries transient failures", () => {
  assert.match(settings, /queryWithRetry<PublicSettingRow\[\]>/);
  assert.match(settings, /timeoutMs:\s*5_000/);
  assert.match(settings, /attempts:\s*3/);
  assert.match(resilience, /ER_LOCK_DEADLOCK/);
  assert.match(resilience, /ECONNRESET/);
  assert.match(resilience, /PROTOCOL_CONNECTION_LOST/);
});

test("Monetag state avoids a write lock when the state row already exists", () => {
  const selectPosition = monetag.indexOf("SELECT id FROM miniapp_network_frequency_state");
  const insertPosition = monetag.indexOf("INSERT IGNORE INTO miniapp_network_frequency_state");
  assert.ok(selectPosition >= 0);
  assert.ok(insertPosition > selectPosition);
  assert.match(monetag, /if \(existing\.length > 0\) \{\s*return;/);
});

test("health monitor requires repeated failures and has restart-loop protection", () => {
  assert.match(healthcheck, /MAX_FAILURES=3/);
  assert.match(healthcheck, /RESTART_COOLDOWN_SECONDS=600/);
  assert.match(healthcheck, /--connect-timeout 2 --max-time 7/);
  assert.match(healthcheck, /restart "\$APP_NAME" --update-env/);
  assert.match(healthcheck, /logger -t adsgalaxy-health/);
});
