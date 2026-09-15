import { translate, type Locale, type TranslationKey } from "./index";

const API_ERROR_TRANSLATIONS: Readonly<Record<string, TranslationKey>> = {
  INSUFFICIENT_BALANCE: "errors.insufficientBalance",
  UNAUTHORIZED: "errors.unauthorized",
  FORBIDDEN: "errors.forbidden",
  ACCOUNT_RESTRICTED: "errors.accountRestricted",
  CHANNEL_CREATE_FAILED: "errors.channelCreateFailed",
  CHANNEL_UPDATE_FAILED: "errors.channelUpdateFailed",
  CHANNEL_ALREADY_EXISTS: "errors.channelAlreadyExists",
  PERMISSION_REQUIRED: "errors.permissionRequired",
  TELEGRAM_TEMPORARILY_UNAVAILABLE: "errors.telegramUnavailable",
  DATABASE_TEMPORARILY_UNAVAILABLE: "errors.databaseUnavailable",
  NO_ADS_AVAILABLE: "errors.noAdsAvailable",
  REWARD_FAILED: "errors.rewardFailed",
};

export function localizedApiError(code: string | null | undefined, locale: Locale = "en") {
  const key = code ? API_ERROR_TRANSLATIONS[code] : undefined;
  return key ? translate(key, {}, locale) : translate("errors.generic", {}, locale);
}
