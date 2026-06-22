"use client";

import { ShieldX } from "lucide-react";

const SUPPORT_USERNAME = "Ads_Galaxy_Cs";
const SUPPORT_URL = `https://t.me/${SUPPORT_USERNAME}`;

export default function BannedScreen() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl shadow-black/30">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-300 ring-1 ring-red-400/20">
          <ShieldX size={30} />
        </div>
        <h1 className="text-2xl font-black tracking-tight">Account Suspended</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-300">
          Your account has been suspended.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          If you believe this is a mistake, please contact support.
        </p>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-bold text-[#0c9de8] hover:text-[#3db4f2] transition-colors"
        >
          Support: @{SUPPORT_USERNAME}
        </a>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#0c9de8] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-950/30"
        >
          Message @{SUPPORT_USERNAME}
        </a>
      </div>
    </main>
  );
}
