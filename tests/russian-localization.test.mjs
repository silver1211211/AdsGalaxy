import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

/* eslint-disable @next/next/no-assign-module-variable -- CommonJS shim used only by this source-level test */

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTs(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = fs.readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: absolutePath,
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith("./")) {
      const resolved = path.join(path.dirname(relativePath), specifier).replaceAll("\\", "/");
      return loadTs(`${resolved.replace(/\.tsx?$/, "")}.ts`);
    }
    return nativeRequire(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

const en = loadTs("src/i18n/en.ts").default;
const ru = loadTs("src/i18n/ru.ts").default;
const i18n = loadTs("src/i18n/index.ts");
const apiErrors = loadTs("src/i18n/apiErrors.ts");
const legacyRu = loadTs("src/i18n/legacyRu.ts").default;

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

test("Russian and English are public while English remains the default", () => {
  assert.deepEqual(i18n.SUPPORTED_LOCALES, ["en", "ru"]);
  assert.equal(i18n.DEFAULT_LOCALE, "en");
  assert.deepEqual(i18n.PUBLIC_LOCALES, ["ru", "en"]);
  assert.equal(i18n.translate("common.dashboard"), "Dashboard");
  assert.equal(i18n.translate("common.dashboard", {}, "ru"), "Панель управления");
});

test("English and Russian catalogs have exact, non-blank key parity and placeholder parity", () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ru[key], "string", `${key} must exist in Russian`);
    assert.notEqual(ru[key].trim(), "", `${key} must not be blank in Russian`);
    assert.deepEqual(placeholders(ru[key]), placeholders(en[key]), `${key} placeholders must match`);
  }
});

test("interpolation is safe and preserves unresolved placeholders", () => {
  assert.equal(i18n.translate("miniapp.reward.earned", { amount: "1.25" }, "ru"), "Вы заработали 1.25 USDT.");
  assert.equal(i18n.translate("validation.minimumAmount", {}, "ru"), "Минимальная сумма — {minimum} USDT.");
});

test("Russian plural rules handle 1, 2, 5, 21, 22 and 25", () => {
  assert.equal(i18n.translatePlural("impressions", 1, {}, "ru"), "1 показ");
  assert.equal(i18n.translatePlural("impressions", 2, {}, "ru"), "2 показа");
  assert.equal(i18n.translatePlural("impressions", 5, {}, "ru"), "5 показов");
  assert.equal(i18n.translatePlural("impressions", 21, {}, "ru"), "21 показ");
  assert.equal(i18n.translatePlural("impressions", 22, {}, "ru"), "22 показа");
  assert.equal(i18n.translatePlural("impressions", 25, {}, "ru"), "25 показов");
  assert.equal(i18n.translatePlural("clicks", 1, {}, "ru"), "1 клик");
  assert.equal(i18n.translatePlural("clicks", 2, {}, "ru"), "2 клика");
  assert.equal(i18n.translatePlural("clicks", 5, {}, "ru"), "5 кликов");
});

test("canonical statuses and metrics translate without changing their internal values", () => {
  assert.equal(i18n.translateStatus("active", "ru"), "Активно");
  assert.equal(i18n.translateStatus("processing", "ru"), "Обрабатывается");
  assert.equal(i18n.translateStatus("verified", "ru"), "Подтверждено");
  assert.equal(i18n.translateMetric("today_views", "ru"), "Просмотры сегодня");
  assert.equal(i18n.translateMetric("average_cpm", "ru"), "Средний CPM");
  assert.equal(i18n.translateStatus("custom_server_state", "ru"), "custom_server_state");
});

test("a missing Russian value falls back to English without leaking a marker or object", () => {
  const original = i18n.catalogs.ru["common.dashboard"];
  i18n.catalogs.ru["common.dashboard"] = "";
  try {
    assert.equal(i18n.translate("common.dashboard", {}, "ru"), "Dashboard");
  } finally {
    i18n.catalogs.ru["common.dashboard"] = original;
  }
});

