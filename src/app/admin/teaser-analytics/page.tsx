"use client";

import React from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useTranslations } from "@/i18n/client";
import { teaserErrorMessageKey } from "@/lib/teaserErrorMessage";

type Period = { views: number; clicks: number; ctr: number };
type Audience = {
  key: string;
  label: string;
  channels: number;
  subscribers: number;
  today: Period;
  weekly: Period;
  monthly: Period;
};
type Data = {
  summary: { active_placements?: number; enabled_channels?: number; needs_permission?: number };
  audiences: Audience[];
  categories: Audience[];
};

const number = (value: unknown) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="truncate text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-slate-900">{value}</p>
    </div>
  );
}

function PerformanceRow({ label, period }: { label: string; period: Period }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Impressions" value={number(period.views)} />
        <Metric label="Clicks" value={number(period.clicks)} />
        <Metric label="CTR" value={`${number(period.ctr)}%`} />
      </div>
    </div>
  );
}

function AnalyticsCard({ item, title, subtitle, countLabel = "Channels" }: { item: Audience; title?: string; subtitle: string; countLabel?: string }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]"><BarChart3 size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-black text-slate-950">{title || item.label}</h2>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{subtitle}</p>
        </div>
        <div className="text-right"><p className="text-xl font-black text-slate-950">{number(item.channels)}</p><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{countLabel}</p></div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Estimated Subscribers" value={number(item.subscribers)} />
          <Metric label="Impressions Today" value={number(item.today.views)} />
          <Metric label="Clicks Today" value={number(item.today.clicks)} />
          <Metric label="CTR Today" value={`${number(item.today.ctr)}%`} />
        </div>
        <PerformanceRow label="Last 7 Days — Totals" period={item.weekly} />
        <PerformanceRow label="Last 30 Days — Totals" period={item.monthly} />
      </div>
    </section>
  );
}

export default function TeaserAnalyticsPage() {
  const { t } = useTranslations();
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/teaser-analytics", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "TEASER_JOB_LOAD_FAILED");
      setData(body);
    } catch (loadError) {
      setError(t(teaserErrorMessageKey(loadError instanceof Error ? loadError.message : "TEASER_JOB_LOAD_FAILED") as never));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const all = data?.audiences.find((audience) => audience.key === "all");

  return (
    <AdminLayout>
      <div className="space-y-5 pb-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-[#0c9de8]">Teaser Delivery</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">Teaser Analytics</h1>
            <p className="mt-2 text-sm text-slate-500">Monitor Teaser inventory, impressions, clicks, and audience delivery.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 self-start rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50 sm:self-auto">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{t("common.refresh")}
          </button>
        </header>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-700">{error}</div>}
        {loading && !data ? <div className="grid gap-3 sm:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /></div> : null}

        {data && <>
          <section className="grid gap-3 sm:grid-cols-3">
            <Metric label="Active Placements" value={number(data.summary.active_placements)} />
            <Metric label="Teaser-enabled Active Channels" value={number(data.summary.enabled_channels)} />
            <Metric label="Needs Permission — Active Channels" value={number(data.summary.needs_permission)} />
          </section>

          {all && <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">Teaser Performance</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white p-3 shadow-sm"><PerformanceRow label="Today" period={all.today} /></div>
              <div className="rounded-xl bg-white p-3 shadow-sm"><PerformanceRow label="Last 7 Days" period={all.weekly} /></div>
              <div className="rounded-xl bg-white p-3 shadow-sm"><PerformanceRow label="Last 30 Days" period={all.monthly} /></div>
            </div>
          </section>}

          <section>
            <div className="mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">Teaser Audience Delivery</p>
              <p className="mt-1 text-sm text-slate-500">Eligible inventory and actual Teaser results grouped by the channel audience used for campaign matching.</p>
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              {data.audiences.map((audience) => <AnalyticsCard key={audience.key} item={audience} title={audience.key === "all" ? "All eligible Teaser channels" : undefined} subtitle={audience.key === "all" ? "Active Teaser inventory" : "Exact audience"} />)}
            </div>
          </section>

          <section>
            <div className="mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">Teaser Category Delivery</p>
              <p className="mt-1 text-sm text-slate-500">Performance is divided proportionally across each channel’s selected categories, so category totals reconcile.</p>
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              {data.categories.map((category) => <AnalyticsCard key={category.key} item={category} subtitle="Proportional category attribution" countLabel="Weighted Channels" />)}
            </div>
          </section>
        </>}
      </div>
    </AdminLayout>
  );
}
