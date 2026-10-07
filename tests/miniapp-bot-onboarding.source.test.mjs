import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const identity = read("src/lib/telegramBotIdentity.ts");
const mtproto = read("src/lib/telegramMtproto.ts");
const miniapps = read("src/app/api/publisher/miniapps/route.ts");
const miniappPatch = read("src/app/api/publisher/miniapps/[id]/route.ts");
const bots = read("src/app/api/publisher/bots/route.ts");
const verifyBot = read("src/app/api/telegram/verify-bot/route.ts");
const verifyUrl = read("src/app/api/verify-url/route.ts");
const validation = read("src/lib/miniappSubmissionValidation.ts");
const page = read("src/app/publisher/monetize/page.tsx");

test("canonical resolver uses MTProto identity lookup and preserves string IDs", () => {
  assert.match(mtproto, /"identity_lookup"/);
  assert.match(mtproto, /resolvePublicBotIdentity/);
  assert.match(mtproto, /candidate\.bot !== true/);
  assert.match(mtproto, /const id = String\(candidate\.id/);
  assert.match(mtproto, /runMtprotoAccountRequest\(account\.key, "identity_lookup"/);
  assert.match(identity, /BOT_ID_MISMATCH/);
  assert.match(identity, /TELEGRAM_RATE_LIMITED/);
  assert.match(identity, /TELEGRAM_TEMPORARILY_UNAVAILABLE/);
  assert.doesNotMatch(verifyBot, /BOT_TOKEN/);
  assert.doesNotMatch(verifyBot, /getChat/);
});

test("Mini App write boundary verifies Telegram identity and keeps matching IDs canonical", () => {
  assert.match(validation, /if \(botId !== telegramBotId\)/);
  for (const source of [miniapps, miniappPatch]) {
    assert.match(source, /authenticatePublisherAsset\(request\)/);
    assert.match(source, /verifyPublicBotIdentity/);
    assert.match(source, /BOT_ID_MISMATCH/);
    assert.match(source, /input\.bot_id = identity\.id/);
    assert.match(source, /input\.telegram_bot_id = identity\.id/);
  }
  assert.match(miniapps, /beginTransaction/);
  assert.match(miniapps, /FOR UPDATE/);
  assert.match(miniapps, /already_registered: idempotent/);
  assert.match(miniapps, /after\(async/);
});

test("publisher Bot onboarding validates only publisher token and persists integration atomically", () => {
  assert.match(bots, /verifyPublisherBotToken/);
  assert.match(bots, /beginTransaction/);
  assert.match(bots, /ensureBotIntegration\(connection/);
  assert.match(bots, /await connection\.commit/);
  assert.match(bots, /already_registered: idempotent/);
  const token = read("src/lib/publisherBotToken.ts");
  assert.match(token, /cache: "no-store"/);
  assert.match(token, /AbortSignal\.timeout\(8_000\)/);
  assert.match(token, /INVALID_BOT_TOKEN/);
  assert.match(token, /TELEGRAM_RATE_LIMITED/);
  assert.match(token, /TELEGRAM_TEMPORARILY_UNAVAILABLE/);
  assert.doesNotMatch(bots, /console\.error\([^\n]*bot_token/);
});

test("web URL verification is session-aware, redirect-bounded and SSRF guarded", () => {
  assert.match(verifyUrl, /authenticatePublisherAsset\(request\)/);
  assert.match(verifyUrl, /MAX_REDIRECTS = 3/);
  assert.match(verifyUrl, /assertPublicDns\(current\.hostname\)/);
  assert.match(verifyUrl, /redirect: "manual"/);
  assert.match(verifyUrl, /response\.status === 405/);
  assert.match(verifyUrl, /Range: "bytes=0-0"/);
  assert.match(verifyUrl, /URL_TEMPORARILY_UNAVAILABLE/);
  assert.match(page, /bot_id=\$\{encodeURIComponent\(maBotId\.trim\(\)\)\}/);
  assert.match(page, /botVerify\.status === "ok"/);
  assert.doesNotMatch(page, /botVerify\.status === "ok" \|\| botVerify\.status === "error"/);
  assert.match(page, /Telegram Mini App link format is valid/);
});
