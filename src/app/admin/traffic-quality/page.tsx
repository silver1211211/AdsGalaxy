"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { Activity, AlertTriangle, BarChart3, Check, Eye, Loader2, Pause, Radar, ShieldCheck, X } from "lucide-react";

type QualityEntity = {
  id: number;
  entity_type: string;
  entity_id: number;
  entity_name?: string | null;
  quality_score: number;
  quality_tier: string;
  risk_level: string;
  impressions: string | number;
  unique_users: string | number;
  repeat_user_ratio: string | number;
  repeat_impression_ratio: string | number;
  top_user_impression_ratio: string | number;
  velocity_score: string | number;
  country_breakdown?: string | Record<string, number> | null;
  signal_metadata?: string | Record<string, unknown> | null;
};

type QueueItem = {
  id: number;
  entity_type: string;
  entity_id: number;
  risk_level: string;
  quality_score: number;
  reason: string;
  status: string;
  created_at: string;
};

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function percent(value: unknown) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function tierLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
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

function parseObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, number>;
  try {
    return JSON.parse(String(value)) as Record<string, number>;
  } catch {
    return {};
  }
}

function maxValue(rows: any[], key: string) {
  return Math.max(1, ...rows.map((row) => Number(row[key] || 0)));
}

export default function TrafficQualityPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [data, setData] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/traffic-quality?quality=${qualityFilter}&risk=${riskFilter}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to load traffic quality");
      setData(payload);
    } catch (err: any) {
      setError(err.message || "Failed to load traffic quality");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [qualityFilter, riskFilter]);

  const runQueueAction = async (item: QueueItem, action: string) => {
    setActionLoading(item.id);
    try {
      const res = await fetch("/api/admin/traffic-quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Action failed");
      await fetchData();
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const platform = data?.platform;
  const entities: QualityEntity[] = data?.entities || [];
  const queue: QueueItem[] = data?.review_queue || [];
  const trends: any[] = data?.trends || [];
  const trendMaxScore = maxValue(trends, "quality_score");
  const trendMaxImpressions = maxValue(trends, "impressions");

  return (
    <AdminLayout>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Traffic Quality Dashboard</h2>
            <p className="text-xs text-slate-500">Fraud signals, quality trends, and manual review queue.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500">
              <option value="all">All Quality</option>
              <option value="excellent">Excellent</option>
              <option value="very_good">Very Good</option>
              <option value="good">Good</option>
              <option value="average">Average</option>
              <option value="poor">Poor</option>
              <option value="critical">Critical</option>
            </select>
            <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500">
              <option value="all">All Risk</option>
              <option value="low">Low Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="high">High Risk</option>
              <option value="critical">Critical Risk</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><ShieldCheck size={14} /> Platform Quality</div>
                <div className="mt-2 text-3xl font-black text-slate-900">{platform?.quality_score || 60}</div>
                <span className={`mt-2 inline-flex rounded border px-2 py-0.5 text-xs font-bold ${scoreClass(platform?.quality_score || 60)}`}>{tierLabel(platform?.quality_tier || "good")}</span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><BarChart3 size={14} /> Impressions</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{numberValue(platform?.impressions)}</div>
                <p className="mt-2 text-xs text-slate-500">7-day scored traffic</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Activity size={14} /> Unique Users</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{numberValue(platform?.unique_users)}</div>
                <p className="mt-2 text-xs text-slate-500">Where user signal exists</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><AlertTriangle size={14} /> Review Queue</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{queue.length}</div>
                <p className="mt-2 text-xs text-slate-500">Open or monitored items</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-2">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Traffic Trends</div>
                <div className="flex h-48 items-end gap-2 px-4 pb-4 pt-6">
                  {trends.length === 0 ? (
                    <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">No quality trend data yet.</div>
                  ) : trends.map((row) => {
                    const scoreHeight = Math.max(8, (Number(row.quality_score || 0) / trendMaxScore) * 100);
                    const impressionHeight = Math.max(4, (Number(row.impressions || 0) / trendMaxImpressions) * 100);
                    return (
                      <div key={String(row.date)} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                        <div className="flex h-32 w-full items-end justify-center gap-1">
                          <div className="w-3 rounded-t bg-blue-500" style={{ height: `${scoreHeight}%` }} title={`Quality ${Number(row.quality_score || 0).toFixed(0)}`} />
                          <div className="w-3 rounded-t bg-slate-300" style={{ height: `${impressionHeight}%` }} title={`${numberValue(row.impressions)} impressions`} />
                        </div>
                        <div className="truncate text-[10px] font-semibold text-slate-400">{new Date(row.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Protection Signals</div>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex items-center justify-between rounded-md bg-slate-50 p-2">
                    <span className="font-semibold text-slate-600">Sensitivity</span>
                    <span className="font-black capitalize text-slate-900">{data?.settings?.traffic_quality_sensitivity || "medium"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-slate-50 p-2">
                    <span className="font-semibold text-slate-600">Review threshold</span>
                    <span className="font-black text-slate-900">{data?.settings?.traffic_quality_review_threshold || 39}</span>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
                    Device, language, and VPN/proxy ratios are ready in the quality schema and display as unavailable until source detection is added.
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Radar size={14} /> Refreshed {numberValue(data?.refreshed?.miniapps)} mini apps, {numberValue(data?.refreshed?.channels)} channels, {numberValue(data?.refreshed?.bots)} bots</div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-2">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Quality Analytics</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Entity</th>
                        <th className="px-3 py-2">Quality</th>
                        <th className="px-3 py-2">Risk</th>
                        <th className="px-3 py-2">Impressions</th>
                        <th className="px-3 py-2">Unique</th>
                        <th className="px-3 py-2">Repeat Ratio</th>
                        <th className="px-3 py-2">Top User</th>
                        <th className="px-3 py-2">Velocity</th>
                        <th className="px-3 py-2">Top Countries</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {entities.length === 0 ? (
                        <tr><td colSpan={9} className="p-8 text-center text-slate-500">No quality records match the filters.</td></tr>
                      ) : entities.map((entity) => {
                        const countries = Object.entries(parseObject(entity.country_breakdown)).slice(0, 3);
                        return (
                          <tr key={`${entity.entity_type}-${entity.entity_id}`}>
                            <td className="px-3 py-2">
                              <Link href={`/admin/traffic-quality/${entity.entity_type}/${entity.entity_id}`} className="font-semibold text-blue-700 hover:text-blue-900">
                                {entity.entity_name || `${entity.entity_type} #${entity.entity_id}`}
                              </Link>
                              <div className="text-xs capitalize text-slate-500">{entity.entity_type} #{entity.entity_id}</div>
                            </td>
                            <td className="px-3 py-2"><span className={`rounded border px-2 py-0.5 text-xs font-bold ${scoreClass(entity.quality_score)}`}>{entity.quality_score} / {tierLabel(entity.quality_tier)}</span></td>
                            <td className="px-3 py-2"><span className={`rounded border px-2 py-0.5 text-xs font-bold ${riskClass(entity.risk_level)}`}>{tierLabel(entity.risk_level)}</span></td>
                            <td className="px-3 py-2">{numberValue(entity.impressions)}</td>
                            <td className="px-3 py-2">{numberValue(entity.unique_users)}</td>
                            <td className="px-3 py-2">{percent(entity.repeat_user_ratio)}</td>
                            <td className="px-3 py-2">{percent(entity.top_user_impression_ratio)}</td>
                            <td className="px-3 py-2">{numberValue(entity.velocity_score)}</td>
                            <td className="px-3 py-2 text-xs">{countries.length ? countries.map(([country, count]) => `${country}: ${count}`).join(" / ") : "Unavailable"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Risk Breakdown</div>
                  <div className="space-y-2 p-4">
                    {(data?.risk_breakdown || []).map((row: any) => (
                      <div key={row.risk_level} className="flex items-center justify-between rounded-md bg-slate-50 p-2 text-sm">
                        <span className="font-semibold capitalize text-slate-700">{row.risk_level}</span>
                        <span className="font-black text-slate-900">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Country Breakdown</div>
                  <div className="space-y-2 p-4">
                    {(data?.countries || []).map((row: any) => (
                      <div key={row.country} className="flex items-center justify-between rounded-md bg-slate-50 p-2 text-sm">
                        <span className="font-semibold text-slate-700">{row.country || "Unknown"}</span>
                        <span className="font-black text-slate-900">{numberValue(row.impressions)}</span>
                      </div>
                    ))}
                    {(!data?.countries || data.countries.length === 0) && <p className="text-sm text-slate-500">No country data yet.</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Traffic Review Queue</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Risk</th><th className="px-3 py-2">Quality</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Created</th><th className="px-3 py-2 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {queue.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-slate-500">No traffic review items.</td></tr>
                    ) : queue.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-semibold capitalize">{item.entity_type} #{item.entity_id}</td>
                        <td className="px-3 py-2"><span className={`rounded border px-2 py-0.5 text-xs font-bold ${riskClass(item.risk_level)}`}>{tierLabel(item.risk_level)}</span></td>
                        <td className="px-3 py-2">{item.quality_score}</td>
                        <td className="px-3 py-2">{item.reason}</td>
                        <td className="px-3 py-2">{new Date(item.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            {[
                              ["approve", Check],
                              ["ignore", X],
                              ["monitor", Eye],
                              ["pause", Pause],
                            ].map(([action, Icon]: any) => (
                              <button key={action} onClick={() => runQueueAction(item, action)} disabled={actionLoading === item.id} className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50" title={action}>
                                {actionLoading === item.id ? <Loader2 className="animate-spin" size={14} /> : <Icon size={14} />}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
