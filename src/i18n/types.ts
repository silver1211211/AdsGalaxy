import en from "./en";

export type Locale = "en" | "ru";
export type TranslationKey = keyof typeof en;
export type TranslationCatalog = Record<TranslationKey, string> & Partial<Record<string, string>>;
export type TranslationValues = Record<string, string | number>;
export type PluralFamily = "impressions" | "clicks" | "views" | "channels" | "bots" | "campaigns" | "subscribers" | "days" | "redirectHome";
