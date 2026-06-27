"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import { ArrowLeft, BarChart3, Globe2, Loader2, Radar, Repeat, ShieldAlert, Users } from "lucide-react";

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function percent(value: unknown) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function label(value: string) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function scoreClass(score: number) {
  if (score >= 90) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 75) return "border-blue-200 bg-blue-50 text-blue-700";
  if (score >= 60) return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (score >= 40) return "border-amber-200 bg-amber-50 text-amber-700";
  if (score >= 20) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function riskClass(risk: string) {
  if (risk === "critical") return "border-red-200 bg-red-50 text-red-700";
  if (risk === "high") return "border-orange-200 bg-orange-50 text-orange-700";
  if (risk === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function maxMetric(rows: any[], key: string) {
  return Math.max(1, ...rows.map((row) => Number(row[key] || 0)));
}

function DistributionList({ rows, empty }: { rows: any[]; empty: string }) {
  if (!rows || rows.length === 0) {
    return <p className="p-4 text-sm text-slate-500">{empty}</p>;
  }

  const max = maxMetric(rows, "impressions");
  return (
    <div className="space-y-3 p-4">
      {rows.map((row) => {
        const value = Number(row.impressions || row.count || 0);
        return (
          <div key={String(row.label || row.user_id)} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-700">{row.label || `User #${row.user_id}`}</span>
              <span className="font-black text-slate-900">{numberValue(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded bg-blue-500" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TrafficQualityDetailPage() {
  const params = useParams<{ type: string; id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/traffic-quality/${params.type}/${params.id}`);
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "Failed to load traffic quality details");
        setData(payload);
      } catch (err: any) {
        setError(err.message || "Failed to load traffic quality details");
      } finally {
        setLoading(false);
      }
    };

    if (params.type && params.id) fetchData();
  }, [params.type, params.id]);

  const metrics = data?.metrics;
  const inventory = data?.inventory;
  const details = data?.details || {};
  const completion = details.completion_analytics;
  const trend: any[] = data?.trend || [];
  const trendMaxScore = maxMetric(trend, "quality_score");
  const trendMaxImpressions = maxMetric(trend, "impressions");

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/admin/traffic-quality" className="mb-2 inline-flex items-center gap-1 text-xs font-bold uppercase text-blue-700 hover:text-blue-900">
              <ArrowLeft size={14} /> Traffic Quality
            </Link>
            <h2 className="text-sm font-bold text-slate-900">{data?.entity?.name || "Traffic Analytics"}</h2>
            <p className="text-xs capitalize text-slate-500">{params.type} #{params.id}</p>
          </div>
          {metrics && (
            <div className="flex flex-wrap gap-2">
              <span className={`rounded border px-3 py-1 text-xs font-bold ${scoreClass(metrics.quality_score)}`}>{metrics.quality_score} / {label(metrics.quality_tier)}</span>
              <span className={`rounded border px-3 py-1 text-xs font-bold ${riskClass(metrics.risk_level)}`}>{label(metrics.risk_level)} Risk</span>
              {inventory && <span className={`rounded border px-3 py-1 text-xs font-bold ${scoreClass(inventory.inventory_score)}`}>{inventory.inventory_score} / {label(inventory.inventory_rank)}</span>}
            </div>
          )}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

        {loading ? (
          <div className="p-12 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
        ) : metrics && (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><BarChart3 size={14} /> Impressions</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{numberValue(metrics.impressions)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Users size={14} /> Unique Users</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{numberValue(metrics.unique_users)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Repeat size={14} /> Repeat Ratio</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{percent(metrics.repeat_user_ratio)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><ShieldAlert size={14} /> Top User Share</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{percent(metrics.top_user_impression_ratio)}</div>
              </div>
            </div>

            {inventory && (
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Inventory Score</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{numberValue(inventory.inventory_score)}</div>
                  <span className={`mt-2 inline-flex rounded border px-2 py-0.5 text-xs font-bold ${scoreClass(inventory.inventory_score)}`}>{label(inventory.inventory_rank)}</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Fill Rate</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{percent(inventory.fill_rate)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Revenue Trend</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">${Number(inventory.revenue_7d || 0).toFixed(4)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Delivery Consistency</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{percent(inventory.delivery_consistency)}</div>
                </div>
              </div>
            )}

            {completion && (
              <div className="grid gap-3 md:grid-cols-5">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Completion Rate</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{percent(completion.completion_rate)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Avg Watch</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{Number(completion.average_watch_duration || 0).toFixed(1)}s</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Incomplete Rate</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{percent(completion.incomplete_rate)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Abandonment</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{percent(completion.abandonment_rate)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-400">Fraud Signals</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{numberValue(completion.fraud_signal_count)}</div>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-2">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Historical Quality</div>
                <div className="flex h-52 items-end gap-2 px-4 pb-4 pt-6">
                  {trend.length === 0 ? (
                    <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">No historical quality records yet.</div>
                  ) : trend.map((row) => (
                    <div key={String(row.date)} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <div className="flex h-36 w-full items-end justify-center gap-1">
                        <div className="w-3 rounded-t bg-blue-500" style={{ height: `${Math.max(8, (Number(row.quality_score || 0) / trendMaxScore) * 100)}%` }} title={`Quality ${Number(row.quality_score || 0).toFixed(0)}`} />
                        <div className="w-3 rounded-t bg-slate-300" style={{ height: `${Math.max(4, (Number(row.impressions || 0) / trendMaxImpressions) * 100)}%` }} title={`${numberValue(row.impressions)} impressions`} />
                      </div>
                      <div className="truncate text-[10px] font-semibold text-slate-400">{new Date(row.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Signal Coverage</div>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex items-center justify-between rounded-md bg-slate-50 p-2">
                    <span className="font-semibold text-slate-600">Velocity score</span>
                    <span className="font-black text-slate-900">{numberValue(metrics.velocity_score)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Radar size={14} /> Unavailable Signals</div>
                  {(details.unavailable_signals || []).map((item: string) => (
                    <div key={item} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800">{label(item)}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400"><Globe2 size={14} /> Top Countries</div>
                <DistributionList rows={details.country_breakdown || []} empty="Country signal unavailable for this entity." />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Session Distribution</div>
                <DistributionList rows={details.session_breakdown || []} empty="No session distribution yet." />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Repeat User Hotspots</div>
                <DistributionList rows={details.top_repeat_users || []} empty="Per-user repeat signal unavailable for this entity." />
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
