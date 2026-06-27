"use client";

import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import { AlertTriangle, BarChart3, Bot, Download, FileSpreadsheet, FileText, Globe2, HeartPulse, Languages, Lightbulb, Loader2, PieChart, Smartphone, Target, TrendingDown, TrendingUp, Tv } from "lucide-react";

type GroupRow = {
  key: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  ctr: number;
  conversion_rate: number;
  cpa: number;
  roi: number;
  rating: string;
  inventory_type?: string;
};

type Intelligence = {
  range: { key: string; start: string; end: string; label: string };
  summary: {
    impressions: number;
    clicks: number;
    ctr: number;
    spend: number;
    conversions: number;
    conversion_rate: number;
    cpa: number;
    estimated_roi: number;
    health_score: number;
    health_tier: string;
    benchmark: string;
  };
  campaigns: Array<any>;
  breakdowns: {
    category: GroupRow[];
    country: GroupRow[];
    language: GroupRow[];
    creative: GroupRow[];
    top_categories: GroupRow[];
    worst_categories: GroupRow[];
    top_countries: GroupRow[];
    worst_countries: GroupRow[];
    highest_ctr_countries: GroupRow[];
    highest_conversion_countries: GroupRow[];
    top_languages: GroupRow[];
    worst_languages: GroupRow[];
    best_miniapps: GroupRow[];
    best_channels: GroupRow[];
    best_bots: GroupRow[];
  };
  recommendations: Array<{ type: string; severity: string; title: string; detail: string }>;
  alerts: Array<{ type: string; severity: string; title: string; detail: string }>;
  forecast: {
    expected_reach: number;
    expected_impressions: number;
    expected_clicks: number;
    expected_conversions: number;
  };
};

const ranges = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last_7_days", "Last 7 Days"],
  ["last_30_days", "Last 30 Days"],
  ["custom", "Custom"],
];

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function percent(value: unknown) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function healthColor(score: number) {
  if (score >= 81) return "bg-emerald-500";
  if (score >= 61) return "bg-blue-500";
  if (score >= 31) return "bg-amber-500";
  return "bg-red-500";
}

function ScoreCard({ title, value, icon: Icon, helper }: { title: string; value: string; icon: typeof BarChart3; helper?: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon size={20} /></div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
      <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
      {helper && <p className="mt-1 text-xs font-semibold text-slate-500">{helper}</p>}
    </div>
  );
}

