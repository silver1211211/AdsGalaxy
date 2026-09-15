import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTelegramInputs() {
  const output = ts.transpileModule(read("src/lib/telegramChannelInput.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL, Set });
  return module.exports;
}

test("public username normalization accepts supported formats and rejects invalid input", () => {
  const { normalizePublicChannelUsername } = loadTelegramInputs();
  for (const input of ["ExampleChannel", "@ExampleChannel", "https://t.me/ExampleChannel", "https://telegram.me/ExampleChannel"]) {
    assert.equal(normalizePublicChannelUsername(input), "ExampleChannel");
  }
  for (const input of ["https://evil.example/ExampleChannel", "t.me/ExampleChannel/extra", "bad name", "https://t.me/+invite"]) {
    assert.equal(normalizePublicChannelUsername(input), null);
  }
});

test("verified human-readable Telegram titles are not treated as usernames", () => {
  const { normalizeTelegramChannelTitle } = loadTelegramInputs();
  assert.equal(normalizeTelegramChannelTitle(" My Technology Channel "), "My Technology Channel");
  assert.equal(normalizeTelegramChannelTitle("Technology   News"), "Technology News");
  assert.equal(normalizeTelegramChannelTitle("x"), null);
  assert.equal(normalizeTelegramChannelTitle("x".repeat(129)), null);
});

test("registration uses Telegram canonical identity and preserves verification and duplicate protection", () => {
  const route = read("src/app/api/publisher/channels/route.ts");
  assert.match(route, /normalizedUsername = telegramUsername/);
  assert.match(route, /normalizeTelegramChannelTitle\(chatData\.result\?\.title\)/);
  assert.match(route, /telegram\(botToken, "getChatMember"/);
  assert.match(route, /hasRequiredAdminAccess/);
  assert.match(route, /PERMISSION_REQUIRED/);
  assert.match(route, /SELECT id, user_id, is_deleted FROM channels WHERE chat_id = \?/);
  assert.match(route, /CHANNEL_ALREADY_EXISTS/);
});

test("private identity, audience, category, and readable nested errors remain intact", () => {
  const route = read("src/app/api/publisher/channels/route.ts");
  const screen = read("src/components/publisher/AddChannelScreen.tsx");
  const errors = read("src/lib/apiErrorMessage.ts");
  assert.match(route, /inspectPrivateChannelVerificationToken/);
  assert.match(route, /normalizePrivateInviteLink/);
  assert.match(route, /normalizeChannelAudience\(audience_continents\)/);
  assert.match(route, /JSON\.stringify\(categories \|\| \[\]\)/);
  assert.match(screen, /selectedCategories\.length === 0/);
  assert.match(screen, /selectedContinents\.length === 0/);
  assert.match(errors, /typeof nested\.message === "string"/);
  assert.doesNotMatch(screen, /new Error\(data\.error \|\|/);
});

test("registration UI sends verified chat id, canonical username, title, category, and audience separately", () => {
  const screen = read("src/components/publisher/AddChannelScreen.tsx");
  assert.match(screen, /chat_id: isEdit \? channel\?\.chat_id : channelInfo\.id/);
  assert.match(screen, /username: isEdit \? channel\?\.username : channelInfo\.username/);
  assert.match(screen, /title: trimmedTitle/);
  assert.match(screen, /categories: selectedCategories/);
  assert.match(screen, /audience_continents: selectedContinents/);
  assert.match(screen, /encodeURIComponent\(username\)/);
});
