"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChartColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { SkeletonChart, SkeletonStatGrid } from "@/components/ui/Skeleton";
import { hasMinimumCpcSample, hasMinimumCpmSample } from "@/lib/statFormulas";

type AnalyticsSummary = {
  earnings: number;
  views: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
};

type AnalyticsTrend = {
  labels: string[];
  earnings: number[];
  views: number[];
  clicks: number[];
};

type DailyRow = {
  date: string;
  views: number;
  clicks: number;
  ctr: number;
  earnings: number;
  effective_publisher_cpm: number;
  effective_publisher_cpc: number;
};

type ChannelAnalytics = {
  range_days: number;
  summary: AnalyticsSummary;
  trend: AnalyticsTrend;
  daily_rows?: DailyRow[];
  data_available: boolean;
};

type DateMode = "today" | "yesterday" | "7d" | "30d";

const DATE_MODE_OPTIONS: Array<{ mode: DateMode; label: string }> = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "7d", label: "Last 7 Days" },
  { mode: "30d", label: "Last 30 Days" },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function resolveModeQuery(mode: DateMode) {
  if (mode === "today") { const key = todayKey(); return `from=${key}&to=${key}`; }
  if (mode === "yesterday") { const key = yesterdayKey(); return `from=${key}&to=${key}`; }
  if (mode === "30d") return `range=30`;
  return `range=7`;
}

function formatMoney(value: number) {
  const abs = Math.abs(value);
  return `$${value.toFixed(abs > 0 && abs < 1 ? 4 : 2)}`;
}

function formatRate(value: number, sample: number, kind: "cpm" | "cpc") {
  const confident = kind === "cpm" ? hasMinimumCpmSample(sample) : hasMinimumCpcSample(sample);
  return confident ? formatMoney(value) : "--";
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString();
}

function formatDayLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

function formatFullDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${month}/${day}/${year}`;
}

function normalize(values: number[]) {
  const max = Math.max(1e-9, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1e-9, max - min);
  return values.map((value) => (value - min) / span);
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 transition-colors duration-200 hover:border-slate-200 hover:bg-slate-100/70">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1.5 text-base font-black text-slate-900">{value}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{children}</p>;
}

interface ChannelAnalyticsDashboardProps {
  channelId: number | string;
  onSubscriberCount?: (count: number) => void;
}

export default function ChannelAnalyticsDashboard({ channelId, onSubscriberCount }: ChannelAnalyticsDashboardProps) {
  const [dateMode, setDateMode] = useState<DateMode>("today");
  const [data, setData] = useState<ChannelAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = resolveModeQuery(dateMode);
    apiFetch(`/api/publisher/channels/${channelId}/analytics?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => null);
        if (!response.ok) throw new Error(json?.error || "Failed to load analytics");
        if (!cancelled) {
          setData(json);
          if (Number.isFinite(Number(json.subscriber_count))) onSubscriberCount?.(Number(json.subscriber_count));
        }
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [channelId, dateMode, onSubscriberCount]);

  const summary = data?.summary;
  const trend = data?.trend;
  const dailyRowsDesc = useMemo(
    () => [...(data?.daily_rows || [])].sort((a, b) => b.date.localeCompare(a.date)),
    [data]
  );
  const normalizedViews = useMemo(
    () => normalize(trend?.views || []),
    [trend]
  );

  const width = 100;
  const height = 40;
  const stepX = normalizedViews.length > 1 ? width / (normalizedViews.length - 1) : 0;
  const points = normalizedViews.map((value, index) => `${(index * stepX).toFixed(2)},${(height - value * height).toFixed(2)}`);
  const linePath = points.length > 0 ? `M${points.join(" L")}` : `M0,${height} L${width},${height}`;
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500 ring-1 ring-inset ring-emerald-100">
          <ChartColumn size={16} />
        </span>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Performance</p>
      </div>

      <div className="space-y-4 p-4">
        {/* ── Date selector ── */}
        <div className="overflow-x-auto">
          <div className="flex w-max items-center gap-1 rounded-lg border border-slate-200/70 bg-slate-100 p-0.5">
            {DATE_MODE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => setDateMode(option.mode)}
                className={cn(
                  "whitespace-nowrap rounded px-2.5 py-1.5 text-[10px] font-black transition-all duration-200",
                  dateMode === option.mode ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <SkeletonStatGrid count={3} />
            <SkeletonChart />
          </div>
        ) : (
          <>
            <div>
              <SectionLabel>Selected Period</SectionLabel>
              <div className="grid grid-cols-3 gap-2.5">
                <StatTile label="Impressions" value={formatNumber(summary?.views ?? 0)} />
                <StatTile label="Revenue" value={formatMoney(summary?.earnings ?? 0)} />
                <StatTile label="Avg. CPM" value={formatRate(summary?.cpm ?? 0, summary?.views ?? 0, "cpm")} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 p-3.5 transition-colors duration-200 hover:border-slate-200">
              <SectionLabel>Impressions Trend</SectionLabel>
              <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-32 w-full overflow-visible">
                <defs>
                  <linearGradient id="channel-impressions-trend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#channel-impressions-trend)" stroke="none" />
                <path d={linePath} fill="none" stroke="#10b981" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {(trend?.labels?.length || 0) > 0 && (
                <div className="flex items-center justify-between text-[9px] font-bold text-slate-400">
                  <span>{formatDayLabel(trend!.labels[0])}</span>
                  {trend!.labels.length > 2 && <span>{formatDayLabel(trend!.labels[Math.floor((trend!.labels.length - 1) / 2)])}</span>}
                  <span>{formatDayLabel(trend!.labels[trend!.labels.length - 1])}</span>
                </div>
              )}
            </div>

            <div>
              <SectionLabel>Daily Breakdown</SectionLabel>
              <div className="max-h-72 overflow-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[560px] text-left text-[11px]">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b border-slate-100">
                      <th className="whitespace-nowrap px-3 py-2.5 font-black uppercase tracking-widest text-slate-400">Date</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">Impressions</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">Clicks</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">CPM</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">CPC</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">CTR %</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">Earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {dailyRowsDesc.map((row) => (
                      <tr key={row.date} className="transition-colors duration-150 odd:bg-white even:bg-slate-50/60 hover:bg-emerald-50/50">
                        <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-700">{formatFullDate(row.date)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatNumber(row.views)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatNumber(row.clicks)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatRate(row.effective_publisher_cpm, row.views, "cpm")}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatRate(row.effective_publisher_cpc, row.clicks, "cpc")}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{row.ctr.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-center font-bold text-emerald-600">{formatMoney(row.earnings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