function RankingList({ title, icon: Icon, rows }: { title: string; icon: typeof BarChart3; rows: GroupRow[] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Icon size={16} /> {title}</h3>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs font-semibold text-slate-400">No data yet.</p>
        ) : rows.map((row) => (
          <div key={`${title}-${row.key}`} className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-black text-slate-900">{row.key}</p>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600">{row.rating}</span>
            </div>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {numberValue(row.impressions)} impressions / {percent(row.ctr)} CTR / {numberValue(row.conversions)} conversions
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdvertiserIntelligencePage() {
  const { setTitle } = useHeader();
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("last_7_days");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [forecastBudget, setForecastBudget] = useState("100");
  const [forecastCpm, setForecastCpm] = useState("1");
  const [forecast, setForecast] = useState<Intelligence["forecast"] | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom") {
      if (start) params.set("start", start);
      if (end) params.set("end", end);
    }
    return params.toString();
  }, [range, start, end]);

  const fetchData = async () => {
    setLoading(true);
    const res = await apiFetch(`/api/advertiser/intelligence?${query}`);
    const json = await res.json();
    if (res.ok) {
      setData(json);
      setForecast(json.forecast);
    }
    setLoading(false);
  };

  useEffect(() => {
    setTitle("Campaign Intelligence");
  }, [setTitle]);

  useEffect(() => {
    fetchData();
  }, [query]);

  const runForecast = async () => {
    const res = await apiFetch(`/api/advertiser/intelligence?${query}`, {
      method: "POST",
      body: JSON.stringify({ budget: forecastBudget, cpm: forecastCpm }),
    });
    const json = await res.json();
    if (res.ok) setForecast(json.forecast);
  };

  const exportUrl = (format: string) => `/api/advertiser/intelligence?${query}&export=${format}`;

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-6 pb-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Campaign Intelligence Center</h1>
            <p className="text-sm font-semibold text-slate-500">Understand why performance changed and where to optimize next.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={exportUrl("csv")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600"><Download size={14} /> CSV</a>
            <a href={exportUrl("excel")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600"><FileSpreadsheet size={14} /> Excel</a>
            <a href={exportUrl("pdf")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600"><FileText size={14} /> PDF</a>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {ranges.map(([key, label]) => (
              <button key={key} onClick={() => setRange(key)} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wider ${range === key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>{label}</button>
            ))}
            {range === "custom" && (
              <>
                <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
              </>
            )}
          </div>
        </div>

        {loading || !data ? (
          <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={30} /></div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <ScoreCard title="Impressions" value={numberValue(data.summary.impressions)} icon={BarChart3} />
              <ScoreCard title="Clicks / CTR" value={`${numberValue(data.summary.clicks)} / ${percent(data.summary.ctr)}`} icon={Target} />
              <ScoreCard title="Spend" value={money(data.summary.spend)} icon={PieChart} />
              <ScoreCard title="Conversions" value={numberValue(data.summary.conversions)} icon={TrendingUp} helper={`${percent(data.summary.conversion_rate)} CVR`} />
              <ScoreCard title="CPA" value={money(data.summary.cpa)} icon={TrendingDown} />
              <ScoreCard title="Estimated ROI" value={percent(data.summary.estimated_roi)} icon={TrendingUp} />
              <ScoreCard title="Benchmark" value={data.summary.benchmark} icon={BarChart3} helper="Compared to similar campaigns, without competitor data." />
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2"><HeartPulse className="text-blue-600" size={20} /><span className="text-sm font-black text-slate-900">Campaign Health</span></div>
                <p className="text-3xl font-black text-slate-900">{data.summary.health_score}</p>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{data.summary.health_tier}</p>
                <div className="mt-3 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${healthColor(data.summary.health_score)}`} style={{ width: `${Math.min(data.summary.health_score, 100)}%` }} /></div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Lightbulb size={16} className="text-amber-500" /> Optimization Recommendations</h2>
                <div className="space-y-2">
                  {data.recommendations.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400">No recommendations yet.</p> : data.recommendations.map((item) => (
                    <div key={item.title} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-sm font-black text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><AlertTriangle size={16} className="text-red-500" /> Alerts</h2>
                <div className="space-y-2">
                  {data.alerts.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400">No active intelligence alerts.</p> : data.alerts.map((item) => (
                    <div key={item.title} className="rounded-xl bg-red-50 p-3">
                      <p className="text-sm font-black text-red-900">{item.title}</p>
                      <p className="mt-1 text-xs font-semibold text-red-700">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Lightbulb size={16} className="text-blue-500" /> Campaign Auto Insights</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {data.campaigns.length === 0 ? (
                  <p className="py-6 text-center text-xs font-semibold text-slate-400 lg:col-span-2">No campaigns in this range.</p>
                ) : data.campaigns.slice(0, 8).map((campaign) => (
                  <div key={`${campaign.campaign_type}-${campaign.campaign_id}`} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{campaign.name}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{campaign.type} / health {campaign.health_score}</p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600">{campaign.health_tier}</span>
                    </div>
                    <div className="mt-3 space-y-2 text-xs font-semibold leading-5 text-slate-600">
                      <p><span className="font-black text-slate-900">What changed:</span> {campaign.auto_insight?.changed}</p>
                      <p><span className="font-black text-slate-900">Why:</span> {campaign.auto_insight?.why}</p>
                      <p><span className="font-black text-slate-900">Next:</span> {campaign.auto_insight?.next}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-sm font-black text-slate-900">Budget Forecast</h2>
              <div className="grid gap-3 md:grid-cols-5">
                <input value={forecastBudget} onChange={(event) => setForecastBudget(event.target.value)} placeholder="Budget" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
                <input value={forecastCpm} onChange={(event) => setForecastCpm(event.target.value)} placeholder="CPM" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
                <button onClick={runForecast} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Forecast</button>
                <div className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600 md:col-span-2">Uses your historical performance, budget, CPM, and current targeting signals.</div>
              </div>
              {forecast && (
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <ScoreCard title="Reach" value={numberValue(forecast.expected_reach)} icon={Target} />
                  <ScoreCard title="Impressions" value={numberValue(forecast.expected_impressions)} icon={BarChart3} />
                  <ScoreCard title="Clicks" value={numberValue(forecast.expected_clicks)} icon={TrendingUp} />
                  <ScoreCard title="Conversions" value={numberValue(forecast.expected_conversions)} icon={HeartPulse} />
                </div>
              )}
            </section>

            <div className="grid gap-4 xl:grid-cols-3">
              <RankingList title="Top Performing Categories" icon={PieChart} rows={data.breakdowns.top_categories} />
              <RankingList title="Worst Performing Categories" icon={TrendingDown} rows={data.breakdowns.worst_categories} />
              <RankingList title="Country Performance" icon={Globe2} rows={data.breakdowns.top_countries} />
              <RankingList title="Worst Countries" icon={Globe2} rows={data.breakdowns.worst_countries} />
              <RankingList title="Highest CTR Countries" icon={TrendingUp} rows={data.breakdowns.highest_ctr_countries} />
              <RankingList title="Highest Conversion Countries" icon={Target} rows={data.breakdowns.highest_conversion_countries} />
              <RankingList title="Top Languages" icon={Languages} rows={data.breakdowns.top_languages} />
              <RankingList title="Worst Languages" icon={Languages} rows={data.breakdowns.worst_languages} />
              <RankingList title="Creative Performance" icon={FileText} rows={data.breakdowns.creative.slice(0, 5)} />
              <RankingList title="Best Mini Apps" icon={Smartphone} rows={data.breakdowns.best_miniapps} />
              <RankingList title="Best Channels" icon={Tv} rows={data.breakdowns.best_channels} />
              <RankingList title="Best Bots" icon={Bot} rows={data.breakdowns.best_bots} />
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
