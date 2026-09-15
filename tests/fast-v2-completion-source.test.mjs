import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("billing locks campaigns before posts and cleanup skips busy bounded rows", () => {
  const billing = read("src/lib/channelFastBilling.ts");
  const cleanup = read("src/lib/expiredChannelCleanup.ts");
  assert.ok(billing.indexOf("SELECT id FROM campaigns WHERE id=? FOR UPDATE") < billing.indexOf("FROM campaign_posts cp JOIN campaigns"));
  assert.match(billing, /FOR UPDATE SKIP LOCKED/);
  assert.match(cleanup, /limit: 25/);
});

test("broadcast exhaustion updates only a bounded primary-key candidate set", () => {
  const worker = read("src/app/api/cron/process-broadcast/route.ts");
  assert.match(worker, /ORDER BY c\.id[\s\S]*LIMIT 50/);
  assert.match(worker, /WHERE status='active' AND id IN/);
});

test("referral and financial histories use keyset cursors", () => {
  for (const path of ["src/lib/referralSprint.ts", "src/app/api/advertiser/deposits/route.ts", "src/app/api/publisher/withdrawals/route.ts"]) {
    const source = read(path);
    assert.match(source, /created_at < \?/);
    assert.match(source, /created_at = \? AND (?:r\.)?id < \?/);
    assert.doesNotMatch(source, /OFFSET/);
  }
});

test("both campaign builders require the reusable crop dialog", () => {
  const classic = read("src/app/advertiser/campaigns/new/[kind]/page.tsx");
  const rewarded = read("src/app/advertiser/miniapp-rewarded/page.tsx");
  const crop = read("src/components/advertiser/ImageCropDialog.tsx");
  assert.match(classic, /dynamic\(\(\) => import\("@\/components\/advertiser\/ImageCropDialog"\)/);
  assert.match(rewarded, /dynamic\(\(\) => import\("@\/components\/advertiser\/ImageCropDialog"\)/);
  assert.match(crop, /type="range"/);
  assert.match(crop, /MAX_BYTES/);
  assert.match(crop, /Landscape/);
});

test("all canonical FAQ records have explicit non-English Russian content", () => {
  const ru = JSON.parse(read("src/i18n/faqRu.json"));
  assert.equal(Object.keys(ru).length, 70);
  for (const value of Object.values(ru)) {
    assert.match(value.question, /[А-Яа-яЁё]/);
    assert.match(value.answer, /[А-Яа-яЁё]/);
  }
});

test("bot source has no embedded token and honors global retry_after", () => {
  const bot = read(process.env.ADSGALAXY_BOT_SOURCE || "/www/wwwroot/bots/adsFusionBot/bot.js");
  assert.match(bot, /process\.env\.BOT_TOKEN/);
  assert.doesNotMatch(bot, /[0-9]{8,}:[A-Za-z0-9_-]{20,}/);
  assert.match(bot, /response\.error_code === 429/);
  assert.match(bot, /response\.parameters\?\.retry_after/);
  assert.match(bot, /void attributeStartReferralWithRetry/);
});
