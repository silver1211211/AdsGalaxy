import en from "./en";
import ru from "./ru";
import type { Locale, PluralFamily, TranslationCatalog, TranslationKey, TranslationValues } from "./types";

export type { Locale, PluralFamily, TranslationCatalog, TranslationKey, TranslationValues } from "./types";

export const DEFAULT_LOCALE: Locale = "en";
export const SUPPORTED_LOCALES = ["en", "ru"] as const;
export const PUBLIC_LOCALES = ["ru", "en"] as const;

export const catalogs: Readonly<Record<Locale, TranslationCatalog>> = { en, ru };

const STATUS_KEYS: Readonly<Record<string, TranslationKey>> = {
  active: "common.active", inactive: "common.inactive", pending: "common.pending",
  approved: "common.approved", rejected: "common.rejected", paused: "common.paused",
  completed: "common.completed", failed: "common.failed", processing: "status.processing",
  verified: "status.verified", unverified: "status.unverified", successful: "status.successful",
  cancelled: "status.cancelled", canceled: "status.cancelled", queued: "status.queued",
  running: "status.running", pausing: "status.pausing", banned: "status.banned",
  blocked: "status.blocked", deleted: "status.deleted", deactivated: "status.deactivated",
  locked: "status.locked", unlocked: "status.unlocked",
};

const METRIC_KEYS: Readonly<Record<string, TranslationKey>> = {
  views: "common.views", view: "common.view", clicks: "common.clicks",
  impressions: "common.impressions", earnings: "common.earnings", revenue: "common.revenue",
  balance: "common.balance", subscribers: "common.subscribers", conversions: "common.conversions",
  today_views: "metrics.todayViews", today_clicks: "metrics.todayClicks",
  average_cpm: "metrics.averageCpm", average_cpc: "metrics.averageCpc",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

function interpolate(message: string, values: TranslationValues = {}) {
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? placeholder : String(value);
  });
}

export function translate(
  key: TranslationKey,
  values: TranslationValues = {},
  locale: Locale = DEFAULT_LOCALE,
) {
  const message = catalogs[locale][key] || catalogs.en[key] || "";
  return interpolate(message, values);
}

export function translatePlural(
  family: PluralFamily,
  count: number,
  values: TranslationValues = {},
  locale: Locale = DEFAULT_LOCALE,
) {
  const category = new Intl.PluralRules(locale === "ru" ? "ru-RU" : "en-US").select(count);
  const prefix = family === "redirectHome" ? "shared.redirectHome" : `plural.${family}`;
  const candidate = `${prefix}.${category}` as TranslationKey;
  const fallback = `${prefix}.other` as TranslationKey;
  const key = catalogs[locale][candidate] ? candidate : fallback;
  return translate(key, { count, ...values }, locale);
}

function canonicalDisplayValue(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_");
}

export function translateStatus(value: unknown, locale: Locale = DEFAULT_LOCALE) {
  const original = String(value ?? "");
  const key = STATUS_KEYS[canonicalDisplayValue(value)];
  return key ? translate(key, {}, locale) : original;
}

export function translateMetric(value: unknown, locale: Locale = DEFAULT_LOCALE) {
  const original = String(value ?? "");
  const key = METRIC_KEYS[canonicalDisplayValue(value)];
  return key ? translate(key, {}, locale) : original;
}

export function getTranslations(locale: Locale = DEFAULT_LOCALE) {
  return {
    locale,
    t: (key: TranslationKey, values?: TranslationValues) => translate(key, values, locale),
    tp: (family: PluralFamily, count: number, values?: TranslationValues) => translatePlural(family, count, values, locale),
  };
}

export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", options).format(value);
}

export function formatDate(value: Date | string | number, locale: Locale = DEFAULT_LOCALE, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", options).format(date);
}
