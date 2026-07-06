"use client";

import { useState } from "react";
import { Eye, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { previewInternalRewardedAd, type InternalAdPayload } from "@/lib/miniappSdkRuntime";

const mockAds: InternalAdPayload[] = [
  {
    id: 900001,
    title: "AdsGalaxy Demo",
    description: "Preview the real rewarded ad viewer before production.",
    cta_text: "Open Demo",
    landing_url: "https://t.me/Ads_Galaxy_bot",
    image_url: "https://images.unsplash.com/photo-1614728263952-84ea256f9679?auto=format&fit=crop&w=900&q=80",
    advertiser_logo_url: "/logo.svg",
    admin_cpm: 0,
  },
  {
    id: 900002,
    title: "Mini App Boost",
    description: "A fake creative for testing copy, image, timing, and CTA layout.",
    cta_text: "View Offer",
    landing_url: "https://t.me/Ads_Galaxy_bot",
    image_url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    advertiser_logo_url: "/logo.svg",
    admin_cpm: 0,
  },
  {
    id: 900003,
    title: "Game Reward",
    description: "Test the normal countdown flow exactly as users see it.",
    cta_text: "Play Now",
    landing_url: "https://t.me/Ads_Galaxy_bot",
    image_url: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=900&q=80",
    advertiser_logo_url: "/logo.svg",
    admin_cpm: 0,
  },
];

export default function AdsPreviewPage() {
  const [selectedAd, setSelectedAd] = useState(0);
  const [displaying, setDisplaying] = useState(false);
  const [lastResult, setLastResult] = useState<"completed" | "closed" | null>(null);

  async function displayAd() {
    if (displaying) return;
    setDisplaying(true);
    setLastResult(null);
    try {
      await previewInternalRewardedAd(mockAds[selectedAd]);
      setLastResult("completed");
    } catch {
      setLastResult("closed");
    } finally {
      setDisplaying(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef6ff] px-4 py-8 text-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-blue-100 bg-white p-5 shadow-xl shadow-blue-100/60">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0c7ec7]">Visual QA only</p>
            <h1 className="mt-1 text-2xl font-black">AdsGalaxy Ad Viewer</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <ShieldCheck size={19} />
          </div>
        </div>

        <div className="mt-5 grid gap-2">
          {mockAds.map((ad, index) => (
            <button
              type="button"
              key={ad.id}
              onClick={() => setSelectedAd(index)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${selectedAd === index ? "border-[#0c9de8] bg-blue-50" : "border-slate-100 bg-white hover:bg-slate-50"}`}
            >
              <span className="block text-sm font-black text-slate-900">{ad.title}</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">{ad.description}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={displayAd}
          disabled={displaying}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/25 transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {displaying ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}
          {displaying ? "Displaying..." : "Display Ad"}
        </button>

        {lastResult && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
            <span>{lastResult === "completed" ? "Countdown completed." : "Preview closed."}</span>
            <button
              type="button"
              onClick={() => setLastResult(null)}
              aria-label="Clear result"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        )}

        <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
          Uses the same AdsGalaxy internal rewarded ad overlay as production with mock data only. No mediation, impression, debit, credit, or settlement request is sent.
        </p>
      </section>
    </main>
  );
}
