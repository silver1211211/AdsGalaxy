import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addReferralDecimals, getPaidReferralEarnings } from "../src/lib/paidReferralEarnings.ts";
import { publisherChannelError } from "../src/lib/publisherChannelErrors.ts";
import { PublisherChannelAudienceCard } from "../src/components/publisher/PublisherChannelAudienceCard.ts";

test("immutable paid referral helper uses ledger status and fixed decimal arithmetic", async () => {
  let captured = "";
  const value = await getPaidReferralEarnings({ query: async (sql) => { captured = sql; return [[{ paid_referral_earnings: "5.37000000" }]]; } }, 78930);
  assert.equal(value, "5.37000000");
  assert.match(captured, /referral_reward_ledger/);
  assert.match(captured, /status = 'paid'/);
  assert.equal(addReferralDecimals("1.10000001", "2.20000002"), "3.30000003");
});

test("publisher channel public failures never expose exception content", async () => {
  const secret = "SQL syntax Telegram session AQAB private invite https://t.me/+secret";
  const response = publisherChannelError("CHANNEL_CREATE_FAILED", 500);
  assert.equal(response.status, 500);
  const body = JSON.stringify(await response.json());
  assert.match(body, /CHANNEL_CREATE_FAILED/);
  assert.doesNotMatch(body, new RegExp(secret));
  assert.doesNotMatch(body, /SQL syntax|AQAB|t\.me\/\+/);
  for (const file of ["src/app/api/publisher/channels/route.ts", "src/app/api/publisher/channels/[id]/route.ts", "src/app/api/publisher/channels/[id]/analytics/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /error\.message\s*\|\|\s*["']Failed/);
  }
});

test("publisher GET select omits tracking-account internals", () => {
  const source = readFileSync("src/app/api/publisher/channels/route.ts", "utf8");
  const end = source.indexOf("FROM channels c");
  const select = source.slice(source.lastIndexOf("`SELECT", end), end);
  assert.doesNotMatch(select, /tracking_account|private_invite|access_hash|session/i);
});

const render = (channel: Record<string, unknown>) => renderToStaticMarkup(React.createElement(PublisherChannelAudienceCard, { channel, now: new Date("2026-08-02T12:00:00Z") }));
test("actual publisher audience card renders terminology and all refresh states without private fields", () => {
  assert.match(render({ channel_type: "public", subscriber_count: 100 }), /Subscribers/);
  assert.match(render({ channel_type: "private", subscriber_count: 100 }), /Members/);
  assert.match(render({ channel_type: null, subscriber_count: 100 }), /Audience/);
  assert.match(render({}), /Refresh pending/);
  assert.match(render({ subscribers_last_success_at: "2026-08-01T00:00:00Z" }), /Refresh delayed/);
  assert.match(render({ subscribers_last_success_at: "2026-07-29T00:00:00Z" }), /Count may be stale/);
  assert.match(render({ below_minimum_since: "2026-08-01T00:00:00Z" }), /grace period ends/);
  assert.match(render({ monetization_paused_reason: "below_minimum", below_minimum_review_required: 1 }), /paused[\s\S]*Seven-day/);
  assert.match(render({ status: "paused", monetization_paused_reason: "below_minimum" }), /restoration is withheld/);
  assert.match(render({ monetization_auto_restored_at: "2026-08-02T10:00:00Z" }), /restored automatically/);
  const html = render({ channel_type: "private", tracking_account: "secret", private_invite_link: "https://t.me/+secret", session: "AQAB" });
  assert.doesNotMatch(html, /tracking_account|t\.me|AQAB/);
});

test("financial/security cache readers are removed", () => {
  assert.doesNotMatch(readFileSync("src/app/api/admin/withdrawals/route.ts", "utf8"), /COALESCE\(u\.total_referral_earnings/);
  assert.doesNotMatch(readFileSync("src/lib/revenueProtection.ts", "utf8"), /total_referral_earnings/);
});

test("subscriber scheduler supplies publisher identity for transactional transition audits", () => {
  const source = readFileSync("src/app/api/cron/update-subscribers/route.ts", "utf8");
  assert.match(source, /SELECT c\.id,c\.user_id,c\.chat_id/);
});
