"use client";

import { useState } from "react";
import { Eye, Loader2, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import { previewInternalRewardedAd, type InternalAdPayload } from "@/lib/miniappSdkRuntime";

type PreviewProvider = "Auto Mediation" | "Internal Ads" | "AdsGram" | "GigaPub" | "AdExium" | "Monetag" | "RichAds";

const providers: PreviewProvider[] = ["Auto Mediation", "Internal Ads", "AdsGram", "GigaPub", "AdExium", "Monetag", "RichAds"];

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

function ExternalProviderPreview({ provider, onClose }: { provider: PreviewProvider; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-950/92 p-5 text-white">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/15 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">{provider}</div>
            <div className="mt-1 text-lg font-black">Provider render preview</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close preview" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-cyan-300/30 bg-slate-950">
            <div className="px-8 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-300 text-slate-950">
                <Play size={28} fill="currentColor" />
              </div>
              <div className="mt-5 text-xl font-black">{provider} creative surface</div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                Isolated visual QA. No provider display call, AdsGalaxy impression, reward, debit, credit, statistic, or settlement is created.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300">
            <div className="rounded-xl bg-white/5 p-3">Render Status: preview only</div>
            <div className="rounded-xl bg-white/5 p-3">Impression: not recorded</div>
            <div className="rounded-xl bg-white/5 p-3">Completion: not recorded</div>
            <div className="rounded-xl bg-white/5 p-3">Billing: isolated</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdsPreviewPage() {
  const [selectedAd, setSelectedAd] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<PreviewProvider>("Auto Mediation");
  const [displaying, setDisplaying] = useState(false);
  const [externalPreview, setExternalPreview] = useState<PreviewProvider | null>(null);
  const [lastResult, setLastResult] = useState<"completed" | "closed" | "previewed" | null>(null);

  async function displayAd() {
    if (displaying) return;
    setDisplaying(true);
    setLastResult(null);
    try {
      if (selectedProvider === "Internal Ads" || selectedProvider === "Auto Mediation") {
        await previewInternalRewardedAd(mockAds[selectedAd]);
        setLastResult("completed");
      } else {
        setExternalPreview(selectedProvider);
        setLastResult("previewed");
      }
    } catch {
      setLastResult("closed");
    } finally {
      setDisplaying(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef6ff] px-4 py-8 text-slate-950">
      {externalPreview && <ExternalProviderPreview provider={externalPreview} onClose={() => setExternalPreview(null)} />}
      <section className="mx-auto w-full max-w-5xl rounded-2xl border border-blue-100 bg-white p-5 shadow-xl shadow-blue-100/60">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0c7ec7]">Visual QA only</p>
            <h1 className="mt-1 text-2xl font-black">AdsGalaxy Provider Preview</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <ShieldCheck size={19} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[240px_1fr]">
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Provider</div>
            <div className="grid gap-2">
              {providers.map((provider) => (
                <button
                  type="button"
                  key={provider}
                  onClick={() => setSelectedProvider(provider)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm font-black transition-colors ${selectedProvider === provider ? "border-[#0c9de8] bg-blue-50 text-blue-700" : "border-slate-100 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {provider}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Creative</div>
            <div className="grid gap-2 md:grid-cols-3">
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
          </div>
        </div>

        <button
          type="button"
          onClick={displayAd}
          disabled={displaying}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/25 transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {displaying ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}
          {displaying ? "Displaying..." : `Display ${selectedProvider}`}
        </button>

        {lastResult && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
            <span>{lastResult === "completed" ? "Countdown completed." : lastResult === "previewed" ? "Provider preview opened." : "Preview closed."}</span>
            <button type="button" onClick={() => setLastResult(null)} aria-label="Clear result" className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500">
              <RotateCcw size={14} />
            </button>
          </div>
        )}

        <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
          This page is visual QA only. It never sends mediation, impression, reward, credit, settlement, statistic, debit, or provider display requests.
        </p>
      </section>
    </main>
  );
}
