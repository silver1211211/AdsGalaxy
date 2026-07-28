import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker = readFileSync("src/app/api/cron/process-broadcast/route.ts", "utf8");
const telegram = readFileSync("src/lib/telegram.ts", "utf8");
const lifecycle = readFileSync("src/lib/botLifecycle.ts", "utf8");
const deploy = readFileSync("deploy-vps.sh", "utf8");

test("broadcast worker remains secured and scheduled", () => {
  assert.match(worker, /requireCronSecret\(req\)/);
  assert.match(deploy, /process-broadcast/);
  assert.doesNotMatch(worker, /CRON_SECRET.*NextResponse|secret.*details/i);
});

test("broadcast throttle defaults are bounded", () => {
  assert.match(worker, /CRON_BROADCAST_BATCH_SIZE \|\| "20"/);
  assert.match(worker, /Math\.min\(100, Math\.max\(1/);
  assert.match(worker, /Number\(bot\.posts_per_day\) \|\| 1/);
});

test("healthy integrated bots and verified reachable non-owner users are selected", () => {
  assert.match(worker, /health_status, 'active'\) IN \('active', 'healthy'\)/);
  assert.match(worker, /integration_secret_encrypted IS NOT NULL/);
  assert.match(worker, /integration_secret_hash IS NOT NULL/);
  assert.match(worker, /botUserBroadcastEligibleCondition/);
});

test("Telegram transport and rate-limit retry are bounded", () => {
  assert.match(telegram, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(lifecycle, /parameters\?\.retry_after/);
  assert.match(lifecycle, /Math\.min\(10_000/);
});
