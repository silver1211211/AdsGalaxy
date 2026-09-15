import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const bot = read(process.env.ADSGALAXY_BOT_SOURCE || "/www/wwwroot/bots/adsFusionBot/bot.js");
const catalogEn = read("src/i18n/en.ts");
const catalogRu = read("src/i18n/ru.ts");
const provider = read("src/i18n/client.tsx");
const header = read("src/components/layout/Header.tsx");
const dashboard = read("src/components/layout/DashboardLayout.tsx");
const statusRoute = read("src/app/api/me/status/route.ts");
const languageRoute = read("src/app/api/me/language/route.ts");
const rootLayout = read("src/app/layout.tsx");
const loading = read("src/app/loading.tsx");
const internalLanguageRoute = read("src/app/api/internal/bot/language/route.ts");
const attribution = read("src/lib/referralAttribution.ts");
const sprint = read("src/lib/referralSprint.ts");
const localeHelper = read("src/lib/userLocale.ts");
const migration = read("db/migrations/20260904_0126_user_language_preference.sql");

test("persistent preference supports only en and ru with English database fallback", () => {
  assert.match(migration, /ENUM\('en','ru'\) NOT NULL DEFAULT 'en'/);
  assert.match(localeHelper, /return isLocale\(value\) \? value : DEFAULT_LOCALE/);
  assert.match(provider, /useState<Locale>\(resolvedInitialLocale\)/);
  assert.doesNotMatch(provider, /navigator\.language|language_code/);
  assert.match(provider, /PUBLIC_LOCALE_STORAGE_KEY/);
  assert.match(provider, /isDashboard/);
});

test("every start shows Russian then English selector before localized welcome", () => {
  assert.match(bot, /requestLanguagePayload\(ctx, \{ action: "selector" \}\)/);
  assert.ok(bot.indexOf("action: \"selector\"") < bot.indexOf("bot.callbackQuery"));
  assert.match(internalLanguageRoute, /buildBotLanguageSelector/);
  const localization = read("src/lib/botLocalization.ts");
  assert.ok(localization.indexOf('callback_data: "language:ru"') < localization.indexOf('callback_data: "language:en"'));
  assert.match(catalogRu, /"bot\.start\.message"/);
  assert.match(catalogEn, /"bot\.start\.message"/);
});

test("referral payload is processed before selector and attribution remains idempotent", () => {
  assert.ok(bot.indexOf("await attributeStartReferralWithRetry") < bot.indexOf('action: "selector"'));
  assert.match(attribution, /SELECT id, invited_by FROM referrals WHERE user_id = \? LIMIT 1 FOR UPDATE/);
  assert.match(attribution, /INSERT IGNORE INTO referrals/);
  assert.match(bot, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
});

test("bot language callbacks save validated locale and answer callback query", () => {
  assert.match(bot, /bot\.callbackQuery\(\/\^language:\(ru\|en\)\$\//);
  assert.match(bot, /action: "select", language/);
  assert.match(bot, /await ctx\.answerCallbackQuery/);
  assert.match(internalLanguageRoute, /!isLocale\(body\.language\)/);
  assert.match(internalLanguageRoute, /setUserLocale\(Number\(user\.id\), body\.language\)/);
});

test("referral notification locale belongs to the receiving referrer", () => {
  assert.match(localeHelper, /SELECT telegram_id, language FROM users WHERE id = \?/);
  assert.match(attribution, /sendLocalizedTelegramMessage\(\s*notify\.userId/);
  assert.match(sprint, /sendLocalizedTelegramMessage\(userId, key, values/);
  assert.doesNotMatch(attribution, /referred.*language/i);
  assert.match(catalogRu, /Новый реферал присоединился/);
  assert.match(catalogEn, /New Referral Joined/);
});

test("Mini App reads authenticated locale and switch persists without navigation", () => {
  assert.match(statusRoute, /const language = resolveUserLocale\(user\.language\)/);
  assert.match(dashboard, /initializeLocale\(data\.language\)/);
  assert.match(header, /apiFetch\("\/api\/me\/language"/);
  assert.match(header, /setLocale\(data\.language\)/);
  assert.doesNotMatch(header, /router\.(?:push|replace)|window\.location\.reload/);
  assert.match(rootLayout, /cookies\(\)[\s\S]*ag_locale[\s\S]*initialLocale=\{initialLocale\}/);
  assert.match(provider, /persistBrowserLocale\(resolvedLocale\)/);
  assert.match(languageRoute, /response\.cookies\.set\("ag_locale"/);
  assert.match(statusRoute, /response\.cookies\.set\("ag_locale"/);
  assert.match(loading, /<AppBootState \/>/);
});

test("Mini App language API rejects invalid and unauthenticated updates", () => {
  assert.match(languageRoute, /getAuthenticatedUserStatus/);
  assert.match(languageRoute, /!isLocale\(body\.language\)/);
  assert.match(languageRoute, /status: 400/);
  assert.match(languageRoute, /status: 401/);
  assert.doesNotMatch(languageRoute, /body\.(?:user_id|telegram_id)/);
});

test("shared Publisher and Advertiser header places dropdown in centered right half", () => {
  assert.match(dashboard, /<Header toggleSidebar=/);
  assert.match(header, /grid-cols-2/);
  assert.match(header, /justify-center/);
  assert.ok(header.indexOf('<option value="ru">') < header.indexOf('<option value="en">'));
  assert.match(header, /max-w-\[8\.75rem\]/);
});

test("direct Mini App waits for saved locale and safely falls back to English", () => {
  assert.match(dashboard, /type BootState = "ready" \| "banned"/);
  assert.doesNotMatch(dashboard, /type BootState = "loading"/);
  assert.match(dashboard, /localeInitializedAtMount\.current\) initializeLocale\("en"\)/);
  assert.match(dashboard, /useState<BootState>\("ready"\)/);
});
