import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("private view reads require the assigned verified MTProto account", () => {
  const mtproto = read("src/lib/telegramMtproto.ts");
  const cron = read("src/app/api/cron/update-views/route.ts");
  const adminRefresh = read("src/lib/channelAdminViewRefresh.ts");

  assert.match(mtproto, /requirePreferredAccount\?: boolean/);
  assert.match(mtproto, /tracking_account_missing/);
  assert.match(mtproto, /options\.requirePreferredAccount && preferredKey[\s\S]*rotated\.filter\(\(account\) => account\.key === preferredKey\)/);
  assert.match(cron, /private_tracking_account_not_verified_member/);
  assert.match(cron, /requirePreferredAccount:\s*true/);
  assert.match(cron, /tracking_account_status\s*===\s*"active"/);
  assert.match(cron, /\["member",\s*"already_member"\]/);
  assert.match(adminRefresh, /requirePreferredAccount:\s*true/g);
  assert.match(adminRefresh, /tracking_account_status\s*!==\s*"active"/);
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

test("deployment installs one corrected identity sync schedule and the wrapper uses Node 24", () => {
  const deploy = read("deploy-vps.sh");
  const wrapper = read("scripts/sync-channel-identities.sh");
  const scheduleLines = deploy.match(/echo "[^"]*scripts\/sync-channel-identities\.sh[^"]*"/g) || [];

  assert.equal(scheduleLines.length, 1);
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
  assert.match(mtproto, /markMtprotoAccountFailure\(account\.key, error, code\)/);
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
