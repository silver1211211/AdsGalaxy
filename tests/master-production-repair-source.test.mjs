import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("publisher trust enforcement is review-only and cannot auto-ban", () => {
  const source = read("src/lib/publisherTrustEnforcement.ts");
  assert.match(source, /publisher_review_queue/);
  assert.match(source, /enforcement_mode: "review_only"/);
  assert.doesNotMatch(source, /UPDATE users SET status='banned'/);
  assert.doesNotMatch(source, /UPDATE channels SET status='paused'/);
});

test("fraud evidence uses stable incidents and bounded penalties", () => {
  const source = read("src/lib/channelFraudDetection.ts");
  assert.match(source, /channel_fraud_incidents/);
  assert.match(source, /times_seen=times_seen\+1/);
  assert.match(source, /MAX_TRUST_PENALTY_PER_EVALUATION = 10/);
  assert.match(source, /MAX_RISK_INCREASE_PER_EVALUATION = 15/);
  assert.match(source, /fraud_signal_manual_review/);
});

test("bot activation separates invalid credentials from temporary Telegram failures", () => {
  const lifecycle = read("src/lib/botLifecycle.ts");
  const route = read("src/app/api/admin/bots/[id]/actions/route.ts");
  assert.match(lifecycle, /BotActivationHealthError/);
  assert.match(lifecycle, /response\.status === 429/);
  assert.match(route, /publisher\.bot\.invalid-integration/);
  assert.match(route, /publicRuleNumber: 4/);
  assert.match(route, /TEMPORARILY_UNVERIFIED/);
});

test("channel approval classifies permanent and temporary Telegram outcomes", () => {
  const identity = read("src/lib/channelTelegramIdentity.ts");
  const bulk = read("src/app/api/admin/channels/bulk-approve/route.ts");
  assert.match(identity, /temporarily_rate_limited/);
  assert.match(identity, /missing_permission/);
  assert.match(bulk, /sharedCooldownUntil/);
  assert.match(bulk, /publisher\.channel\.inaccessible-channel/);
  assert.match(bulk, /publisher\.channel\.missing-permissions/);
  assert.match(bulk, /deferred/);
});

test("my_chat_member persists durable identity without deleting campaign history", () => {
  const webhook = read("src/app/api/webhook/telegram/route.ts");
  assert.match(webhook, /channel_telegram_identities/);
  assert.match(webhook, /my_chat_member/);
  assert.doesNotMatch(webhook, /UPDATE campaign_posts SET status = 'deleted'/);
});

test("publisher UI hides worker freshness diagnostics", () => {
  const page = read("src/app/publisher/monetize/page.tsx");
  const card = read("src/components/publisher/PublisherChannelAudienceCard.ts");
  assert.doesNotMatch(page, /Count may be stale|Refresh delayed/);
  assert.doesNotMatch(card, /Count may be stale|Refresh delayed|Refresh pending|Last successful refresh/);
});

test("Admin Check exposes unresolved badge and audited human decisions", () => {
  const layout = read("src/components/layout/AdminLayout.tsx");
  const route = read("src/app/api/admin/check/route.ts");
  assert.match(layout, /\/admin\/check/);
  assert.match(layout, /checkCount/);
  assert.match(route, /false_positive/);
  assert.match(route, /hold_settlement/);
  assert.match(route, /ban_publisher/);
  assert.match(route, /recordAutomationAudit/);
});

test("manual publisher reinstatement restores only automation-paused channels", () => {
  const route = read("src/app/api/admin/channels/[id]/actions/route.ts");
  const reinstate = route.slice(route.indexOf('action === "reinstate"'), route.indexOf('action === "exclude_settlement"'));
  assert.match(reinstate, /status='paused'/);
  assert.match(reinstate, /Low Trust Score with Withdrawable Balance Threshold Reached/);
  assert.match(reinstate, /fraudulent_or_low_quality_traffic/);
  assert.doesNotMatch(reinstate, /UPDATE channels SET status='active'.*WHERE user_id=\? AND is_deleted=FALSE"/s);
  assert.match(reinstate, /preserved_other_channel_states: true/);
});

test("all admin and pre-deletion public view refreshes use public API before MTProto", () => {
  const source = read("src/lib/channelAdminViewRefresh.ts");
  const publicCalls = [...source.matchAll(/fetched = await publicViews/g)].map((match) => match.index);
  const mtprotoFallbacks = [...source.matchAll(/const mtproto = await getPrivatePostViews\(`@/g)].map((match) => match.index);
  assert.equal(publicCalls.length, 2);
  assert.equal(mtprotoFallbacks.length, 2);
  assert.ok(publicCalls.every((position, index) => position < mtprotoFallbacks[index]));
  assert.match(source, /admin_mtproto_public_fallback/);
  assert.match(source, /pre_deletion_mtproto_public_fallback/);
});
