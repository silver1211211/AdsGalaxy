"use client";

import { useHeader } from "@/context/HeaderContext";
import { Menu, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@/i18n/client";
import { apiFetch } from "@/lib/api";

interface HeaderProps {
  toggleSidebar: () => void;
}

export default function Header({ toggleSidebar }: HeaderProps) {
  const { title } = useHeader();
  const { locale, setLocale, t } = useTranslations();
  const [savingLanguage, setSavingLanguage] = useState(false);

  const changeLanguage = async (language: string) => {
    if (language === locale || savingLanguage) return;
    setSavingLanguage(true);
    try {
      const response = await apiFetch("/api/me/language", {
        method: "POST",
        body: JSON.stringify({ language }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !setLocale(data.language)) {
        throw new Error(String(data.error || "Language update failed"));
      }
    } catch (error) {
      console.error("Language update failed", error);
      window.alert(t("language.updateFailed"));
    } finally {
      setSavingLanguage(false);
    }
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-[60] grid h-16 grid-cols-2 items-center border-b border-white/20 bg-[#0c9de8]/90 px-3 shadow-lg shadow-blue-950/10 backdrop-blur-xl sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <button
          onClick={toggleSidebar}
          className="rounded-xl border border-white/15 bg-white/10 p-2 text-white shadow-sm transition active:scale-95 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="hidden h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white sm:flex">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-lg font-black tracking-tight text-white">{title}</span>
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/80 sm:block">AdsGalaxy Mini App</span>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-center">
        <label className="sr-only" htmlFor="dashboard-language">{t("language.current")}</label>
        <select
          id="dashboard-language"
          value={locale}
          disabled={savingLanguage}
          onChange={(event) => void changeLanguage(event.target.value)}
          className="h-10 w-full max-w-[8.75rem] cursor-pointer rounded-xl border border-white/30 bg-white/95 px-2.5 text-sm font-bold text-slate-800 shadow-sm outline-none transition focus:border-white focus:ring-2 focus:ring-white/40 disabled:cursor-wait disabled:opacity-70 sm:px-3"
          aria-label={t("language.current")}
        >
          <option value="ru">{t("bot.language.russian")}</option>
          <option value="en">{t("bot.language.english")}</option>
        </select>
      </div>
    </header>
  );
}
