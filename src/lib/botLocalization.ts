import { translate, type Locale } from "@/i18n";

export type BotButton = {
  label: string;
  callback_data?: string;
  url?: string;
  web_app_url?: string;
};

export function buildBotLanguageSelector() {
  return {
    text: translate("bot.language.select", {}, "en"),
    buttons: [
      { label: translate("bot.language.russian", {}, "ru"), callback_data: "language:ru" },
      { label: translate("bot.language.english", {}, "en"), callback_data: "language:en" },
    ] satisfies BotButton[],
  };
}

export function buildBotStartPayload(locale: Locale, escapedName: string, privateChat: boolean) {
  const appButton = (key: Parameters<typeof translate>[0], url: string): BotButton => ({
    label: translate(key, {}, locale),
    ...(privateChat ? { web_app_url: url } : { url }),
  });

  return {
    language: locale,
    confirmation: translate("bot.language.saved", {}, locale),
    text: translate("bot.start.message", { name: escapedName }, locale),
    parse_mode: "HTML",
    button_rows: [
      [appButton("bot.start.openAdsGalaxy", "https://app.adsgalaxy.online")],
      [appButton("bot.start.publisherDashboard", "https://app.adsgalaxy.online/publisher")],
      [appButton("bot.start.advertiserDashboard", "https://app.adsgalaxy.online/advertiser")],
      [appButton("bot.start.referralProgram", "https://app.adsgalaxy.online/publisher/referral")],
      [
        { label: translate("bot.start.officialChannel", {}, locale), url: "https://t.me/AdsGalaxy_News" },
        { label: translate("bot.start.supportChat", {}, locale), url: "https://t.me/Ads_Galaxy_Cs" },
      ],
    ] satisfies BotButton[][],
  };
}
