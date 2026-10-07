import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read("ops/cron/jobs.json"));
const byId = id => manifest.jobs.filter(job => job.id === id);
const policy = read("src/lib/telegramCleanupPolicy.ts");
const audit = read("scripts/cron-audit.sh");
const predeploy = read("scripts/predeploy-check.sh");
const promote = read("scripts/promote-release.sh");

test("O1 manifest has one process-ads", () => assert.equal(byId("process-ads").length, 1));
test("O2 stale channel-health is absent", () => assert(!manifest.jobs.some(j => j.route === "/api/cron/channel-health")));
test("O3 duplicate platform broadcast can be detected", () => assert.match(audit, /LEGACY_DUPLICATE_ROUTE/));
test("O4 cron audit defaults to dry-run", () => assert.match(audit, /MODE="dry-run"/));
test("O5 cron apply is explicit", () => assert.match(audit, /== "--apply"/));
test("O6 wrapper fails unexpected non-2xx", () => assert.match(read("scripts/run-cron-job.sh"), /failed_http/));
test("O7 wrapper accepts valid no-work 2xx", () => assert.match(read("scripts/run-cron-job.sh"), /http_status.*2\[0-9\]\[0-9\]/s));
test("O8 same lock blocks overlap", () => assert.match(read("scripts/run-cron-job.sh"), /flock -n 9/));
test("O9 different jobs have distinct canonical locks", () => assert.equal(new Set(manifest.jobs.map(j => j.lock)).size, manifest.jobs.length));
test("O10 MESSAGE_NOT_FOUND is terminal local success", () => assert.match(policy, /ALREADY_MISSING[\s\S]*MESSAGE_NOT_FOUND[\s\S]*false, true, true/));
test("O11 MESSAGE_CANT_BE_DELETED is terminal no retry", () => assert.match(policy, /CANNOT_DELETE_TERMINAL[\s\S]*MESSAGE_CANT_BE_DELETED[\s\S]*false, true, false/));
test("O12 temporary network failures retry", () => assert.match(policy, /econnreset[\s\S]*TEMPORARY[\s\S]*true, false, false/));
test("O13 bot not member integrates health", () => { assert.match(policy, /BOT_IS_NOT_MEMBER/); assert.match(policy, /persistTelegramChannelAccess/); });
test("O14 cleanup concurrency is bounded", () => assert.match(policy, /Math\.min\(20/));
test("O15 terminal cleanup does not request retry", () => assert.match(policy, /TELEGRAM_DELETE_TERMINAL", false, true/));
test("O16 validator rejects missing BUILD_ID", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ads-build-"));
  const result = spawnSync("bash", [path.join(root, "scripts/build-validator.sh"), dir]);
  assert.notEqual(result.status, 0);
});
test("O17 validator rejects missing server manifests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ads-build-")); fs.writeFileSync(path.join(dir, "BUILD_ID"), "x");
  const result = spawnSync("bash", [path.join(root, "scripts/build-validator.sh"), dir]); assert.notEqual(result.status, 0);
});
test("O18 validator accepts a complete mock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ads-build-"));
  fs.writeFileSync(path.join(dir, "BUILD_ID"), "x");
  for (const f of ["prerender-manifest.json","routes-manifest.json","build-manifest.json"]) fs.writeFileSync(path.join(dir, f), "{}");
  fs.mkdirSync(path.join(dir, "server")); fs.mkdirSync(path.join(dir, "static"));
  assert.doesNotThrow(() => execFileSync("bash", [path.join(root, "scripts/build-validator.sh"), dir]));
});
test("O19 failed validation happens before promote", () => assert(promote.indexOf("build-validator.sh") < promote.indexOf("ln -sfn")));
test("O20 promotion uses atomic symlink replacement", () => assert.match(promote, /mv -Tf/));
test("O21 rollback keeps previous release", () => assert.match(read("docs/PRODUCTION_DEPLOYMENT.md"), /previous-release-id/));
test("O22 predeploy blocks dirty Git", () => assert.match(predeploy, /BLOCKED dirty Git worktree/));
test("O23 predeploy blocks untracked migration", () => assert.match(predeploy, /BLOCKED untracked migration files/));
test("O24 predeploy checks low disk", () => assert.match(predeploy, /BLOCKED low disk space/));
test("O25 status script is read-only", () => assert.doesNotMatch(read("scripts/production-status.sh"), /restart|crontab -|UPDATE |DELETE /));
test("O26 metadata contains revision and no secrets", () => { const s=read("scripts/build-release.sh"); assert.match(s,/git_revision/); assert.doesNotMatch(s,/DB_PASS|BOT_TOKEN|CRON_SECRET/); });
test("O27 runbook verifies App and Cron same release", () => assert.match(read("docs/PRODUCTION_DEPLOYMENT.md"), /both resolve to the same release/));
test("O28 duplicate route logic exists", () => assert.match(audit, /DUPLICATE/));
test("O29 missing route logic exists", () => assert.match(audit, /ROUTE_MISSING/));
test("O30 process/view cadence matches internal budget", () => {
  assert.equal(byId("process-ads")[0].schedule, "* * * * *");
  assert.equal(byId("update-views")[0].schedule, "*/5 * * * *");
  assert(byId("update-views")[0].timeout_seconds >= 240);
});
