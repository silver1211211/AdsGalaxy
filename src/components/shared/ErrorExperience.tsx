"use client";

import { useEffect, useState } from "react";

type ErrorExperienceProps = {
  code: string;
  title: string;
  message: string;
  onRetry?: () => void;
};

const REDIRECT_SECONDS = 8;

export default function ErrorExperience({ code, title, message, onRetry }: ErrorExperienceProps) {
  const [seconds, setSeconds] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    const redirectTimer = window.setTimeout(() => window.location.assign("/"), REDIRECT_SECONDS * 1000);
    const countdownTimer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(redirectTimer);
      window.clearInterval(countdownTimer);
    };
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07111f] px-5 py-12 text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      <section className="relative w-full max-w-xl rounded-[32px] border border-white/10 bg-white/[0.07] p-7 text-center shadow-[0_32px_100px_rgba(0,0,0,.45)] backdrop-blur-2xl sm:p-10">
        <a href="/" className="mx-auto flex w-fit items-center gap-3" aria-label="AdsGalaxy homepage">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-blue-500/25">
            <span className="h-5 w-5 rounded-full border-[3px] border-white" />
          </span>
          <span className="text-xl font-black tracking-tight">AdsGalaxy</span>
        </a>

        <div className="mx-auto mt-8 flex h-24 w-24 items-center justify-center rounded-[28px] border border-white/10 bg-black/20 shadow-inner">
          <span className="bg-gradient-to-br from-blue-300 to-cyan-300 bg-clip-text text-4xl font-black text-transparent">{code}</span>
        </div>

        <p className="mt-7 text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Lost in the galaxy?</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-md text-sm font-medium leading-6 text-slate-300 sm:text-base">{message}</p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 px-6 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:-translate-y-0.5 hover:shadow-blue-500/30">
            Return to homepage
          </a>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="min-h-12 rounded-2xl border border-white/15 bg-white/[0.06] px-6 text-sm font-black text-white transition hover:bg-white/10">
              Try again
            </button>
          ) : null}
        </div>

        <p className="mt-7 text-xs font-semibold text-slate-400" aria-live="polite">
          Redirecting to the homepage in {seconds} second{seconds === 1 ? "" : "s"}.
        </p>
      </section>
    </main>
  );
}
