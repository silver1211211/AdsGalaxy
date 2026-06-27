"use client";

import React, { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { BarChart3, Globe2, Loader2, Megaphone, Trophy, Users } from "lucide-react";

const ranges = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last_7_days", "Last 7 Days"],
  ["last_30_days", "Last 30 Days"],
];

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function Panel({ title, icon: Icon, rows, render }: { title: string; icon: typeof BarChart3; rows: any[]; render: (row: any) => React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Icon size={16} /> {title}</h2>
      <div className="space-y-2">
        {rows.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400">No data yet.</p> : rows.map((row, index) => (
          <div key={`${title}-${index}`} className="rounded-lg bg-slate-50 p-3">
            {render(row)}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AdminAdvertiserAnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("last_7_days");

  const query = useMemo(() => new URLSearchParams({ range }).toString(), [range]);

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/advertiser-analytics?${query}`);
    const json = await res.json();
    if (res.ok) setData(json);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [query]);

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Advertiser Analytics</h1>
            <p className="text-sm font-semibold text-slate-500">Top advertisers, categories, countries, campaigns, spend, and ROI signals.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ranges.map(([key, label]) => (
              <button key={key} onClick={() => setRange(key)} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest ${range === key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>

        {loading || !data ? (
          <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top Advertisers" icon={Users} rows={data.top_advertisers || []} render={(row) => (
              <>
                <p className="text-sm font-black text-slate-900">{row.name || `Advertiser #${row.id}`}</p>
                <p className="text-xs font-semibold text-slate-500">Spend {money(row.spend)}</p>
              </>
            )} />
            <Panel title="Top Categories" icon={Trophy} rows={data.top_categories || []} render={(row) => (
              <>
                <p className="text-sm font-black text-slate-900">{row.category}</p>
                <p className="text-xs font-semibold text-slate-500">{numberValue(row.clicks)} tracked clicks</p>
              </>
            )} />
            <Panel title="Top Countries" icon={Globe2} rows={data.top_countries || []} render={(row) => (
              <>
                <p className="text-sm font-black text-slate-900">{row.country}</p>
                <p className="text-xs font-semibold text-slate-500">{numberValue(row.impressions)} Mini App impressions</p>
              </>
            )} />
            <Panel title="Highest Spend Campaigns" icon={Megaphone} rows={data.top_campaigns || []} render={(row) => (
              <>
                <p className="text-sm font-black text-slate-900">{row.name}</p>
                <p className="text-xs font-semibold text-slate-500">{row.campaign_type} #{row.id} / {money(row.spend)}</p>
              </>
            )} />
            <Panel title="Highest ROI Campaign Signals" icon={BarChart3} rows={data.highest_roi_campaigns || []} render={(row) => (
              <>
                <p className="text-sm font-black text-slate-900">{row.campaign_type} #{row.campaign_id}</p>
                <p className="text-xs font-semibold text-slate-500">{numberValue(row.conversions)} conversions / value {money(row.conversion_value)}</p>
              </>
            )} />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
