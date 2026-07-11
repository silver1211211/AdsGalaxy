"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChartColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { SkeletonChart, SkeletonStatGrid } from "@/components/ui/Skeleton";
import { hasMinimumCpcSample } from "@/lib/statFormulas";

type DateMode = "today" | "yesterday" | "7d" | "30d";

const DATE_MODE_OPTIONS: Array<{ mode: DateMode; label: string }> = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "7d", label: "Last 7 Days" },
  { mode: "30d", label: "Last 30 Days" },
];

type DailyRow = {
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  publisher_revenue: number;
  net_cpm: number;
  fill_rate: number | null;
};

type MiniAppReport = {
  summary: {
    today_impressions: number;
    yesterday_impressions: number;
    today_revenue: number;
    total_impressions: number;
    total_clicks: number;
    ctr: number;
    cpc: number;
    total_earnings: number;
    average_cpm: number;
  };
  daily: DailyRow[];
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoKey(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function resolveRange(mode: DateMode) {
  if (mode === "today") return { start: todayKey(), end: todayKey() };
  if (mode === "yesterday") { const key = daysAgoKey(1); return { start: key, end: key }; }
  if (mode === "30d") return { start: daysAgoKey(29), end: todayKey() };
  return { start: daysAgoKey(6), end: todayKey() };
}

function formatMoney(value: number) {
  const abs = Math.abs(value);
  return `$${value.toFixed(abs > 0 && abs < 1 ? 4 : 2)}`;
}

function roundedDisplayMoneyValue(value: number) {
  const abs = Math.abs(value);
  return Number(value.toFixed(abs > 0 && abs < 1 ? 4 : 2));
}

function formatRate(value: number, sample: number, kind: "cpm" | "cpc") {
  const confident = kind === "cpm" ? sample > 0 && value > 0 : hasMinimumCpcSample(sample);
  return confident ? formatMoney(value) : "--";
}

function formatDisplayedCpmFromRevenue(revenue: number, impressions: number) {
  if (impressions <= 0 || revenue <= 0) return "--";
  return formatMoney((roundedDisplayMoneyValue(revenue) / impressions) * 1000);
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

interface MiniAppAnalyticsDashboardProps {
  miniappId: number | string;
}

export default function MiniAppAnalyticsDashboard({ miniappId }: MiniAppAnalyticsDashboardProps) {
  const [dateMode, setDateMode] = useState<DateMode>("7d");
  const [data, setData] = useState<MiniAppReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { start, end } = resolveRange(dateMode);
    apiFetch(`/api/publisher/miniapps/${miniappId}/report?start=${start}&end=${end}`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => null);
        if (!response.ok) throw new Error(json?.error || "Failed to load analytics");
        if (!cancelled) setData(json);
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [miniappId, dateMode]);

  const summary = data?.summary;
  const dailyDesc = data?.daily || [];
  const dailyAsc = useMemo(
    () => [...(data?.daily || [])].sort((a, b) => a.date.localeCompare(b.date)),
    [data]
  );
  const normalizedImpressions = useMemo(
    () => normalize(dailyAsc.map((row) => row.impressions)),
    [dailyAsc]
  );

  const width = 100;
  const height = 40;
  const stepX = normalizedImpressions.length > 1 ? width / (normalizedImpressions.length - 1) : 0;
  const points = normalizedImpressions.map((value, index) => `${(index * stepX).toFixed(2)},${(height - value * height).toFixed(2)}`);
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
          <AnimatePresence mode="wait">
            <motion.div
              key={dateMode}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="space-y-4"
            >
            <div>
              <SectionLabel>Selected Period</SectionLabel>
              <div className="grid grid-cols-3 gap-2.5">
                <StatTile label="Impressions" value={formatNumber(summary?.total_impressions ?? 0)} />
                <StatTile label="Revenue" value={formatMoney(summary?.total_earnings ?? 0)} />
                <StatTile label="Avg. CPM" value={formatRate(summary?.average_cpm ?? 0, summary?.total_impressions ?? 0, "cpm")} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 p-3.5 transition-colors duration-200 hover:border-slate-200">
              <SectionLabel>Impressions Trend</SectionLabel>
              <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-32 w-full overflow-visible">
                <defs>
                  <linearGradient id="miniapp-impressions-trend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#miniapp-impressions-trend)" stroke="none" />
                <path d={linePath} fill="none" stroke="#10b981" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {dailyAsc.length > 0 && (
                <div className="flex items-center justify-between text-[9px] font-bold text-slate-400">
                  <span>{formatDayLabel(dailyAsc[0].date)}</span>
                  {dailyAsc.length > 2 && <span>{formatDayLabel(dailyAsc[Math.floor((dailyAsc.length - 1) / 2)].date)}</span>}
                  <span>{formatDayLabel(dailyAsc[dailyAsc.length - 1].date)}</span>
                </div>
              )}
            </div>

            <div>
              <SectionLabel>Daily Breakdown</SectionLabel>
              <div className="max-h-72 overflow-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[620px] text-left text-[11px]">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b border-slate-100">
                      <th className="whitespace-nowrap px-3 py-2.5 font-black uppercase tracking-widest text-slate-500">Date</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">Impressions</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">Clicks</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">CPM</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">CPC</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">CTR %</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">Fill Rate %</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-500">Earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {dailyDesc.map((row) => (
                      <tr key={row.date} className="transition-colors duration-150 odd:bg-white even:bg-slate-50/60 hover:bg-emerald-50/50">
                        <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-700">{formatFullDate(row.date)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatNumber(row.impressions)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatNumber(row.clicks || 0)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatDisplayedCpmFromRevenue(row.publisher_revenue, row.impressions)}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{formatRate(row.cpc || 0, row.clicks || 0, "cpc")}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">{(row.ctr || 0).toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">
                          {row.fill_rate === null ? <span className="text-slate-300">—</span> : `${row.fill_rate.toFixed(1)}%`}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-emerald-600">{formatMoney(row.publisher_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
