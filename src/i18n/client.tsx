"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { catalogs, DEFAULT_LOCALE, formatNumber, getTranslations, isLocale, translatePlural, type Locale, type PluralFamily } from "./index";
import legacyRu from "./legacyRu";

const PUBLIC_LOCALE_STORAGE_KEY = "adsgalaxy_public_locale";
const LOCALE_COOKIE_KEY = "ag_locale";
const SKIP_LOCALIZATION_SELECTOR = "script,style,code,pre,[data-i18n-skip],[contenteditable='true']";
const enToRu = new Map<string, string>();
const ruToEn = new Map<string, string>();

for (const key of Object.keys(catalogs.en) as Array<keyof typeof catalogs.en>) {
  const english = catalogs.en[key];
  const russian = catalogs.ru[key];
  if (english && russian && english !== russian) {
    enToRu.set(english, russian);
    ruToEn.set(russian, english);
  }
}
for (const [english, russian] of Object.entries(legacyRu)) {
  if (english && russian && english !== russian) {
    enToRu.set(english, russian);
    ruToEn.set(russian, english);
  }
}

const enLowerToRu = new Map([...enToRu].map(([english, russian]) => [english.toLocaleLowerCase("en-US"), russian]));
const ruLowerToEn = new Map([...ruToEn].map(([russian, english]) => [russian.toLocaleLowerCase("ru-RU"), english]));

const ENGLISH_COUNTED_NOUNS: Readonly<Record<string, PluralFamily>> = {
  impression: "impressions", impressions: "impressions", click: "clicks", clicks: "clicks",
  view: "views", views: "views", channel: "channels", channels: "channels",
  bot: "bots", bots: "bots", campaign: "campaigns", campaigns: "campaigns",
  subscriber: "subscribers", subscribers: "subscribers",
};
const RUSSIAN_COUNTED_NOUNS: Readonly<Record<string, PluralFamily>> = {
  показ: "impressions", показа: "impressions", показов: "impressions",
  клик: "clicks", клика: "clicks", кликов: "clicks",
  просмотр: "views", просмотра: "views", просмотров: "views",
  канал: "channels", канала: "channels", каналов: "channels",
  бот: "bots", бота: "bots", ботов: "bots",
  кампания: "campaigns", кампании: "campaigns", кампаний: "campaigns",
  подписчик: "subscribers", подписчика: "subscribers", подписчиков: "subscribers",
};

function translateCountedPhrase(text: string, locale: Locale) {
  const match = text.match(/^([\d\s,.]+)\s+([^\s]+)$/u);
  if (!match) return null;
  const noun = match[2].toLocaleLowerCase(locale === "ru" ? "en-US" : "ru-RU");
  const family = locale === "ru" ? ENGLISH_COUNTED_NOUNS[noun] : RUSSIAN_COUNTED_NOUNS[noun];
  const count = Number(match[1].replace(/[\s,]/g, ""));
  if (!family || !Number.isFinite(count)) return null;
  return translatePlural(family, count, { count: formatNumber(count, locale) }, locale);
}

export function translateVisibleText(value: string, locale: Locale) {
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const text = value.trim();
  if (!text) return value;
  const counted = translateCountedPhrase(text, locale);
  if (counted) return `${leading}${counted}${trailing}`;
  const translated = locale === "ru"
    ? enToRu.get(text) || enLowerToRu.get(text.toLocaleLowerCase("en-US"))
    : ruToEn.get(text) || ruLowerToEn.get(text.toLocaleLowerCase("ru-RU"));
  return translated ? `${leading}${translated}${trailing}` : value;
}

function localizeDom(root: ParentNode, locale: Locale) {
  const owner = root instanceof Document ? root.documentElement : root;
  if (owner instanceof Element && owner.closest(SKIP_LOCALIZATION_SELECTOR)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_LOCALIZATION_SELECTOR)) continue;
    const current = node.nodeValue || "";
    const translated = translateVisibleText(current, locale);
    if (translated !== current) node.nodeValue = translated;
  }
  const elements = root instanceof Element ? [root, ...root.querySelectorAll<HTMLElement>("[placeholder],[title],[aria-label]")] : [...root.querySelectorAll<HTMLElement>("[placeholder],[title],[aria-label]")];
  for (const element of elements) {
    if (element.closest(SKIP_LOCALIZATION_SELECTOR)) continue;
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const translated = translateVisibleText(current, locale);
      if (translated !== current) element.setAttribute(attribute, translated);
    }
  }
}

type LocalizationContextValue = ReturnType<typeof getTranslations> & {
  localeInitialized: boolean;
  setLocale: (locale: unknown) => boolean;
  initializeLocale: (locale: unknown) => void;
};

const fallback = getTranslations(DEFAULT_LOCALE);
const LocalizationContext = createContext<LocalizationContextValue>({
  ...fallback,
  localeInitialized: false,
  setLocale: () => false,
  initializeLocale: () => undefined,
});

function persistBrowserLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PUBLIC_LOCALE_STORAGE_KEY, locale);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function LocalizationProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale?: unknown }) {
  const resolvedInitialLocale = isLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE;
  const [locale, setLocaleState] = useState<Locale>(resolvedInitialLocale);
  const [localeInitialized, setLocaleInitialized] = useState(isLocale(initialLocale));

  const setLocale = useCallback((nextLocale: unknown) => {
    if (!isLocale(nextLocale)) return false;
    setLocaleState(nextLocale);
    persistBrowserLocale(nextLocale);
    return true;
  }, []);

  const initializeLocale = useCallback((nextLocale: unknown) => {
    const resolvedLocale = isLocale(nextLocale) ? nextLocale : DEFAULT_LOCALE;
    setLocaleState(resolvedLocale);
    persistBrowserLocale(resolvedLocale);
    setLocaleInitialized(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (localeInitialized) return;
    const isDashboard = /^\/(publisher|advertiser)(?:\/|$)/.test(window.location.pathname);
    if (isDashboard) return;
    const saved = window.localStorage.getItem(PUBLIC_LOCALE_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- public preference is browser-only and read after hydration
    initializeLocale(isLocale(saved) ? saved : DEFAULT_LOCALE);
  }, [initializeLocale, localeInitialized]);

  useEffect(() => {
    localizeDom(document, locale);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target.parentNode) {
          localizeDom(mutation.target.parentNode, locale);
        } else {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element || node instanceof DocumentFragment) localizeDom(node, locale);
            else if (node.parentNode) localizeDom(node.parentNode, locale);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

  const value = useMemo(() => ({
    ...getTranslations(locale),
    localeInitialized,
    setLocale,
    initializeLocale,
  }), [initializeLocale, locale, localeInitialized, setLocale]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useTranslations() {
  return useContext(LocalizationContext);
}
