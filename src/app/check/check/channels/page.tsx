import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Clock3, ExternalLink, KeyRound, LockKeyhole, Radio, ShieldCheck, Users } from "lucide-react";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { decryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import {
  formatCountdown,
  getChannelCheckUnlockState,
  unlockChannelCheck,
  verifyTemporaryChannelCheckPassword,
} from "@/lib/channelCheckAccess";
import Countdown from "@/components/check/Countdown";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const HIGH_REACH_SUBSCRIBERS = 10_000;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type ChannelColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type ChannelRow = RowDataPacket & {
  id: number;
  title: string | null;
  username: string | null;
  status: string;
  channel_type?: string | null;
  private_invite_link_encrypted?: string | null;
  subscriber_count?: number | null;
  subscribers?: number | null;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pageNumber(input: unknown) {
  const parsed = Number.parseInt(String(input || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function rateLimitKey() {
  const headerList = await headers();
  return (
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headerList.get("x-real-ip")
    || "unknown"
  );
}

async function getChannelColumns() {
  const [rows] = await pool.query<ChannelColumnRow[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'channels'
       AND COLUMN_NAME IN ('title', 'name', 'username', 'subscriber_count', 'subscribers', 'health_status', 'channel_type', 'private_invite_link_encrypted')`
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getChannels(page: number) {
  const columns = await getChannelColumns();
  const titleExpr = columns.has("title")
    ? "c.title"
    : columns.has("name")
      ? "c.name"
      : "CONCAT('Channel ', c.id)";
  const subscriberExpr = columns.has("subscriber_count")
    ? "c.subscriber_count"
    : columns.has("subscribers")
      ? "c.subscribers"
      : "NULL";
  const healthFilter = columns.has("health_status")
    ? "AND COALESCE(c.health_status, 'healthy') IN ('healthy','warning')"
    : "";
  const channelTypeExpr = columns.has("channel_type") ? "c.channel_type" : "'public'";
  const privateInviteExpr = columns.has("private_invite_link_encrypted") ? "c.private_invite_link_encrypted" : "NULL";

  const [[countRow]]: any = await pool.query(
    `SELECT COUNT(*) as total
     FROM channels c
     WHERE c.status = 'active'
       AND c.is_deleted = FALSE
       ${healthFilter}`
  );

  const total = Number(countRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const [allRows] = await pool.query<ChannelRow[]>(
    `SELECT
       c.id,
       ${titleExpr} as title,
       c.username,
       ${channelTypeExpr} as channel_type,
       ${privateInviteExpr} as private_invite_link_encrypted,
       c.status,
       ${subscriberExpr} as subscriber_count
     FROM channels c
     WHERE c.status = 'active'
       AND c.is_deleted = FALSE
       ${healthFilter}
     ORDER BY COALESCE(${subscriberExpr}, 0) DESC, COALESCE(${titleExpr}, ''), c.id ASC`
  );

  const orderedRows = distributeReachAcrossPages(allRows, totalPages);
  const rows = orderedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return { rows, total, totalPages, currentPage };
}

function subscriberCount(channel: ChannelRow) {
  return Number(channel.subscriber_count ?? channel.subscribers ?? 0) || 0;
}

function distributeEvenly<T>(items: T[], pageCount: number, pageSize: number) {
  const pages = Array.from({ length: pageCount }, () => [] as T[]);
  if (items.length === 0 || pageCount <= 0) return pages;

  items.forEach((item, index) => {
    const preferredPage = Math.min(pageCount - 1, Math.floor((index * pageCount) / items.length));
    let targetPage = preferredPage;

    for (let offset = 0; offset < pageCount; offset += 1) {
      const candidate = (preferredPage + offset) % pageCount;
      if (pages[candidate].length < pageSize) {
        targetPage = candidate;
        break;
      }
    }

    pages[targetPage].push(item);
  });

  return pages;
}

function distributeReachAcrossPages(rows: ChannelRow[], totalPages: number) {
  if (totalPages <= 1) return rows;

  const highReach = rows
    .filter((channel) => subscriberCount(channel) >= HIGH_REACH_SUBSCRIBERS)
    .sort((a, b) => subscriberCount(b) - subscriberCount(a) || String(a.title || "").localeCompare(String(b.title || "")));
  const regular = rows
    .filter((channel) => subscriberCount(channel) < HIGH_REACH_SUBSCRIBERS)
    .sort((a, b) => subscriberCount(b) - subscriberCount(a) || String(a.title || "").localeCompare(String(b.title || "")));

  const firstWindowPages = Math.max(1, Math.ceil(totalPages * 0.6));
  const lastWindowPages = Math.max(0, totalPages - firstWindowPages);
  const earlyHighSlotsPerPage = Math.max(1, Math.floor(PAGE_SIZE * 0.8));
  const firstHighCount = Math.min(Math.ceil(highReach.length * 0.8), firstWindowPages * earlyHighSlotsPerPage);
  const firstHigh = highReach.slice(0, firstHighCount);
  const lastHigh = highReach.slice(firstHighCount);
  const pages = Array.from({ length: totalPages }, () => [] as ChannelRow[]);

  const firstHighPages = distributeEvenly(firstHigh, firstWindowPages, earlyHighSlotsPerPage);
  firstHighPages.forEach((pageRows, index) => {
    pages[index].push(...pageRows);
  });

  if (lastWindowPages > 0) {
    const lastHighPages = distributeEvenly(lastHigh, lastWindowPages, PAGE_SIZE);
    lastHighPages.forEach((pageRows, index) => {
      pages[firstWindowPages + index].push(...pageRows);
    });
  } else {
    pages[0].push(...lastHigh);
  }

  let regularIndex = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    while (pages[pageIndex].length < PAGE_SIZE && regularIndex < regular.length) {
      pages[pageIndex].push(regular[regularIndex]);
      regularIndex += 1;
    }
    pages[pageIndex].sort((a, b) => {
      const aHigh = subscriberCount(a) >= HIGH_REACH_SUBSCRIBERS ? 1 : 0;
      const bHigh = subscriberCount(b) >= HIGH_REACH_SUBSCRIBERS ? 1 : 0;
      return bHigh - aHigh || subscriberCount(b) - subscriberCount(a) || Number(a.id) - Number(b.id);
    });
  }

  while (regularIndex < regular.length) {
    pages[pages.length - 1].push(regular[regularIndex]);
    regularIndex += 1;
  }

  return pages.flat();
}

function publicUrl(username: string | null) {
  const cleaned = String(username || "").trim().replace(/^@/, "");
  if (!cleaned) return null;
  return `https://t.me/${encodeURIComponent(cleaned)}`;
}

function channelUrl(channel: ChannelRow) {
  if (String(channel.channel_type || "public") === "private") {
    return decryptPrivateInviteLink(channel.private_invite_link_encrypted);
  }

  return publicUrl(channel.username);
}

async function unlockFromChannels(formData: FormData) {
  "use server";

  const password = String(formData.get("password") || "");
  const duration = String(formData.get("duration_minutes") || "60");
  const verification = await verifyTemporaryChannelCheckPassword(password, await rateLimitKey());

  if (!verification.ok) {
    redirect(`/check/check/channels?error=${verification.rateLimited ? "rate_limited" : "invalid"}`);
  }

  await unlockChannelCheck(duration, verification.adminId);
  redirect("/check/check/channels?unlocked=1");
}

function LockedForm({ error, durationMinutes }: { error?: string; durationMinutes: number }) {
  const message = error === "rate_limited"
    ? "Too many failed attempts. Please wait and try again."
    : error === "invalid"
      ? "Incorrect password."
      : "";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7fbff_0%,#eaf7ff_46%,#ffffff_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto max-w-md overflow-hidden rounded-[2rem] border border-blue-100 bg-white shadow-2xl shadow-blue-100/60">
        <div className="bg-[linear-gradient(135deg,#0c9de8_0%,#0b7ec9_56%,#075d9b_100%)] px-6 py-7 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/20">
              <LockKeyhole size={21} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-100">Temporary access</p>
              <h1 className="mt-1 text-2xl font-black">AdsGalaxy Channel Check</h1>
            </div>
          </div>
          <p className="mt-5 text-sm font-semibold leading-6 text-blue-50">
            Enter the admin password to open this shareable active-channel list globally for the configured time.
          </p>
        </div>

        <form action={unlockFromChannels} className="space-y-4 p-6">
          <input type="hidden" name="duration_minutes" value={durationMinutes} />
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
          {message && <p className="text-sm font-semibold text-red-600">{message}</p>}
          <button type="submit" className="w-full rounded-2xl bg-[#0c9de8] px-4 py-3 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/20 transition-colors hover:bg-blue-600">
            Unlock Channel List
          </button>
        </form>

        <p className="px-6 pb-6 text-xs font-semibold text-slate-500">
          Need a custom duration? Use <Link href="/check/check/time" className="font-black text-[#0c9de8] underline">unlock control</Link>.
        </p>
      </section>
    </main>
  );
}

function pageHref(page: number) {
  return `/check/check/channels?page=${page}`;
}

function pageNumbers(currentPage: number, totalPages: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export default async function ChannelCheckPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const unlockState = await getChannelCheckUnlockState();
  const error = firstParam(params.error);

  if (!unlockState.isUnlocked) {
    return <LockedForm error={error} durationMinutes={unlockState.durationMinutes} />;
  }

  const requestedPage = pageNumber(firstParam(params.page));
  const { rows, total, totalPages, currentPage } = await getChannels(requestedPage);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7fbff_0%,#eaf7ff_42%,#ffffff_100%)] px-3 py-3 text-slate-950 sm:px-4 sm:py-6">
      <section className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-[1.5rem] border border-blue-100 bg-white shadow-xl shadow-blue-100/50 sm:rounded-[2rem] sm:shadow-2xl sm:shadow-blue-100/60">
          <div className="bg-[linear-gradient(135deg,#0c9de8_0%,#0b7ec9_58%,#075d9b_100%)] p-4 text-white sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-blue-50 ring-1 ring-white/15 sm:gap-2 sm:px-3 sm:text-[10px] sm:tracking-[0.22em]">
                  <ShieldCheck size={13} />
                  Temporary access
                </p>
                <h1 className="mt-3 text-2xl font-black leading-tight tracking-tight sm:mt-4 sm:text-3xl">AdsGalaxy Channel Check</h1>
                <p className="mt-2 max-w-2xl text-xs font-semibold leading-5 text-blue-50 sm:text-sm sm:leading-6">
                  A live read-only view of active AdsGalaxy channels with links available during this temporary unlock.
                </p>
              </div>
              <div className="rounded-2xl bg-white/12 px-3 py-2.5 text-sm ring-1 ring-white/15 sm:px-4 sm:py-3">
                <span className="flex items-center gap-2 text-xs font-semibold text-blue-50 sm:text-sm">
                  <Clock3 size={15} />
                  Access expires in
                </span>
                <span className="mt-1 block text-xl font-black tabular-nums text-white sm:text-2xl">
                  <Countdown untilMs={unlockState.unlockedUntilMs} />
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-blue-50 p-3 sm:grid-cols-3 sm:gap-3 sm:p-5">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-[#0c9de8] sm:gap-2 sm:text-xs"><Radio size={13} /> Active</p>
              <p className="mt-1.5 text-xl font-black sm:mt-2 sm:text-2xl">{total.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-white p-3 sm:p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 sm:text-xs">Page</p>
              <p className="mt-1.5 text-xl font-black sm:mt-2 sm:text-2xl">{currentPage}<span className="text-sm text-slate-400 sm:text-base"> / {totalPages}</span></p>
            </div>
            <div className="col-span-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 sm:col-span-1 sm:p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-emerald-700 sm:gap-2 sm:text-xs"><ShieldCheck size={13} /> Moderation view</p>
              <p className="mt-1.5 text-xs font-bold text-emerald-800 sm:mt-2 sm:text-sm">Private URLs available until expiry</p>
            </div>
          </div>

          <div className="px-3 pt-3 text-xs font-medium text-slate-600 sm:px-5 sm:pt-4 sm:text-sm">
            Showing page <span className="font-black text-slate-950">{currentPage}</span> of{" "}
            <span className="font-black text-slate-950">{totalPages}</span>
          </div>

        <div className="p-3 sm:p-5">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 text-sm font-medium text-slate-600">No active channels found.</div>
          ) : (
            <ul className="space-y-2.5 sm:space-y-3">
              {rows.map((channel) => {
                const href = channelUrl(channel);
                const isPrivate = String(channel.channel_type || "public") === "private";
                const isHighReach = subscriberCount(channel) >= HIGH_REACH_SUBSCRIBERS;
                return (
                  <li key={channel.id} className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm shadow-blue-50 transition-colors hover:border-[#0c9de8]/40 hover:bg-blue-50/30 sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#0c9de8] sm:h-11 sm:w-11">
                            <Radio size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-base font-black">{channel.title || "Untitled channel"}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <p className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Active
                              </p>
                              {isHighReach && (
                                <p className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-[#0c9de8]">
                                  <Users size={11} />
                                  High reach
                                </p>
                              )}
                              {isPrivate && (
                                <p className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">
                                  Private
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex min-w-0 shrink-0 flex-col gap-2 text-sm sm:items-end">
                        {href ? (
                          <>
                            <span className="max-w-full break-all rounded-xl bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-500 sm:max-w-xs sm:py-2 sm:text-xs">{href}</span>
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] px-4 py-2.5 text-xs font-black text-white shadow-lg shadow-[#0c9de8]/20 transition-colors hover:bg-blue-600"
                            >
                              <ExternalLink size={14} />
                              {isPrivate ? "Open private channel" : "View live channel"}
                            </a>
                          </>
                        ) : (
                          <span className="rounded-2xl bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-500 sm:py-2 sm:text-xs">Private channel - no stored URL</span>
                        )}
                        {channel.subscriber_count !== null && channel.subscriber_count !== undefined && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                            <Users size={13} />
                            {Number(channel.subscriber_count || 0).toLocaleString()} subscribers
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

        <nav className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm sm:mt-5 sm:justify-start" aria-label="Pagination">
          <Link
            href={pageHref(Math.max(1, currentPage - 1))}
            className={`rounded-2xl border px-4 py-2 font-black ${currentPage <= 1 ? "pointer-events-none border-blue-50 text-slate-300" : "border-blue-100 bg-white text-[#0c9de8] shadow-sm shadow-blue-50"}`}
          >
            Previous
          </Link>
          {pageNumbers(currentPage, totalPages).map((page) => (
            <Link
              key={page}
              href={pageHref(page)}
              className={`rounded-2xl border px-4 py-2 font-black ${page === currentPage ? "border-[#0c9de8] bg-[#0c9de8] text-white shadow-lg shadow-[#0c9de8]/20" : "border-blue-100 bg-white text-[#0c9de8] shadow-sm shadow-blue-50"}`}
            >
              {page}
            </Link>
          ))}
          <Link
            href={pageHref(Math.min(totalPages, currentPage + 1))}
            className={`rounded-2xl border px-4 py-2 font-black ${currentPage >= totalPages ? "pointer-events-none border-blue-50 text-slate-300" : "border-blue-100 bg-white text-[#0c9de8] shadow-sm shadow-blue-50"}`}
          >
            Next
          </Link>
        </nav>

        <p className="mt-4 text-[11px] font-semibold leading-5 text-slate-500 sm:text-xs">
          Server expiry: {unlockState.unlockedUntilIso ? new Date(unlockState.unlockedUntilIso).toLocaleString() : "Not set"}.
          Refresh after expiry to lock again. Initial remaining time: {formatCountdown(unlockState.remainingMs)}.
        </p>
        </div>
        </div>
      </section>
    </main>
  );
}
