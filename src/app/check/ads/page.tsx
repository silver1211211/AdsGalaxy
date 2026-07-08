"use client";

import { useState } from "react";
import { Eye, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { previewInternalRewardedAd, type InternalAdPayload } from "@/lib/miniappSdkRuntime";

const previewDescription =
  "Preview a compact Mini App ad with polished creative, clear message, balanced spacing, trusted AdsGalaxy attribution, and a direct call to action before launching the real rewarded display experience.";

const mockAds: InternalAdPayload[] = [
  {
    id: 900001,
    title: "AdsGalaxy Rewarded Ad Preview For Mini Apps Today!",
    description: previewDescription,
    cta_text: "Open Demo",
    landing_url: "https://t.me/Ads_Galaxy_bot",
    image_url: "https://images.unsplash.com/photo-1614728263952-84ea256f9679?auto=format&fit=crop&w=1080&h=1350&q=80",
    advertiser_logo_url: "/logo.svg",
    admin_cpm: 0,
  },
  {
    id: 900002,
    title: "AdsGalaxy Rewarded Ad Preview For Mini Apps Today!",
    description: previewDescription,
    cta_text: "View Offer",
    landing_url: "https://t.me/Ads_Galaxy_bot",
    image_url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1080&h=1350&q=80",
    advertiser_logo_url: "/logo.svg",
    admin_cpm: 0,
  },
  {
    id: 900003,
    title: "AdsGalaxy Rewarded Ad Preview For Mini Apps Today!",
    description: previewDescription,
    cta_text: "Play Now",
    landing_url: "https://t.me/Ads_Galaxy_bot",
    image_url: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1080&h=1350&q=80",
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
    <main className="min-h-screen bg-[#eef6ff] px-3 py-3 text-slate-950">
      <section className="mx-auto w-full max-w-5xl rounded-xl border border-blue-100 bg-white p-3 shadow-xl shadow-blue-100/60">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0c7ec7]">Visual QA only</p>
            <h1 className="mt-1 text-lg font-black">AdsGalaxy Ads Preview</h1>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <ShieldCheck size={17} />
          </div>
        </div>

        <div className="mt-3 grid gap-3">
          <div>
            <div className="rounded-lg border border-[#0c9de8] bg-blue-50 px-3 py-2 text-sm font-black text-blue-700">
              AdsGalaxy
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-widest text-slate-400">Creative</div>
            <div className="grid gap-2 md:grid-cols-3">
              {mockAds.map((ad, index) => (
                <button
                  type="button"
                  key={ad.id}
                  onClick={() => setSelectedAd(index)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${selectedAd === index ? "border-[#0c9de8] bg-blue-50" : "border-slate-100 bg-white hover:bg-slate-50"}`}
                >
                  <span className="block text-sm font-black text-slate-900">{ad.title}</span>
                  <span className="mt-1 block max-h-10 overflow-hidden text-xs font-semibold leading-5 text-slate-500">{ad.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={displayAd}
          disabled={displaying}
          className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0c9de8] px-5 py-2 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/25 transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {displaying ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}
          {displaying ? "Displaying..." : "Display AdsGalaxy"}
        </button>

        {lastResult && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">
            <span>{lastResult === "completed" ? "Countdown completed." : "Preview closed."}</span>
            <button type="button" onClick={() => setLastResult(null)} aria-label="Clear result" className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500">
              <RotateCcw size={14} />
            </button>
          </div>
        )}

        <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
          This page is visual QA only. It never sends mediation, impression, reward, credit, settlement, statistic, debit, or display requests.
        </p>
      </section>
    </main>
  );
}
