"use client";

import React from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";

type PromoAd = {
  id: number;
  title: string;
  description: string;
  cta_text: string;
  cta_url: string;
  image_url?: string | null;
  countdown_seconds: number;
};

function openExternalUrl(url: string) {
  const twa = (window as any).Telegram?.WebApp;
  if (twa?.openLink) {
    twa.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function SelfPromotionAd() {
  const [ad, setAd] = React.useState<PromoAd | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  const [impressionTracked, setImpressionTracked] = React.useState(false);

  const track = React.useCallback(async (eventType: "impression" | "click" | "dismissal") => {
    if (!ad) return;
    await apiFetch("/api/self-promotion", {
      method: "POST",
      body: JSON.stringify({ ad_id: ad.id, event_type: eventType }),
      timeoutMs: 8000,
    }).catch(() => undefined);
  }, [ad]);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch("/api/self-promotion", { timeoutMs: 10000 });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !data.eligible || !data.ad) return;

        const nextAd = data.ad as PromoAd;
        setAd(nextAd);
        setSecondsLeft(Math.max(1, Number(nextAd.countdown_seconds || 5)));
        setVisible(true);
      } catch {
        // Promo availability should never block the dashboard.
      }
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!visible || !ad || impressionTracked) return;
    setImpressionTracked(true);
    track("impression");
  }, [ad, impressionTracked, track, visible]);

  React.useEffect(() => {
    if (!visible || secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, visible]);

  if (!visible || !ad) return null;

  const canClose = secondsLeft <= 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/20 bg-white text-slate-950 shadow-2xl shadow-slate-950/25 dark:bg-slate-950 dark:text-white">
        <div className="absolute right-3 top-3 z-10">
          {canClose ? (
            <button
              type="button"
              aria-label="Close promotion"
              onClick={() => {
                track("dismissal");
                setVisible(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/90 text-white shadow-lg transition active:scale-95"
            >
              <X size={18} />
            </button>
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white shadow-lg">
              {secondsLeft}
            </div>
          )}
        </div>

        <div className="p-5 pt-7 text-center">
          {ad.image_url && (
            <img
              src={ad.image_url}
              alt=""
              className="mx-auto mb-4 h-40 w-40 rounded-2xl object-cover shadow-lg shadow-blue-100 dark:shadow-blue-950/40"
            />
          )}
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Sponsored</p>
          <h2 className="mt-2 text-xl font-black leading-tight tracking-tight">{ad.title}</h2>
          <p className="mt-3 text-sm font-normal leading-6 text-slate-600 dark:text-slate-300">{ad.description}</p>
          <button
            type="button"
            onClick={() => {
              track("click");
              openExternalUrl(ad.cta_url);
            }}
            className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition active:scale-[0.98] dark:shadow-blue-950/40"
          >
            {ad.cta_text}
          </button>
        </div>
      </div>
    </div>
  );
}
