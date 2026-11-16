import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
function load(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === "node:crypto" || specifier === "crypto") return crypto;
    return require(specifier);
  };
  const fn = new Function("require", "module", "exports", output);
  fn(customRequire, mod, mod.exports);
  return mod.exports;
}

const previewAuth = load("src/lib/previewAuth.ts");
const {
  PREVIEW_COOKIE_NAME,
  PREVIEW_HOSTNAME,
  verifyPreviewPassword,
  createPreviewSessionToken,
  verifyPreviewSessionToken,
  checkPreviewRateLimit,
  recordPreviewFailedAttempt,
  resetPreviewRateLimit,
  clearAllPreviewRateLimits,
  getClientIp,
  getPreviewSessionDurationSeconds,
} = previewAuth;

test("1. previewAuth: password verification rejects empty, wrong, and missing config", async (t) => {
  const origPass = process.env.PREVIEW_ACCESS_PASSWORD;
  const origAlias = process.env.PREVIEW_PASSWORD;

  try {
    delete process.env.PREVIEW_ACCESS_PASSWORD;
    delete process.env.PREVIEW_PASSWORD;

    assert.equal(verifyPreviewPassword("any_password"), false, "Fails safe when no password configured");

    process.env.PREVIEW_ACCESS_PASSWORD = "CorrectPreviewPassword2026!";

    assert.equal(verifyPreviewPassword(""), false, "Rejects empty password");
    assert.equal(verifyPreviewPassword("   "), false, "Rejects whitespace-only password");
    assert.equal(verifyPreviewPassword("wrong_password"), false, "Rejects incorrect password");
    assert.equal(verifyPreviewPassword("CorrectPreviewPassword2026!"), true, "Accepts exact password");
    assert.equal(verifyPreviewPassword(" CorrectPreviewPassword2026! "), true, "Accepts trimmed password");

    // Test alias PREVIEW_PASSWORD
    delete process.env.PREVIEW_ACCESS_PASSWORD;
    process.env.PREVIEW_PASSWORD = "AliasSecretPassword#99";
    assert.equal(verifyPreviewPassword("AliasSecretPassword#99"), true, "Accepts password from PREVIEW_PASSWORD alias");
    assert.equal(verifyPreviewPassword("wrong"), false, "Rejects wrong password under alias");
  } finally {
    if (origPass) process.env.PREVIEW_ACCESS_PASSWORD = origPass;
    else delete process.env.PREVIEW_ACCESS_PASSWORD;
    if (origAlias) process.env.PREVIEW_PASSWORD = origAlias;
    else delete process.env.PREVIEW_PASSWORD;
  }
});

test("2. previewAuth: session token creation and verification", async (t) => {
  process.env.PREVIEW_ACCESS_PASSWORD = "TestSecretPassword123";
  process.env.PREVIEW_SESSION_SECRET = "super-secret-hmac-key-for-test";

  const token = createPreviewSessionToken();
  assert.ok(token, "Token generated");
  assert.equal(token.includes("."), true, "Token has payload.sig format");

  const isValid = verifyPreviewSessionToken(token);
  assert.equal(isValid, true, "Fresh token verifies successfully");

  // Tampered payload
  const [payload, sig] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ v: 1, iat: 100, exp: 9999999999, nonce: "fake" })).toString("base64url");
  assert.equal(verifyPreviewSessionToken(`${tamperedPayload}.${sig}`), false, "Tampered payload fails verification");

  // Tampered signature
  const fakeSig = Buffer.from("invalidsignaturehere1234567890123456").toString("base64url");
  assert.equal(verifyPreviewSessionToken(`${payload}.${fakeSig}`), false, "Tampered signature fails verification");

  // Malformed tokens
  assert.equal(verifyPreviewSessionToken(""), false);
  assert.equal(verifyPreviewSessionToken("nodotstoken"), false);
  assert.equal(verifyPreviewSessionToken("one.two.three"), false);
  assert.equal(verifyPreviewSessionToken(null), false);
  assert.equal(verifyPreviewSessionToken(undefined), false);

  // Expired token (create with negative duration)
  const expiredToken = createPreviewSessionToken(-10);
  assert.equal(verifyPreviewSessionToken(expiredToken), false, "Expired token fails verification");
});

