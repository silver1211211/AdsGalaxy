import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test('temporary MTProto rate limits preserve the existing tracking status', () => {
  const cron = read('src/app/api/cron/update-views/route.ts');
  const start = cron.indexOf(`if (result.code === 'rate_limited' &&`);
  const branch = cron.slice(start, cron.indexOf('console.error', start));

  assert.notEqual(start, -1);
  assert.match(branch, /tracking_account_failure_reason = 'rate_limited'/);
  assert.doesNotMatch(branch.split('else if')[0], /tracking_account_status = 'failed'/);
});
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("private view reads prove access with the read itself and never preflight GetFullChannel", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");
  const cron = read("src/app/api/cron/update-views/route.ts");
  const adminRefresh = read("src/lib/channelAdminViewRefresh.ts");

  assert.doesNotMatch(mtproto, /verifiedPrivateMemberAccounts/);
  const viewPath = mtproto.slice(mtproto.indexOf("export async function getPrivatePostViews"));
  assert.doesNotMatch(viewPath, /Api\.channels\.GetFullChannel/);
  assert.match(viewPath, /runMtprotoViewAttempts/);
  assert.match(mtproto, /Api\.messages\.GetMessagesViews/);
  assert.match(mtproto, /increment:\s*false/);
  assert.match(mtproto, /no_verified_private_member/);
  assert.match(mtproto, /orderMtprotoViewAccounts/);
  assert.match(cron, /verifyPrivateMembership:\s*true/);
  assert.match(cron, /preferredAccount:\s*Number\(post\.tracking_account\) \|\| null/);
  assert.match(cron, /verified_accounts/);
  assert.match(adminRefresh, /verifyPrivateMembership:\s*true/g);
  assert.doesNotMatch(adminRefresh, /private_tracking_account_not_verified_member/);
});

test("private membership onboarding canonicalizes already_member as member", () => {
  const onboarding = read("src/lib/privateChannelTrackingOnboarding.ts");
  const monitor = read("src/lib/channelHealthMonitor.ts");

  assert.match(onboarding, /memberStatus === "member" \|\| memberStatus === "already_member" \? "member"/);
  assert.match(monitor, /!\["member",\s*"already_member"\]\.includes/);
  assert.match(monitor, /Assigned MTProto tracking account membership is not verified/);
});

test("every private activation path onboards before setting active", () => {
  const sources = [
    "src/app/api/admin/channels/route.ts",
    "src/app/api/admin/channels/[id]/actions/route.ts",
    "src/app/api/admin/channels/bulk-approve/route.ts",
    "src/lib/channelLifecycle.ts",
  ].map((file) => ({ file, source: read(file) }));

  for (const { file, source } of sources) {
    const onboarding = source.indexOf("onboardPrivateChannelTracking({");
    const activation = source.indexOf("UPDATE channels", onboarding);
    assert.notEqual(onboarding, -1, `${file} must onboard private tracking`);
    assert.notEqual(activation, -1, `${file} must contain activation after onboarding`);
    assert.ok(onboarding < activation, `${file} must verify MTProto membership before activation`);
    assert.match(source, /channel_type === "private" && tracking\.status !== "active"|channelType === "private" && tracking\.status !== "active"/);
  }
});

test("deployment installs recurring sync plus one daily repair schedule and the wrapper uses Node 24", () => {
  const deploy = read("deploy-vps.sh");
  const wrapper = read("scripts/sync-channel-identities.sh");
  const scheduleLines = deploy.match(/echo "[^"]*scripts\/sync-channel-identities\.sh[^"]*"/g) || [];

  assert.equal(scheduleLines.length, 2);
  assert.equal(scheduleLines.filter((line) => line.includes("CHANNEL_IDENTITY_REPAIR_ONLY=1")).length, 1);
  assert.match(deploy, /grep -v 'scripts\/sync-channel-identities\\\.sh'/);
  assert.match(wrapper, /\/root\/\.nvm\/versions\/node\/v24\.15\.0\/bin\/node scripts\/sync-channel-identities\.mjs/);
  assert.match(wrapper, /nice -n 15/);
});

test("private onboarding balances configured MTProto accounts and serializes assignments", () => {
  const onboarding = read("src/lib/privateChannelTrackingOnboarding.ts");

  assert.doesNotMatch(onboarding, /account 2 only/i);
  assert.doesNotMatch(onboarding, /return \(\[2\]/);
  assert.match(onboarding, /GET_LOCK/);
  assert.match(onboarding, /RELEASE_LOCK/);
  assert.match(onboarding, /active_count/);
  assert.match(onboarding, /assigned_count/);
  assert.match(onboarding, /leftLoad\.active - rightLoad\.active/);
  assert.match(onboarding, /reserveTrackingAccount/);
  assert.match(onboarding, /getExistingTrackingAssignment/);
  assert.match(onboarding, /getMtprotoAccountAvailability/);
});

test("MTProto join path quarantines reauth failures and observes flood cooldown", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");

  assert.match(mtproto, /unhealthyAccountCodes/);
  assert.match(mtproto, /accountCooldownUntil/);
  assert.match(mtproto, /parseFloodWait\(error\)/);
  assert.match(mtproto, /getMtprotoAccountAvailability/);
  assert.match(mtproto, /markMtprotoAccountFailure\(account\.key, error, "membership", code\)/);
});

