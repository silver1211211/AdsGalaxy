"use client";

import React from "react";
import { BarChart3, RefreshCw, Eye, MousePointerClick } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";

type AudienceItem = {
  key: string;
  label: string;
  channels: number;
  subscribers: number;
  today: { views: number; clicks: number; ctr: number };
  weekly: { views: number; clicks: number; ctr: number };
  monthly: { views: number; clicks: number; ctr: number };
};

type DeliverySummary = Pick<AudienceItem, "today" | "weekly" | "monthly">;
type InventoryScope = {
  total_non_deleted_channels: number;
  active_channels: number;
  audience_classified_active_channels: number;
  authoritative_audience_active_channels: number;
  unknown_audience_active_channels: number;
};

function number(value: number) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2"><p className="truncate text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-black text-slate-900">{value}</p></div>;
}

export default function AudienceAnalyticsPage() {
  const [audiences, setAudiences] = React.useState<AudienceItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [partialError, setPartialError] = React.useState("");
  const [summary, setSummary] = React.useState<DeliverySummary | null>(null);
  const [scope, setScope] = React.useState<InventoryScope | null>(null);
  const totalChannels = Number(scope?.active_channels || audiences.find((audience) => audience.key === "all")?.channels || 0);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/audience-analytics", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load audience analytics");
      setAudiences(body.audiences || []);
      setSummary(body.summary || null);
      setScope(body.scope || null);
      setPartialError(body.partial_error || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load audience analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <AdminLayout>
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-widest text-[#0c9de8]">Channel inventory</p><h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">Audience Analytics</h1><p className="mt-2 text-sm text-slate-500">{loading && totalChannels === 0 ? "Loading active channel capacity." : `${number(totalChannels)} active channels across Global, six regions, and Unknown.`}</p></div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 self-start rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50 sm:self-auto"><RefreshCw size={14} className={loading ? "animate-spin" : ""}/>Refresh</button>
      </header>

      {partialError && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{partialError} Capacity totals are still available.</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-700">{error}</div>}

      {scope && <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active channels" value={number(scope.active_channels)}/>
        <Metric label="Audience classified" value={number(scope.audience_classified_active_channels)}/>
        <Metric label="Authoritative GEO" value={number(scope.authoritative_audience_active_channels)}/>
        <Metric label="Unknown audience" value={number(scope.unknown_audience_active_channels)}/>
      </section>}

      {summary && <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">All delivery — channels + Mini App</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {([['Today', summary.today], ['Last 7 days', summary.weekly], ['Last 30 days', summary.monthly]] as const).map(([label, period]) => <div key={label} className="rounded-xl bg-white p-3 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p><div className="mt-2 grid grid-cols-2 gap-2"><Metric label="Total views" value={number(period.views)}/><Metric label="Total clicks" value={number(period.clicks)}/></div></div>)}
        </div>
      </section>}

      {loading && audiences.length === 0 ? <div className="grid gap-3 sm:grid-cols-2"><div className="h-64 animate-pulse rounded-2xl bg-slate-100"/><div className="h-64 animate-pulse rounded-2xl bg-slate-100"/></div> : null}
      {!loading && !error && audiences.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm font-semibold text-slate-500">No audience inventory is available.</div> : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        {audiences.map((audience) => <section key={audience.key} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]"><BarChart3 size={17}/></span><div className="min-w-0"><h2 className="truncate font-black text-slate-950">{audience.label}</h2><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{audience.key === "all" ? "Authoritative active inventory" : audience.key === "unclassified" ? "Needs audience classification" : "Exact audience"}</p></div></div><div className="text-right"><p className="text-lg font-black text-slate-950">{number(audience.channels)}</p><p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Channels</p></div></div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2"><Metric label="Subscribers" value={number(audience.subscribers)}/><Metric label="Views today" value={number(audience.today.views)}/><Metric label="Clicks today" value={number(audience.today.clicks)}/><Metric label="CTR today" value={`${number(audience.today.ctr)}%`}/></div>
            <div><p className="mb-2 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-400"><Eye size={11}/>Last 7 days — totals</p><div className="grid grid-cols-3 gap-2"><Metric label="Views" value={number(audience.weekly.views)}/><Metric label="Clicks" value={number(audience.weekly.clicks)}/><Metric label="CTR" value={`${number(audience.weekly.ctr)}%`}/></div></div>
            <div><p className="mb-2 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-400"><MousePointerClick size={11}/>Last 30 days — totals</p><div className="grid grid-cols-3 gap-2"><Metric label="Views" value={number(audience.monthly.views)}/><Metric label="Clicks" value={number(audience.monthly.clicks)}/><Metric label="CTR" value={`${number(audience.monthly.ctr)}%`}/></div></div>
          </div>
        </section>)}
      </div>
    </div>
  </AdminLayout>;
}
