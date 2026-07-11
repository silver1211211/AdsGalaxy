import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/publisher/channels/route.ts", "utf8");

test("existing channel reactivation restores a non-null healthy baseline while remaining pending", () => {
  assert.match(route, /"status = 'pending'"/);
  assert.match(route, /"health_status = 'healthy'"/);
  assert.doesNotMatch(route, /"health_status = NULL"/);
  assert.match(route, /"paused_reason = NULL"/);
  assert.match(route, /"suggested_fix = NULL"/);
  assert.match(route, /"failure_reason = NULL"/);
  assert.match(route, /"auto_paused_at = NULL"/);
});

test("reactivation preserves the existing public and private channel field handling", () => {
  const reactivation = route.slice(
    route.indexOf("// If it belongs to same user and IS deleted"),
    route.indexOf("// 4. Insert new channel")
  );
  assert.match(route, /if \(privacySchema\.hasChannelType\)[\s\S]*updateColumns\.push\("channel_type = \?"\)/);
  assert.match(route, /if \(privacySchema\.hasInviteLinkHash\)[\s\S]*updateColumns\.push\("invite_link_hash = \?"\)/);
  assert.match(route, /if \(privacySchema\.hasPrivateInviteLinkEncrypted\)[\s\S]*updateColumns\.push\("private_invite_link_encrypted = \?"\)/);
  assert.doesNotMatch(reactivation, /advertiser_debit|publisher_credit|settlement|billing/);
});
