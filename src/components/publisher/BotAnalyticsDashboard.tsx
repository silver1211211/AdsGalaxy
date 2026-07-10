"use client";

import { useEffect, useState } from "react";
import { ChartColumn } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type Data = { summary: { impressions: number; earnings: number; spend: number; publisher_cpm: number; successful_deliveries: number; failed_deliveries: number }; daily_rows: Array<{ date: string; impressions: number; earnings: number; publisher_cpm: number; successful_deliveries: number; failed_deliveries: number }> };
const ranges = [1, 7, 30];
const money = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0.00";
  return `$${amount.toFixed(amount > 0 && amount < 1 ? 4 : 2)}`;
};

export default function BotAnalyticsDashboard({ botId }: { botId: number | string }) {
  const [range, setRange] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => { let cancelled = false; apiFetch(`/api/publisher/bots/${botId}/analytics?range=${range}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((value) => { if (!cancelled) setData(value); }); return () => { cancelled = true; }; }, [botId, range]);
  const summary = data?.summary;
  return <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500"><ChartColumn size={16} /></span><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Performance</p></div>
    <div className="space-y-4 p-4"><div className="flex w-max gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">{ranges.map((value) => <button key={value} type="button" onClick={() => setRange(value)} className={cn("rounded px-2.5 py-1.5 text-[10px] font-black", range === value ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500")}>{value === 1 ? "Today" : `Last ${value} Days`}</button>)}</div>
      <div className="grid grid-cols-3 gap-2.5">{[["Impressions", summary?.impressions?.toLocaleString() || "0"], ["Earnings", money(summary?.earnings || 0)], ["Avg. CPM", money(summary?.publisher_cpm || 0)]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p><p className="mt-1.5 text-base font-black text-slate-900">{value}</p></div>)}</div>
      <div className="max-h-72 overflow-auto rounded-xl border border-slate-100"><table className="w-full min-w-[360px] text-left text-[11px]"><thead className="sticky top-0 bg-slate-50"><tr>{["Date", "Impressions", "CPM", "Earned"].map((label) => <th key={label} className="px-3 py-2.5 text-center font-black uppercase tracking-widest text-slate-400">{label}</th>)}</tr></thead><tbody>{(data?.daily_rows || []).slice().reverse().map((row) => <tr key={row.date} className="border-t border-slate-50"><td className="px-3 py-2.5 font-bold text-slate-700">{row.date}</td><td className="px-3 py-2.5 text-center font-bold">{row.impressions.toLocaleString()}</td><td className="px-3 py-2.5 text-center font-bold">{money(row.publisher_cpm)}</td><td className="px-3 py-2.5 text-center font-bold text-emerald-600">{money(row.earnings)}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}
