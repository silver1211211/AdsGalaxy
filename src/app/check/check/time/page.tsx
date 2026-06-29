import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Clock3, KeyRound, LockKeyhole, ShieldCheck, TimerReset } from "lucide-react";
import {
  getChannelCheckUnlockState,
  unlockChannelCheck,
  verifyTemporaryChannelCheckPassword,
} from "@/lib/channelCheckAccess";
import Countdown from "@/components/check/Countdown";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function rateLimitKey() {
  const headerList = await headers();
  return (
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headerList.get("x-real-ip")
    || "unknown"
  );
}

function requestedDuration(formData: FormData) {
  const preset = String(formData.get("duration") || "60");
  if (preset === "custom") {
    return String(formData.get("custom_minutes") || "60");
  }
  return preset;
}

async function unlockFromControl(formData: FormData) {
  "use server";

  const password = String(formData.get("password") || "");
  const duration = requestedDuration(formData);
  const verification = await verifyTemporaryChannelCheckPassword(password, await rateLimitKey());

  if (!verification.ok) {
    redirect(`/check/check/time?error=${verification.rateLimited ? "rate_limited" : "invalid"}`);
  }

  const result = await unlockChannelCheck(duration, verification.adminId);
  redirect(`/check/check/time?success=1&duration=${result.durationMinutes}`);
}

export default async function ChannelCheckTimePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const unlockState = await getChannelCheckUnlockState();
  const error = firstParam(params.error);
  const success = firstParam(params.success) === "1";
  const successDuration = firstParam(params.duration);
  const errorMessage = error === "rate_limited"
    ? "Too many failed attempts. Please wait and try again."
    : error === "invalid"
      ? "Incorrect password."
      : "";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7fbff_0%,#eaf7ff_44%,#ffffff_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto max-w-xl overflow-hidden rounded-[2rem] border border-blue-100 bg-white shadow-2xl shadow-blue-100/60">
        <div className="bg-[linear-gradient(135deg,#0c9de8_0%,#0b7ec9_56%,#075d9b_100%)] px-6 py-7 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/20">
              <TimerReset size={22} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-100">Unlock control</p>
              <h1 className="mt-1 text-2xl font-black">AdsGalaxy Channel Check</h1>
            </div>
          </div>
          <p className="mt-5 text-sm font-semibold leading-6 text-blue-50">
            Set the global viewing window for the shareable channel list without creating an admin session.
          </p>
        </div>

        <div className="mx-6 mt-6 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
          <p>
            Current status:{" "}
            <span className={unlockState.isUnlocked ? "font-black text-[#0c9de8]" : "font-black text-slate-700"}>
              {unlockState.isUnlocked ? "Unlocked" : "Locked"}
            </span>
          </p>
          {unlockState.isUnlocked && (
            <p className="mt-2">
              <span className="inline-flex items-center gap-2 font-semibold">
                <Clock3 size={16} className="text-[#0c9de8]" />
                Access expires in:
              </span>{" "}
              <span className="font-black tabular-nums text-[#0c9de8]"><Countdown untilMs={unlockState.unlockedUntilMs} /></span>
            </p>
          )}
          {unlockState.unlockedUntilIso && (
            <p className="mt-2 font-medium text-slate-600">Expiry: {new Date(unlockState.unlockedUntilIso).toLocaleString()}</p>
          )}
        </div>

        {success && (
          <div className="mx-6 mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            <span className="inline-flex items-center gap-2 font-black"><ShieldCheck size={16} /> Channel list unlocked</span>
            <p className="mt-1">Open for {successDuration || unlockState.durationMinutes} minutes.</p>
            <div className="mt-2">
              <Link href="/check/check/channels" className="font-black text-[#0c9de8] underline">Open channel list</Link>
            </div>
          </div>
        )}

        <form action={unlockFromControl} className="m-6 space-y-5 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm shadow-blue-50">
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-black text-slate-800">
              <KeyRound size={16} className="text-[#0c9de8]" />
              Admin password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className="mt-2 w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-base font-semibold outline-none transition-colors focus:border-[#0c9de8] focus:ring-4 focus:ring-[#0c9de8]/10"
              required
            />
          </label>

          <fieldset className="space-y-3">
            <legend className="flex items-center gap-2 text-sm font-black text-slate-800">
              <LockKeyhole size={16} className="text-[#0c9de8]" />
              Unlock duration
            </legend>
            <div className="grid grid-cols-2 gap-2">
            {[
              ["15", "15 minutes"],
              ["30", "30 minutes"],
              ["60", "1 hour"],
              ["120", "2 hours"],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/40 px-3 py-2 text-sm font-semibold text-slate-600">
                <input className="accent-[#0c9de8]" type="radio" name="duration" value={value} defaultChecked={value === "60"} />
                {label}
              </label>
            ))}
            </div>
            <label className="flex flex-col gap-2 rounded-2xl border border-blue-100 bg-white px-3 py-3 text-sm font-semibold text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2">
                <input className="accent-[#0c9de8]" type="radio" name="duration" value="custom" />
                Custom minutes
              </span>
              <input
                name="custom_minutes"
                type="number"
                min="1"
                max="1440"
                placeholder="Minutes"
                className="w-full rounded-2xl border border-blue-100 px-4 py-2 outline-none transition-colors focus:border-[#0c9de8] focus:ring-4 focus:ring-[#0c9de8]/10 sm:w-36"
              />
            </label>
          </fieldset>

          {errorMessage && <p className="text-sm font-semibold text-red-600">{errorMessage}</p>}

          <button type="submit" className="w-full rounded-2xl bg-[#0c9de8] px-4 py-3 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/20 transition-colors hover:bg-blue-600">
            Unlock
          </button>
        </form>

        <p className="px-6 pb-6 text-xs font-semibold text-slate-500">
          Shareable list: <Link href="/check/check/channels" className="font-black text-[#0c9de8] underline">/check/check/channels</Link>
        </p>
      </section>
    </main>
  );
}
