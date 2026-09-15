"use client";

import React from "react";
import { BarChart3, CalendarDays, DollarSign, Eye, MousePointer2, RefreshCw, TrendingUp, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SkeletonChart, SkeletonStatGrid } from "@/components/ui/Skeleton";
import { useTranslations } from "@/i18n/client";

type RangeKey = "today" | "yesterday" | "7d" | "14d" | "30d" | "custom";
type CampaignType = "views" | "clicks";
type MetricSummary = { views: number; clicks: number; ctr: number; spend: number };
type CampaignStatistics = {
  campaign_type: CampaignType;
  primary_metric: "views" | "clicks";
  range: { key: RangeKey | "all"; from: string | null; to: string; bounded_to: number };
  totals: MetricSummary & { subscribers?: number; effective_cpm: number; average_cpc: number };
  teaser_enabled: boolean;
  source_breakdown: { standard: MetricSummary; teaser: MetricSummary };
  daily_rows: Array<MetricSummary & { subscribers?: number; date: string; effective_cpm: number; average_cpc: number; cost_metric: number }>;
  data_available: boolean;
};
type Selection = { key: RangeKey; from?: string; to?: string };

const PRESETS: Exclude<RangeKey, "custom">[] = ["today", "yesterday", "7d", "14d", "30d"];

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function money(value: unknown) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function costMoney(value: unknown) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(3)}`;
}

function count(value: unknown) {
  const amount = Number(value);
  return Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString();
}

function percent(value: unknown) {
  const amount = Number(value);
  return `${(Number.isFinite(amount) ? amount : 0).toFixed(2)}%`;
}

function shortDay(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function MetricCard({ icon: Icon, label, value, tone = "slate" }: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "slate" | "blue" | "green";
}) {
  const tones = {
    slate: "border-slate-100 bg-slate-50 text-slate-500",
    blue: "border-sky-100 bg-sky-50 text-sky-600",
    green: "border-emerald-100 bg-emerald-50 text-emerald-600",
  };
  return (
    <div className={cn("rounded-2xl border p-3.5", tones[tone])}>
      <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest"><Icon size={11} /> {label}</p>
      <p className="mt-1.5 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function PerformanceChart({ data, primary, growth = false }: { data: CampaignStatistics["daily_rows"]; primary: "views" | "clicks"; growth?: boolean }) {
  const { t } = useTranslations();
  const secondary = primary === "views" ? "clicks" : "views";
  const primaryMax = Math.max(1, ...data.map((row) => row[primary]));
  const secondaryMax = Math.max(1, ...data.map((row) => row[secondary]));
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">{t("advertiser.statistics.trend")}</p>
      <div className="mb-3 flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-slate-500">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-500" />{growth ? "SUB" : t(`advertiser.statistics.${primary}` as never)}</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-300" />{t(`advertiser.statistics.${secondary}` as never)}</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex h-40 w-full items-end gap-2" style={{ minWidth: `${Math.max(320, data.length * 34)}px` }}>
          {data.map((row) => (
            <div key={row.date} className="flex h-full min-w-6 flex-1 flex-col justify-end gap-1">
              <div className="flex h-28 items-end justify-center gap-1">
                <div className="w-2.5 rounded-t bg-sky-500" style={{ height: `${Math.max(row[primary] ? 5 : 1, (row[primary] / primaryMax) * 100)}%` }} />
                <div className="w-2.5 rounded-t bg-slate-300" style={{ height: `${Math.max(row[secondary] ? 5 : 1, (row[secondary] / secondaryMax) * 100)}%` }} />
              </div>
              <span className="whitespace-nowrap text-center text-[8px] font-bold text-slate-400">{shortDay(row.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CampaignStatisticsPanel({ campaignId, campaignType, campaignLabel, campaignKind = "channel" }: { campaignId: number; campaignType: CampaignType; campaignLabel: string; campaignKind?: "channel" | "miniapp" | "bot" | "growth" }) {
  const { t } = useTranslations();
  const todayKey = dateKey();
  const [selection, setSelection] = React.useState<Selection>({ key: "today" });
  const [draftFrom, setDraftFrom] = React.useState(todayKey);
  const [draftTo, setDraftTo] = React.useState(todayKey);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const [data, setData] = React.useState<CampaignStatistics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);

  const query = selection.key === "custom"
    ? `from=${encodeURIComponent(selection.from || todayKey)}&to=${encodeURIComponent(selection.to || todayKey)}`
    : `range=${selection.key}`;

  React.useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/advertiser/campaigns/${campaignId}/statistics?kind=${campaignKind}&${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) throw new Error("statistics_failed");
        setData(body);
        setError(false);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [campaignId, campaignKind, query, retryKey]);

  React.useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pickerOpen]);

  const choosePreset = (key: Exclude<RangeKey, "custom">) => {
    setLoading(true);
    setSelection({ key });
    setError(false);
    setPickerOpen(false);
  };

  const chooseCustom = () => {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    setLoading(true);
    setSelection({ key: "custom", from: draftFrom, to: draftTo });
    setError(false);
    setPickerOpen(false);
  };

  const retry = () => {
    setLoading(true);
    setError(false);
    setRetryKey((value) => value + 1);
  };

  const periodLabel = selection.key === "custom"
    ? `${shortDay(selection.from || todayKey)} – ${shortDay(selection.to || todayKey)}`
    : t(`advertiser.statistics.range.${selection.key}` as never);
  const totals = data?.totals;
  const primary = data?.primary_metric || (campaignType === "clicks" ? "clicks" : "views");
  const secondary = primary === "views" ? "clicks" : "views";
  const primaryLabel = campaignKind === "growth" ? "SUB" : t(`advertiser.statistics.${primary}` as never);
  const costLabel = campaignKind === "growth" ? t("growth.cps") : campaignType === "views" ? t("advertiser.statistics.effectiveCpm") : t("advertiser.statistics.averageCpc");
  const costValue = campaignType === "views" ? totals?.effective_cpm : totals?.average_cpc;
  const latestAllowedEnd = draftFrom && addDays(draftFrom, 29) < todayKey ? addDays(draftFrom, 29) : todayKey;

  return (
    <section className="space-y-4" aria-label={t("advertiser.statistics.title")}>
      <div ref={pickerRef} className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 size={16} className="shrink-0 text-sky-500" />
          <div className="min-w-0"><p className="truncate text-[9px] font-black uppercase tracking-widest text-sky-600">{campaignLabel}</p><h3 className="truncate text-xs font-black uppercase tracking-widest text-slate-500">{t("advertiser.statistics.title")}</h3></div>
        </div>
        <button type="button" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen} className="inline-flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 shadow-sm">
          <CalendarDays size={14} className="text-sky-500" /><span className="max-w-32 truncate">{periodLabel}</span>
        </button>

        {pickerOpen && (
          <div className="absolute right-0 top-full z-30 mt-2 w-[min(340px,calc(100vw-48px))] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">{t("advertiser.statistics.presets")}</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PRESETS.map((key) => (
                <button key={key} type="button" onClick={() => choosePreset(key)} className={cn("rounded-lg px-2.5 py-2 text-left text-[10px] font-bold", selection.key === key ? "bg-sky-100 text-sky-700" : "bg-slate-50 text-slate-600 hover:bg-slate-100")}>
                  {t(`advertiser.statistics.range.${key}` as never)}
                </button>
              ))}
            </div>
            <div className="my-3 h-px bg-slate-100" />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                {t("advertiser.statistics.startDate")}
                <input type="date" value={draftFrom} max={todayKey} onChange={(event) => {
                  const next = event.target.value;
                  setDraftFrom(next);
                  if (draftTo < next || draftTo > addDays(next, 29)) setDraftTo(next);
                }} className="block w-full rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-bold text-slate-700" />
              </label>
              <label className="space-y-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                {t("advertiser.statistics.endDate")}
                <input type="date" value={draftTo} min={draftFrom} max={latestAllowedEnd} onChange={(event) => setDraftTo(event.target.value)} className="block w-full rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-bold text-slate-700" />
              </label>
            </div>
            <button type="button" onClick={chooseCustom} className="mt-3 w-full rounded-xl bg-sky-500 px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-white">{t("advertiser.statistics.applyRange")}</button>
          </div>
        )}
      </div>

      {error && !loading ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-700">{t("advertiser.statistics.error")}</p>
          <button type="button" onClick={retry} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-red-700 shadow-sm"><RefreshCw size={13} /> {t("common.retry")}</button>
        </div>
      ) : loading && !data ? (
        <div className="space-y-4"><SkeletonStatGrid count={5} /><SkeletonChart /></div>
      ) : data ? (
        <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <MetricCard icon={campaignKind === "growth" ? UserPlus : primary === "views" ? Eye : MousePointer2} label={primaryLabel} value={count(campaignKind === "growth" ? totals?.subscribers : totals?.[primary])} tone="blue" />
            <MetricCard icon={primary === "views" ? MousePointer2 : Eye} label={t(`advertiser.statistics.${secondary}` as never)} value={count(totals?.[secondary])} />
            <MetricCard icon={TrendingUp} label={t("advertiser.statistics.ctr")} value={percent(totals?.ctr)} />
            <MetricCard icon={DollarSign} label={t("advertiser.statistics.spend")} value={money(totals?.spend)} tone="green" />
            <MetricCard icon={TrendingUp} label={costLabel} value={costMoney(costValue)} />
          </div>

          {!loading && data.data_available && data.daily_rows.some((row) => row.views > 0 || row.clicks > 0 || row.spend > 0) ? (
            <>
              <PerformanceChart data={data.daily_rows} primary={primary} growth={campaignKind === "growth"} />
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t("advertiser.statistics.dailyPerformance")}</p>
                <div className="max-h-72 overflow-auto rounded-2xl border border-slate-100">
                  <table className="w-full min-w-[560px] text-left text-[11px]">
                    <thead className="sticky top-0 bg-slate-50 text-slate-400"><tr>
                      {[t("advertiser.statistics.date"), campaignKind === "growth" ? "SUB" : t("advertiser.statistics.views"), t("advertiser.statistics.clicks"), t("advertiser.statistics.ctr"), t("advertiser.statistics.spend"), costLabel].map((label) => <th key={label} className="px-3 py-2.5 font-black uppercase tracking-wider">{label}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {[...data.daily_rows].reverse().map((row) => (
                        <tr key={row.date} className="even:bg-slate-50/50">
                          <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-700">{shortDay(row.date)}</td>
                          <td className="px-3 py-2.5 font-bold">{count(campaignKind === "growth" ? row.subscribers : row.views)}</td>
                          <td className="px-3 py-2.5 font-bold">{count(row.clicks)}</td>
                          <td className="px-3 py-2.5 font-bold">{percent(row.ctr)}</td>
                          <td className="px-3 py-2.5 font-bold text-emerald-600">{money(row.spend)}</td>
                          <td className="px-3 py-2.5 font-bold">{costMoney(row.cost_metric)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : !loading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">{t("advertiser.statistics.empty")}</div>
          ) : <SkeletonChart />}

        </div>
      ) : null}
    </section>
  );
}
