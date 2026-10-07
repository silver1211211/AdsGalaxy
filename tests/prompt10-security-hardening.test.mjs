import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isProhibitedCallbackAddress, validateDirectCallbackUrl } from "../src/lib/directCallbackTransport.mjs";

const read = (path) => readFileSync(path, "utf8");
const adminAuth = read("src/lib/adminAuth.ts");
const adminLogin = read("src/app/api/admin/login/route.ts");
const loginProtection = read("src/lib/adminLoginProtection.ts");
const clientIp = read("src/lib/requestClientIp.ts");
const developerPlatform = read("src/lib/developerPlatform.ts");
const callbackTransport = read("src/lib/directCallbackTransport.mjs");
const publicSdkAuth = read("src/lib/publicSdkAuth.ts");
const legacyRequest = read("src/app/api/miniapp/mediation/request/route.ts");
const sdkRequest = read("src/app/api/sdk/miniapp/request/route.ts");
const firstPartyRoute = read("src/app/api/publisher/miniapps/route.ts");
const loginMigration = read("db/migrations/20260928_0151_admin_login_rate_limits.sql");

for (const role of ["super_admin", "operations_admin", "support_admin", "read_only_admin"]) {
  test(`recognized admin role ${role} remains canonical`, () => {
    assert.match(adminAuth, new RegExp(`normalized === "${role}"`));
    assert.match(adminAuth, new RegExp(`${role}: new Set`));
  });
}

for (const invalid of ["NULL", "empty", "unknown", "typo"]) {
  test(`${invalid} admin role fails closed`, () => {
    assert.match(adminAuth, /return null;/);
    assert.doesNotMatch(adminAuth, /String\(role \|\| "super_admin"\)/);
    assert.doesNotMatch(adminAuth, /COALESCE\(a\.role, 'super_admin'\)/);
  });
}

test("permission checks deny unsupported roles", () => {
  assert.match(adminAuth, /return role \? ROLE_PERMISSIONS\[role\]\.has\(permission\) : false/);
  assert.match(adminAuth, /if \(!role\) return null/);
});

test("login limiter checks before account lookup", () => {
  assert.ok(adminLogin.indexOf("inspectAdminLoginRateLimit") < adminLogin.indexOf("SELECT id, username"));
});

test("login limiter has independent account-IP and IP dimensions", () => {
  assert.match(loginProtection, /account-ip:/);
  assert.match(loginProtection, /security:admin-login:ip:/);
  assert.match(loginProtection, /Promise\.all/);
});