test("technical identifiers and financial values remain unchanged", () => {
  for (const identifier of ["USDT", "CPM", "CPC", "CTR", "GigaPub", "AdsGram", "Monetag", "AdsGalaxyInternal"]) {
    assert.equal(i18n.translate("miniapp.reward.earned", { amount: identifier }, "ru").includes(identifier), true);
  }
  assert.equal(i18n.formatNumber(8.4, "en", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), "8.4");
  assert.equal(i18n.formatNumber(8.4, "ru", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(",", "."), "8.4");
});

test("user-generated content is returned untouched by interpolation", () => {
  const channel = "Dashboard";
  const username = "@Campaigns";
  const rendered = i18n.translate("validation.required", { channel, username }, "ru");
  assert.equal(channel, "Dashboard");
  assert.equal(username, "@Campaigns");
  assert.equal(rendered, "Заполните это поле.");
});

test("API error codes stay machine-readable while Russian message lookup works", () => {
  const payload = { code: "INSUFFICIENT_BALANCE", message: apiErrors.localizedApiError("INSUFFICIENT_BALANCE", "ru") };
  assert.equal(payload.code, "INSUFFICIENT_BALANCE");
  assert.equal(payload.message, "Недостаточно средств.");
});

test("the production provider defaults to English and never auto-detects locale", () => {
  const provider = fs.readFileSync(path.join(root, "src/i18n/client.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.match(provider, /getTranslations\(DEFAULT_LOCALE\)/);
  assert.match(provider, /useState<Locale>\(DEFAULT_LOCALE\)/);
  assert.doesNotMatch(provider, /navigator\.language|language_code|searchParams/);
  assert.match(provider, /adsgalaxy_public_locale/);
  assert.match(provider, /isDashboard/);
  assert.match(layout, /<html[\s\S]*lang="en"/);
  assert.match(layout, /<LocalizationProvider>/);
});

test("legacy Publisher, Advertiser, Docs, and website phrases have centralized Russian coverage", () => {
  assert.ok(Object.keys(legacyRu).length >= 1200);
  for (const phrase of [
    "active",
    "approved",
    "Details",
    "Edit Bot",
    "Pause Bot",
    "Post Frequency (Per Day)",
    "Bot Categories (Max 3)",
    "Target Audience",
  ]) {
    assert.match(legacyRu[phrase], /[А-Яа-яЁё]/, `${phrase} must have a Russian translation`);
  }
});

test("legacy localization bridge preserves styling and excludes code and explicitly protected content", () => {
  const provider = fs.readFileSync(path.join(root, "src/i18n/client.tsx"), "utf8");
  assert.match(provider, /MutationObserver/);
  assert.match(provider, /script,style,code,pre,\[data-i18n-skip\]/);
  assert.match(provider, /node\.nodeValue = translated/);
  assert.doesNotMatch(provider, /className\s*=/);
  assert.match(provider, /translateCountedPhrase/);
  assert.match(provider, /ENGLISH_COUNTED_NOUNS/);
});

test("public website offers a persistent switch and first-visit Russian-first prompt", () => {
  const homepage = fs.readFileSync(path.join(root, "src/components/home/PublicHomepage.tsx"), "utf8");
  assert.match(homepage, /adsgalaxy_public_language_selected/);
  assert.match(homepage, /public\.language\.promptTitle/);
  assert.match(homepage, /public\.language\.switchLabel/);
  assert.ok(homepage.indexOf('chooseLanguage("ru")') < homepage.indexOf('chooseLanguage("en")'));
  assert.match(homepage, /<option value="ru">/);
  assert.match(homepage, /<option value="en">/);
});

test("mobile website navigation overlays the page instead of changing document flow", () => {
  const homepage = fs.readFileSync(path.join(root, "src/components/home/PublicHomepage.tsx"), "utf8");
  assert.match(homepage, /absolute inset-x-0 top-full z-10/);
  assert.match(homepage, /fixed inset-x-0 bottom-0 top-16 z-0/);
  assert.match(homepage, /onClick=\{\(\) => setMenuOpen\(false\)\}/);
});
