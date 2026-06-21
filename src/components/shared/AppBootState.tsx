"use client";

import { Loader2, RefreshCw } from "lucide-react";

type AppBootStateProps = {
  title?: string;
  message?: string;
  mode?: "loading" | "error";
  actionLabel?: string;
  onAction?: () => void;
  detail?: string;
};

export default function AppBootState({
  title = "AdsGalaxy",
  message = "Starting your Mini App...",
  mode = "loading",
  actionLabel = "Reload",
  onAction,
  detail,
}: AppBootStateProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-blue-100 bg-white p-6 text-center shadow-xl shadow-blue-100/60">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0c9de8] text-white shadow-lg shadow-blue-200">
          {mode === "loading" ? <Loader2 className="animate-spin" size={30} /> : <RefreshCw size={28} />}
        </div>
        <p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-[#0c9de8]">AdsGalaxy</p>
        <h1 className="text-2xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{message}</p>
        {detail && <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>}
        {mode === "error" && (
          <button
            onClick={onAction || (() => window.location.reload())}
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#0c9de8] px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 active:scale-[0.98]"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </main>
  );
}