test("login thresholds are five per account-IP and twenty per IP in fifteen minutes", () => {
  assert.match(loginProtection, /ADMIN_LOGIN_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(loginProtection, /ADMIN_LOGIN_ACCOUNT_IP_MAX = 5/);
  assert.match(loginProtection, /ADMIN_LOGIN_IP_MAX = 20/);
});

test("unknown account and bad password share one generic response path", () => {
  assert.match(adminLogin, /admin\?\.password_hash \|\| INVALID_PASSWORD_HASH/);
  assert.match(adminLogin, /!admin \|\| !admin\.password_hash \|\| !passwordValid \|\| !role/);
  assert.equal((adminLogin.match(/Invalid credentials/g) || []).length, 1);
});

test("failed login records durable shared database counters", () => {
  assert.match(adminLogin, /recordAdminLoginFailure/);
  assert.match(loginProtection, /INSERT INTO admin_login_rate_limits/);
});

test("throttled login returns 429 and Retry-After", () => {
  assert.match(adminLogin, /status: 429/);
  assert.match(adminLogin, /"Retry-After"/);
});

test("successful login clears its account-IP state without erasing broader IP abuse history", () => {
  assert.match(adminLogin, /await clearAdminLoginFailures\(username, clientIp\)/);
  assert.match(loginProtection, /scope = 'account_ip' AND key_hash = \?/);
  assert.doesNotMatch(loginProtection, /scope = 'ip' AND key_hash = \?/);
});

test("login refuses to authenticate if Redis protection is unavailable", () => {
  assert.match(adminLogin, /if \(!initialLimit\.available\)/);
  assert.match(adminLogin, /status: 503/);
});

test("trusted IP helper does not use the attacker-controlled first XFF hop", () => {
  assert.match(clientIp, /forwarded\[forwarded\.length - 1\]/);
  assert.doesNotMatch(clientIp, /split\(","\)\[0\]/);
});

test("admin login limiter migration is additive, idempotent, and stores only hashed keys", () => {
  assert.match(loginMigration, /CREATE TABLE IF NOT EXISTS admin_login_rate_limits/);
  assert.match(loginMigration, /key_hash CHAR\(64\)/);
  assert.match(loginMigration, /PRIMARY KEY \(scope, key_hash\)/);
  assert.doesNotMatch(loginMigration, /\b(?:DROP|TRUNCATE|DELETE|ALTER)\b/i);
  assert.doesNotMatch(loginMigration, /username|ip_address/);
});

test("generic developer webhook registration uses canonical URL policy", () => {
  assert.match(developerPlatform, /validateDirectCallbackUrl\(clean\(value\)\)/);
});

test("all generic and direct deliveries use the pinned HTTPS dispatcher", () => {
  const worker = developerPlatform.slice(developerPlatform.indexOf("export async function processPendingWebhookDeliveries"), developerPlatform.indexOf("async function auditDeveloperWebhookAction"));
  assert.match(worker, /dispatchPinnedHttpsCallback/);
  assert.doesNotMatch(worker, /await fetch\(/);
});

test("unsafe webhook configuration is terminal rather than hot-retried", () => {
  assert.match(callbackTransport, /UNSAFE_CALLBACK_DESTINATION/);
  assert.match(developerPlatform, /unsafeDestination \|\| v2Terminal \|\| legacyTerminal/);
});

test("webhook connection pins validated DNS while preserving TLS host identity", () => {
  assert.match(callbackTransport, /lookup\(_hostname, _options, callback\)/);
  assert.match(callbackTransport, /callback\(null, selected\.address, selected\.family\)/);
  assert.match(callbackTransport, /servername: url\.hostname/);
  assert.match(callbackTransport, /rejectUnauthorized: true/);
});

test("webhook redirects are not followed", () => {
  assert.doesNotMatch(callbackTransport, /redirect:\s*["']follow/);
  assert.match(callbackTransport, /statusCode/);
});

for (const address of [
  "127.0.0.1", "10.4.3.2", "172.16.0.1", "172.31.255.254",
  "192.168.1.8", "169.254.169.254", "0.1.2.3",
]) {
  test(`webhook IPv4 policy rejects ${address}`, () => {
    assert.equal(isProhibitedCallbackAddress(address, 4), true);
  });
}

for (const address of ["::1", "fe80::1", "fc00::1", "fd12::1", "::ffff:10.0.0.1"]) {
  test(`webhook IPv6 policy rejects ${address}`, () => {
    assert.equal(isProhibitedCallbackAddress(address, 6), true);
  });
}

test("webhook URL policy rejects malformed and non-HTTPS destinations", () => {
  assert.throws(() => validateDirectCallbackUrl("not a url"));
  assert.throws(() => validateDirectCallbackUrl("http://example.com/hook"));
  assert.throws(() => validateDirectCallbackUrl("https://user:secret@example.com/hook"));
});

test("external Mini App tracking has no implicit first-party fallback", () => {
  const helper = publicSdkAuth.slice(publicSdkAuth.indexOf("export async function requireMiniappTrackingUser"), publicSdkAuth.indexOf("export function publicSdkErrorResponse"));
  assert.match(helper, /return requirePublicSdkUser/);
  assert.doesNotMatch(helper, /getAuthenticatedUser|catch/);
});

test("target Mini App bot identity is loaded server-side and verifies signed initData", () => {
  assert.match(publicSdkAuth, /SELECT id, telegram_bot_id, is_deleted FROM miniapps/);
  assert.match(publicSdkAuth, /verifyTelegramThirdPartyInitData\(initData, botId\)/);
});

test("body user identity cannot override signed Telegram identity", () => {
  assert.match(publicSdkAuth, /assertTelegramSdkUserMatches\(suppliedUserId \|\| "", verified\.telegramUserId\)/);
  assert.match(legacyRequest, /trackingUser\.telegramUserId/);
});

test("explicit first-party publisher route still calls first-party auth directly", () => {
  assert.match(firstPartyRoute, /getAuthenticatedUser/);
  assert.doesNotMatch(firstPartyRoute, /requireMiniappTrackingUser/);
});

test("legacy external mediation route retains target Mini App auth", () => {
  assert.match(legacyRequest, /requireMiniappTrackingUser\(request, miniappId, telegramUserId\)/);
});

test("invalid external auth cannot reserve a dedicated transaction connection", () => {
  assert.ok(legacyRequest.indexOf("requireMiniappTrackingUser") < legacyRequest.indexOf("conn = await pool.getConnection()"));
  assert.ok(legacyRequest.indexOf("SELECT id, status FROM miniapps") < legacyRequest.indexOf("conn = await pool.getConnection()"));
});

test("valid mediation transaction connection is released safely", () => {
  assert.match(legacyRequest, /finally \{[\s\S]*?conn\?\.release\(\)/);
});

for (const [name, source] of [["legacy", legacyRequest], ["SDK", sdkRequest]]) {
  test(`${name} per-user rate limit includes Mini App identity`, () => {
    assert.match(source, /WHERE miniapp_id = \? AND telegram_user_id = \?/);
    assert.match(source, /\[miniappId, (?:trackingUser\.telegramUserId|telegramUserId)\]/);
  });
}

test("legacy limiter uses verified identity rather than spoofable body identity", () => {
  assert.match(legacyRequest, /\[miniappId, trackingUser\.telegramUserId\]/);
});

test("Mini App A and B therefore have independent normal quotas for the same user", () => {
  for (const source of [legacyRequest, sdkRequest]) {
    assert.match(source, /miniapp_id = \? AND telegram_user_id = \?/);
    assert.doesNotMatch(source, /WHERE telegram_user_id = \? AND created_at/);
  }
});
