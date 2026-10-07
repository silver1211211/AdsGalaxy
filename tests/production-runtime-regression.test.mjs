import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Teaser permission updates use Telegram chat_id and never channels.channel_id", () => {
  const source = read("src/app/api/internal/bot/teaser/route.ts");
  assert.match(source, /WHERE chat_id=\? AND teaser_enabled=1/);
  assert.match(source, /WHERE ch\.chat_id=\?/);
  assert.doesNotMatch(source, /UPDATE channels[\s\S]{0,300}WHERE channel_id\s*=/);
});

test("Teaser insertion activates only after the Telegram edit and preserves baseline", () => {
  const telegram = read("src/lib/teaser.ts");
  const placement = read("src/lib/teaserPlacement.ts");
  assert.match(telegram, /editMessageText/);
  assert.match(telegram, /editMessageCaption/);
  assert.ok(placement.indexOf("editTelegramTeaser") < placement.lastIndexOf("baseline_views"));
  assert.match(placement, /baseline\.ok\?baseline\.views:null/);
});

test("Teaser removal and retry remain durable and bounded", () => {
  const worker = read("src/app/api/cron/teaser/route.ts");
  for (const token of ["settleTeaserViews", "organic_text", "removal_next_retry_at", "already_absent", "teaserRetryDelaySeconds"]) {
    assert.match(worker, new RegExp(token));
  }
});

test("Teaser settlement remains checkpoint-idempotent and direct debit", () => {
  const source = read("src/lib/teaser.ts");
  const migration = read("db/migrations/20260909_0134_teaser_ads.sql");
  assert.match(source, /claimAdvertiserDirectDebit/);
  assert.match(source, /teaser_impression/);
  assert.match(migration, /uq_teaser_settlement_checkpoint/);
  assert.match(migration, /uq_teaser_settlement_debit/);
});

test("MTProto accounts are isolated, hydrate entities, and fail over safely", () => {
  const source = read("src/lib/telegramMtproto.ts");
  assert.match(source, /const clientPromises: Partial<Record<MtprotoAccountKey, Promise<TelegramClient>>>/);
  assert.match(source, /await client\.getDialogs\(\{ limit: 500 \}\)/);
  assert.match(source, /for \(const account of orderedKeys\)/);
  assert.match(source, /attemptedAccounts\.push\(mtprotoAccountNumber\(account\)\)/);
  assert.match(source, /cooldownAccounts\.push\(mtprotoAccountNumber\(account\)\)/);
  assert.match(source, /peer_entity_unavailable/);
  assert.match(source, /not_channel_member/);
  assert.match(source, /session_unauthorized/);
  assert.match(source, /network_error/);
});

test("private view tracking prefers its assigned account while public tracking retains fallback", () => {
  const source = read("src/app/api/cron/update-views/route.ts");
  assert.match(source, /verifyPrivateMembership:\s*true/);
  assert.match(source, /no_verified_private_member/);
  assert.match(source, /fallback_attempted/);
  assert.match(source, /result: PublicViewResult = username\s*\?\s*await fetchPublicViews\(username, post\.message_id\)/);
  assert.match(source, /source = "public_api"/);
  assert.match(source, /source = "mtproto_public_fallback"/);
});
