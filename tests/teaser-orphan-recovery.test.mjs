import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root="/www/wwwroot/bots/AdsFusion";
const [placement,cron,emergency,migration]=await Promise.all([
  readFile(`${root}/src/lib/teaserPlacement.ts`,"utf8"),
  readFile(`${root}/src/app/api/cron/teaser/route.ts`,"utf8"),
  readFile(`${root}/src/lib/teaserEmergency.ts`,"utf8"),
  readFile(`${root}/db/migrations/20260910_0138_teaser_orphan_recovery.sql`,"utf8"),
]);
test("insert claim is durable before Telegram and carries immutable render identity",()=>{
  assert.match(placement,/status,operation_kind,operation_started_at,operation_lease_expires_at/);
  assert.match(placement,/'inserting','insert',NOW\(\),DATE_ADD\(NOW\(\),INTERVAL/);
  assert.match(placement,/rendered_content_hash/);
  assert.ok(placement.indexOf("await conn.commit();committed=true")<placement.indexOf("await editTelegramTeaser"),"Telegram I/O starts after commit");
});
test("insert recovery replays complete intended content and never allocates identity",()=>{
  assert.match(cron,/const expectedText=rendered\.text, expectedEntities=entities\(row\.rendered_entities\)/);
  assert.match(cron,/contentHash\(expectedText,expectedEntities\)!==String\(row\.rendered_content_hash\)/);
  assert.match(cron,/editTelegramTeaser\(\{chatId:Number\(row\.telegram_chat_id\).*text:expectedText/);
  assert.doesNotMatch(cron,/opaqueTeaserToken|INSERT INTO advertiser_direct_debits|creditUserLockedBalance/);
});
test("orphan finalization is conditional, quota-safe, and baseline remains non-billable",()=>{
  assert.match(placement,/inserted_at=COALESCE\(inserted_at,NOW\(\)\)/);
  assert.match(placement,/WHERE channel_id=\? AND inserted_at>=UTC_DATE\(\)/);
  assert.match(cron,/WHERE id=\? AND status='inserting'/);
  assert.match(cron,/baseline\.ok\?"active":"awaiting_baseline"/);
});
test("stale insert claims cannot be stolen before expiry and lifecycle queues cleanup",()=>{
  assert.match(cron,/status='inserting' AND operation_lease_expires_at<=NOW\(\)/);
  assert.match(cron,/status='claimed' OR \(status='inserting' AND operation_lease_expires_at<=NOW\(\)\)/);
  assert.match(cron,/orphan_lifecycle_inactive/);
});
test("removal is durable, latest-snapshot-only, and idempotent",()=>{
  assert.match(cron,/status='removing',operation_kind='remove'/);
  assert.match(cron,/status='removal_pending' OR \(status='removing' AND operation_lease_expires_at<=NOW\(\)\)/);
  assert.match(cron,/ORDER BY last_seen_update_id DESC LIMIT 1/);
  assert.match(cron,/stripExactTeaserSuffix/);
  assert.match(cron,/status='removed'.*removed_at=COALESCE/s);
  assert.match(cron,/status='already_absent'.*removed_at=COALESCE/s);
});
test("bounded per-item reconciliation and generic stale processing leases exist",()=>{
  assert.match(cron,/const BATCH=25, RECONCILIATION_BATCH=10/);
  assert.match(cron,/for\(const row of rows\)\{try\{/);
  assert.match(cron,/console\.error\("teaser orphan reconciliation failed"/);
  assert.match(emergency,/status='processing',lease_until=DATE_ADD\(NOW\(\),INTERVAL 5 MINUTE\)/);
  assert.match(emergency,/status='processing' AND lease_until<NOW\(\)/);
  assert.match(migration,/idx_teaser_operation_lease/);
  assert.match(migration,/idx_teaser_emergency_processing_lease/);
});
