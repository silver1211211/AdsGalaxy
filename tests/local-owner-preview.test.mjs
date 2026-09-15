import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const localAuth = readFileSync(new URL("../src/lib/localMiniappDev.ts", import.meta.url), "utf8");
const apiClient = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const campaignsPage = readFileSync(new URL("../src/app/advertiser/campaigns/page.tsx", import.meta.url), "utf8");

test("owner preview resolves the existing account without profile or security writes", () => {
  assert.match(localAuth, /key:\s*"silver"/);
  assert.match(localAuth, /existing_username:\s*"Silver_Got_paid"/);
  assert.match(localAuth, /getRequestHostname\(options\.request\) === "preview\.adsgalaxy\.online"[\s\S]*getLocalMiniappDevUser\("silver"\)/);
  assert.match(localAuth, /if \(tgUser\.existing_username\)[\s\S]*SELECT \* FROM users WHERE username = \? LIMIT 1[\s\S]*return existingUser;/);

  const readOnlyBranch = localAuth.match(/if \(tgUser\.existing_username\) \{[\s\S]*?return existingUser;\n  \}/)?.[0] || "";
  assert.doesNotMatch(readOnlyBranch, /INSERT|UPDATE|processReferralJoinReward|updateUserReferralSecuritySignals/);
});

test("owner preview blocks mutating API methods at the server boundary", () => {
  assert.match(proxy, /payload\.user === "silver"/);
  assert.match(proxy, /requestHostname\(request\) === "preview\.adsgalaxy\.online"/);
  assert.match(proxy, /!\["GET", "HEAD", "OPTIONS"\]\.includes\(request\.method\.toUpperCase\(\)\)/);
  assert.match(proxy, /Preview account is read-only/);
});

test("direct preview URLs replace stale fake-user tokens with the owner identity", () => {
  assert.match(apiClient, /window\.location\.hostname\.toLowerCase\(\) === "preview\.adsgalaxy\.online"/);
  assert.match(apiClient, /user:\s*isOwnerPreview \? "silver"/);
  assert.match(auth, /getLocalMiniappDevAuthenticatedUser\(initData![\s\S]*request:\s*options\.request/);
  assert.match(proxy, /requestHeaders\.set\("x-telegram-init-data", buildOwnerPreviewInitData\(\)\)/);
});

test("campaign page uses the restored unfiltered campaign list", () => {
  assert.match(campaignsPage, /campaigns\.map\(\(campaign\) =>/);
  assert.doesNotMatch(campaignsPage, /Search campaigns|All statuses|All types|visibleCampaigns|statusFilter|typeFilter/);
});