test("3. previewAuth: rate limiting per IP with lockout and reset", async (t) => {
  clearAllPreviewRateLimits();
  const testIp = "192.168.1.100";
  const otherIp = "192.168.1.200";

  let status = checkPreviewRateLimit(testIp);
  assert.equal(status.allowed, true);
  assert.equal(status.remainingAttempts, 5);

  // Record 4 failed attempts
  for (let i = 1; i <= 4; i++) {
    recordPreviewFailedAttempt(testIp);
    status = checkPreviewRateLimit(testIp);
    assert.equal(status.allowed, true);
    assert.equal(status.remainingAttempts, 5 - i);
  }

  // 5th failed attempt should trigger lockout
  recordPreviewFailedAttempt(testIp);
  status = checkPreviewRateLimit(testIp);
  assert.equal(status.allowed, false, "5th failed attempt locks out IP");
  assert.equal(status.remainingAttempts, 0);
  assert.ok(status.retryAfterSeconds > 0, "Provides retryAfterSeconds");

  // Other IP is unaffected
  const otherStatus = checkPreviewRateLimit(otherIp);
  assert.equal(otherStatus.allowed, true, "Different IP is not blocked");
  assert.equal(otherStatus.remainingAttempts, 5);

  // Reset clears lockout for testIp
  resetPreviewRateLimit(testIp);
  status = checkPreviewRateLimit(testIp);
  assert.equal(status.allowed, true, "Reset unblocks IP");
  assert.equal(status.remainingAttempts, 5);
});

test("4. previewAuth: client IP extraction handles proxies and direct connections", () => {
  // Mock request with x-forwarded-for
  const req1 = {
    headers: {
      get: (h) => {
        if (h === "x-forwarded-for") return "203.0.113.195, 70.41.3.18";
        if (h === "x-real-ip") return "70.41.3.18";
        return null;
      },
    },
  };
  assert.equal(getClientIp(req1), "203.0.113.195", "Extracts first client IP from x-forwarded-for list");

  // Mock request with only x-real-ip
  const req2 = {
    headers: {
      get: (h) => {
        if (h === "x-real-ip") return "198.51.100.42";
        return null;
      },
    },
  };
  assert.equal(getClientIp(req2), "198.51.100.42", "Extracts IP from x-real-ip when x-forwarded-for absent");

  // Plain object headers
  const req3 = {
    headers: {
      "x-forwarded-for": "192.0.2.1",
    },
  };
  assert.equal(getClientIp(req3), "192.0.2.1", "Handles plain object headers");

  // Empty headers fallback
  const req4 = { headers: {} };
  assert.equal(getClientIp(req4), "127.0.0.1", "Falls back to 127.0.0.1");
});

test("5. previewAuth: cookie name, hostname, and configurable session duration", () => {
  assert.equal(PREVIEW_COOKIE_NAME, "adsgalaxy_preview_session");
  assert.equal(PREVIEW_HOSTNAME, "preview.adsgalaxy.online");
  assert.equal(getPreviewSessionDurationSeconds(), 7 * 24 * 60 * 60, "Default 7 days (604800s)");

  const origDays = process.env.PREVIEW_SESSION_DURATION_DAYS;
  try {
    process.env.PREVIEW_SESSION_DURATION_DAYS = "14";
    assert.equal(getPreviewSessionDurationSeconds(), 14 * 24 * 60 * 60, "Configurable via PREVIEW_SESSION_DURATION_DAYS");
  } finally {
    if (origDays) process.env.PREVIEW_SESSION_DURATION_DAYS = origDays;
    else delete process.env.PREVIEW_SESSION_DURATION_DAYS;
  }
});
