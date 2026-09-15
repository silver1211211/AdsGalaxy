"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "@/i18n/client";

type AppBootStateProps = {
  title?: string;
  message?: string;
  mode?: "loading" | "error";
  actionLabel?: string;
  onAction?: () => void;
  detail?: string;
};

export default function AppBootState({
  title,
  message,
  mode = "loading",
  actionLabel,
  onAction,
  detail,
}: AppBootStateProps) {
  const { t } = useTranslations();
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-[radial-gradient(circle_at_top,rgba(12,157,232,0.10),transparent_38%),#f8fbff] px-5 py-8">
      <div className="w-full max-w-xs rounded-[1.75rem] border border-blue-100/80 bg-white/95 p-6 text-center shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur">
        <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0c9de8] text-white shadow-lg shadow-blue-200/80">
          {mode === "loading" && <span className="absolute inset-0 animate-ping rounded-2xl bg-[#0c9de8]/20" />}
          {mode === "loading" ? <Loader2 className="relative animate-spin" size={25} /> : <RefreshCw size={25} />}
        </div>
        <p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-[#0c9de8]">AdsGalaxy</p>
        <h1 className="text-xl font-black tracking-tight text-slate-950">{title || t("common.adsGalaxy")}</h1>
        <p className="mt-2 text-sm font-medium leading-5 text-slate-500">{message || t("shared.startingMiniApp")}</p>
        {detail && <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>}
        {mode === "error" && (
          <button
            onClick={onAction || (() => window.location.reload())}
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#0c9de8] px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 active:scale-[0.98]"
          >
            {actionLabel || t("shared.reload")}
          </button>
        )}
      </div>
    </main>
  );
}