test("MTProto clients hydrate each account entity cache before private channel reads", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");

  assert.match(mtproto, /await client\.checkAuthorization\(\)/);
  assert.match(mtproto, /await client\.getDialogs\(\{ limit: 500 \}\)/);
  assert.ok(
    mtproto.indexOf("await client.checkAuthorization()") < mtproto.indexOf("await client.getDialogs({ limit: 500 })"),
    "authorization must be checked before entity-cache hydration"
  );
  assert.match(mtproto, /const clientPromises: Partial<Record<MtprotoAccountKey, Promise<TelegramClient>>>/);
});

test("MTProto failures retain safe actionable classifications", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");

  for (const code of [
    "peer_entity_unavailable",
    "not_channel_member",
    "session_unauthorized",
    "account_deactivated",
    "network_error",
    "telegram_rpc_error",
  ]) {
    assert.ok(mtproto.includes(`\"${code}\"`), `missing safe classification ${code}`);
  }
});

test("advertiser locked balance excludes direct-debit campaign caps", () => {
  const auth = read("src/lib/auth.ts");

  assert.match(auth, /SUM\(CASE WHEN c\.funding_model = 'direct_debit' THEN 0 ELSE c\.budget END\)/);
});

test("private and public channel view tracking retain isolated paths and failover", () => {
  const cron = read("src/app/api/cron/update-views/route.ts");
  const mtproto = read("src/lib/telegramMtproto.ts");

  assert.match(cron, /post\.channel_type === "private"/);
  assert.match(cron, /verifyPrivateMembership:\s*true/);
  assert.match(cron, /let result: PublicViewResult/);
  assert.match(cron, /normalizePublicViewResult/);
  assert.match(cron, /source = "public_api"/);
  assert.ok(cron.indexOf("await fetchPublicViews(username, post.message_id)") < cron.indexOf("await getPrivatePostViews(peer, post.message_id"));
  assert.match(mtproto, /runMtprotoViewAttempts/);
  assert.match(mtproto, /mtprotoAccountAvailability\(accountKey, "view_read"\)/);
  assert.match(mtproto, /orderMtprotoViewAccounts/);
});

test("membership and view-read FloodWait cooldowns are operation scoped", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");

  assert.match(mtproto, /new Map<MtprotoAccountKey, number>\(\)/);
  assert.match(mtproto, /accountCooldownUntil\.set\(account/);
  assert.match(mtproto, /createMtprotoAccountScheduler/);
  assert.doesNotMatch(mtproto, /accountCooldownUntil\[operation\]/);
});

test("view refresh reports real MTProto requests and public fallback separately", () => {
  const cron = read("src/app/api/cron/update-views/route.ts");

  for (const counter of [
    "mtproto_calls",
    "mtproto_requests_attempted",
    "mtproto_successes",
    "mtproto_actual_failures",
    "mtproto_accounts_skipped_cooldown",
    "public_fallback_attempts",
    "public_fallback_successes",
  ]) {
    assert.ok(cron.includes(counter), `missing refresh counter ${counter}`);
  }
  assert.match(cron, /stats\.mtprotoActualFailures \+= mtproto\.actualFailures/);
  assert.match(cron, /stats\.mtprotoAccountsSkippedCooldown \+= mtproto\.cooldownAccounts\.length/);
  assert.match(cron, /stats\.mtprotoErrors \+= result\.actualFailures/);
  assert.match(cron, /stats\.mtprotoErrors \+= mtproto\.actualFailures/);
  assert.doesNotMatch(cron, /stats\.mtprotoErrors \+= 1/);
});

test("public fallback retries transient failures with bounded jitter but not post-not-found", () => {
  const cron = read("src/app/api/cron/update-views/route.ts");
  const policy = read("src/lib/channelViewPipeline.ts");
  const fallback = cron.slice(cron.indexOf("async function fetchPublicViews"), cron.indexOf("async function refreshPublicUsername"));

  assert.match(cron, /750 \+ Math\.floor/);
  assert.match(policy, /genuine_post_not_found/);
  assert.match(policy, /shouldRetryPublicImmediately/);
  assert.doesNotMatch(policy.slice(policy.indexOf("shouldRetryPublicImmediately"), policy.indexOf("shouldFallbackPublicToMtproto")), /genuine_post_not_found/);
  assert.match(fallback, /await delay\(publicFallbackRetryDelayMs\(\)\)/);
  assert.match(fallback, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
});

test("a public fallback success reaches the single common debit path", () => {
  const cron = read("src/app/api/cron/update-views/route.ts");
  const debitCalls = cron.match(/debitConfirmedChannelViews\(Number\(post\.id\), monotonicViews\)/g) || [];

  assert.equal(debitCalls.length, 1);
  assert.match(cron, /source = "public_api"/);
  assert.match(cron, /stats\.publicFallbackSuccesses \+= 1/);
});

test("visible Teaser analytics labels do not use the obsolete Teza spelling", () => {
  const files = [
    "src/app/admin/teaser-analytics/page.tsx",
    "src/app/api/admin/teaser-analytics/route.ts",
    "src/components/publisher/ChannelAnalyticsDashboard.tsx",
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /\bTeza\b/i, `${file} must use Teaser, not Teza`);
  }
});
