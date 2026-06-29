"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
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

interface SelfPromotionAdProps {
  enabled?: boolean;
  delayMs?: number;
}

export default function SelfPromotionAd({
  enabled = true,
  delayMs = 1200,
}: SelfPromotionAdProps) {
  const [ad, setAd] = React.useState<PromoAd | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  const [impressionTracked, setImpressionTracked] = React.useState(false);

  const track = React.useCallback(
    async (eventType: "impression" | "click" | "dismissal") => {
      if (!ad) return;
      await apiFetch("/api/self-promotion", {
        method: "POST",
        body: JSON.stringify({ ad_id: ad.id, event_type: eventType }),
        timeoutMs: 8000,
      }).catch(() => undefined);
    },
    [ad],
  );

  React.useEffect(() => {
    if (!enabled) {
      setVisible(false);
      setAd(null);
      setSecondsLeft(0);
      setImpressionTracked(false);
      return;
    }

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
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [delayMs, enabled]);

  React.useEffect(() => {
    if (!visible || !ad || impressionTracked) return;
    setImpressionTracked(true);
    track("impression");
  }, [ad, impressionTracked, track, visible]);

  React.useEffect(() => {
    if (!visible || secondsLeft <= 0) return;
    const timer = window.setTimeout(
      () => setSecondsLeft((v) => Math.max(0, v - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [secondsLeft, visible]);

  if (!visible || !ad) return null;

  const canClose = secondsLeft <= 0;

  return (
    <AnimatePresence>
      {visible && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <motion.div
            key="promo-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            aria-hidden="true"
          />

          {/* Container */}
          <motion.div
            key="promo-container"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="relative w-full max-w-sm bg-white rounded-3xl shadow-[0_20px_60px_rgba(15,23,42,0.16)] overflow-hidden"
          >
            {/* Close / countdown button */}
            <div className="absolute right-4 top-4 z-10">
              {canClose ? (
                <button
                  type="button"
                  aria-label="Close promotion"
                  onClick={() => {
                    track("dismissal");
                    setVisible(false);
                  }}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                >
                  <X size={16} />
                </button>
              ) : (
                <div className="h-8 w-8 flex items-center justify-center rounded-full bg-[#0c9de8] text-xs font-black text-white shadow-[0_2px_8px_rgba(12,157,232,0.30)]">
                  {secondsLeft}
                </div>
              )}
            </div>

            <div className="p-6 pt-7 text-center space-y-4">
              {/* Ad image */}
              {ad.image_url && (
                <img
                  src={ad.image_url}
                  alt=""
                  className="mx-auto h-36 w-36 rounded-2xl object-cover shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
                />
              )}

              {/* Ad copy */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#0c9de8]">
                  Sponsored
                </p>
                <h2 className="text-[17px] font-black text-slate-900 leading-snug tracking-tight">
                  {ad.title}
                </h2>
                <p className="text-sm font-medium text-slate-500 leading-relaxed">
                  {ad.description}
                </p>
              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={() => {
                  track("click");
                  openExternalUrl(ad.cta_url);
                }}
                className="w-full rounded-2xl bg-[#0c9de8] px-4 py-3.5 text-sm font-black text-white shadow-[0_4px_16px_rgba(12,157,232,0.25)] transition-colors hover:bg-blue-600 active:scale-[0.98]"
              >
                {ad.cta_text}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
