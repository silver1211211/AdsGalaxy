import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root="/www/wwwroot/bots/AdsFusion";
const [teaser,placement,cron,emergency,migration]=await Promise.all(["src/lib/teaser.ts","src/lib/teaserPlacement.ts","src/app/api/cron/teaser/route.ts","src/lib/teaserEmergency.ts","db/migrations/20260910_0139_teaser_worker_retry_durability.sql"].map(path=>readFile(`${root}/${path}`,"utf8")));
test("central retry policy is bounded and Flood Wait takes precedence",()=>{
 assert.match(teaser,/TEASER_MAX_RETRY_ATTEMPTS=8/);
 assert.match(teaser,/Math\.max\(retryAfter\|\|0,Math\.min\(3600/);
 assert.match(teaser,/teaserRetryExhausted/);
});
test("placement retries persist attempts, delay, category, and terminally stop",()=>{
 assert.match(placement,/insertion_attempts=insertion_attempts\+1/);
 assert.match(placement,/last_error_category/);
 assert.match(placement,/teaserRetryExhausted\(attempts\)/);
 assert.match(cron,/insertion_next_retry_at=DATE_ADD/);
 assert.match(cron,/removal_next_retry_at=DATE_ADD/);
 assert.match(cron,/status='failed'.*RETRY_CEILING/s);
});
test("view and baseline retry state survives restart and has a ceiling",()=>{
 assert.match(migration,/processing_attempts/);
 assert.match(migration,/processing_next_retry_at/);
 assert.match(cron,/deferViewRetry/);
 assert.match(cron,/processing_attempts=\?/);
 assert.match(cron,/processing_next_retry_at=DATE_ADD/);
});
test("terminal outcomes and permission do not hot retry",()=>{
 assert.match(cron,/missingTelegramMessage/);
 assert.match(cron,/status='already_absent'/);
 assert.match(cron,/teaser_status='needs_permission'/);
 assert.match(cron,/if\(edit\.terminal\)/);
});
test("Emergency work is leased, isolated, deduplicated, and bounded",()=>{
 assert.match(emergency,/for\(const state of states\)\{try\{/);
 assert.match(emergency,/catch\(error\)/);
 assert.match(emergency,/lease_until=DATE_ADD/);
 assert.match(emergency,/INSERT IGNORE INTO teaser_emergency_job_channels/);
 assert.match(emergency,/TEASER_MAX_RETRY_ATTEMPTS/);
 assert.match(emergency,/teaserRetryDelaySeconds\(attempt,out\.retryAfter\)/);
 assert.match(migration,/last_error_category/);
});
test("worker batches remain bounded and financial writes are not retried here",()=>{
 assert.match(cron,/const BATCH=25/);
 assert.match(emergency,/LIMIT 10/);
 assert.match(cron,/for\(const row of rows\)\{try\{/);
 assert.doesNotMatch(cron,/INSERT INTO advertiser_direct_debits|creditUserLockedBalance/);
});
