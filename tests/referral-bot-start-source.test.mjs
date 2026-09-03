import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const attribution = read("src/lib/referralAttribution.ts");
const route = read("src/app/api/internal/bot/referral/route.ts");
const auth = read("src/lib/auth.ts");
const sprint = read("src/lib/referralSprint.ts");
const promote = read("src/lib/promoteAdsGalaxy.ts");
const bot = read("/www/wwwroot/bots/adsFusionBot/bot.js");

test("new referral links use bot start deep links", () => {
  assert.doesNotMatch(sprint, /\?startapp=\$\{referralCode\}/);
  assert.match(sprint, /\?start=\$\{referralCode\}/);
  assert.doesNotMatch(promote, /\?startapp=\$\{link\.token\}/);
  assert.match(promote, /\?start=\$\{link\.token\}/);
});

test("bot start uses the authenticated localhost attribution endpoint before welcome", () => {
  assert.match(bot, /http:\/\/127\.0\.0\.1:3006\/api\/internal\/bot\/referral/);
  assert.match(bot, /"Authorization": `Bearer \$\{BOT_TOKEN\}`/);
  assert.match(bot, /const referralToken = String\(ctx\.match \|\| ""\)\.trim\(\)/);
  assert.ok(bot.indexOf("await attributeStartReferral") < bot.indexOf("await ctx.reply"));
  assert.match(bot, /Launch Ads Galaxy/);
  assert.match(bot, /webApp\(label, url\)/);
});

test("internal route uses timing-safe bot authentication and server attribution", () => {
  assert.match(route, /process\.env\.BOT_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /ensureTelegramUserForReferral/);
  assert.match(route, /attributeReferral/);
  assert.doesNotMatch(route, /startapp/);
});

test("shared attribution preserves self, duplicate, overwrite and fraud protections", () => {
  assert.match(attribution, /status: "self_referral"/);
  assert.match(attribution, /status: "invalid_token"/);
  assert.match(attribution, /status: "already_attributed_other"/);
  assert.match(attribution, /SELECT id, invited_by FROM referrals WHERE user_id = \? LIMIT 1 FOR UPDATE/);
  assert.match(attribution, /INSERT IGNORE INTO referrals/);
  assert.match(attribution, /blockReferralIfSelfDevice/);
  assert.match(attribution, /processReferralJoinReward/);
});

test("legacy Mini App attribution and bot attribution share one implementation", () => {
  assert.match(auth, /attributeReferral\(\{/);
  assert.match(auth, /token: tgUser\.start_param/);
  assert.match(auth, /token: telegramUser\.start_param/);
  assert.match(auth, /finalizeStoredReferralForUser/);
  assert.doesNotMatch(auth, /result\.insertId && tgUser\.start_param/);
  assert.match(auth, /newUserId && tgUser\.start_param/);
  assert.match(auth, /getAuthenticatedUserStatus\([\s\S]*?telegramUser\.start_param[\s\S]*?attributeReferral/);
  assert.doesNotMatch(auth, /INSERT IGNORE INTO referrals/);
});
