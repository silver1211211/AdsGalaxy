"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertTriangle, BarChart3, Check, Loader2, Pause, Settings2, Trophy } from "lucide-react";

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function money(value: unknown) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function label(value: string) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function scoreClass(score: number) {
  if (score >= 81) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 61) return "border-blue-200 bg-blue-50 text-blue-700";
  if (score >= 41) return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (score >= 21) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function entityHref(type: string, id: number) {
  return `/admin/traffic-quality/${type}/${id}`;
}

function Leaderboard({ title, type, rows, onOverride }: { title: string; type: string; rows: any[]; onOverride: (row: any, override: string) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400"><Trophy size={14} /> {title}</div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">No inventory records yet.</div>
        ) : rows.map((row) => (
          <div key={`${type}-${row.id}`} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={entityHref(type, row.id)} className="truncate text-sm font-bold text-blue-700 hover:text-blue-900">{row.name || `${label(type)} #${row.id}`}</Link>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${scoreClass(Number(row.inventory_score || 0))}`}>{row.inventory_score} / {label(row.inventory_rank)}</span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">{row.inventory_quality}</span>
                </div>
              </div>
              <select value={row.inventory_override || "none"} onChange={(event) => onOverride({ ...row, entity_type: type }, event.target.value)} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs outline-none focus:border-blue-500">
                <option value="none">None</option>
                <option value="boost">Boost</option>
                <option value="reduce">Reduce</option>
                <option value="pause">Pause</option>
                <option value="whitelist">Whitelist</option>
                <option value="blacklist">Blacklist</option>
              </select>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-500">
              <div>Revenue <span className="text-slate-900">{money(row.revenue_7d)}</span></div>
              <div>Impr. <span className="text-slate-900">{numberValue(row.impressions_7d)}</span></div>
              <div>Risk <span className="capitalize text-slate-900">{label(row.traffic_risk_level || "low")}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InventoryOptimizationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/inventory-optimization");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to load inventory optimization");
      setData(payload);
    } catch (err: any) {
      setError(err.message || "Failed to load inventory optimization");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(String(body.key || body.id || `${body.entity_type}-${body.entity_id}`));
    try {
      const res = await fetch("/api/admin/inventory-optimization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Update failed");
      await fetchData();
    } catch (err: any) {
      setError(err.message || "Update failed");
    } finally {
      setSaving("");
    }
  };

  const updateSetting = (key: string, value: string) => patch({ action: "setting", key, value });
  const updateOverride = (row: any, override: string) => patch({
    action: "override",
    entity_type: row.entity_type,
    entity_id: row.id,
    override,
    multiplier: override === "boost" ? 1.5 : override === "reduce" ? 0.65 : 1,
  });

  const settings = data?.settings || {};
  const queue = data?.attention_queue || [];

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Inventory Optimization</h2>
            <p className="text-xs text-slate-500">Delivery ranking, exploration, leaderboards, and manual overrides.</p>
          </div>
          {saving && <div className="flex items-center gap-2 text-xs font-bold text-blue-700"><Loader2 className="animate-spin" size={14} /> Saving</div>}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

        {loading ? (
          <div className="p-12 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Settings2 size={14} /> Mode</div>
                <select value={settings.mode || "balanced"} onChange={(event) => updateSetting("delivery_optimization_mode", event.target.value)} className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-bold capitalize outline-none focus:border-blue-500">
                  <option value="balanced">Balanced</option>
                  <option value="performance">Performance</option>
                  <option value="growth">Growth</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold uppercase text-slate-400">Exploration</div>
                <input value={settings.exploration_allocation_percent ?? 10} onChange={(event) => updateSetting("delivery_exploration_allocation_percent", event.target.value)} className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-bold outline-none focus:border-blue-500" />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold uppercase text-slate-400">Elite Boost</div>
                <input value={settings.elite_inventory_boost ?? 1.2} onChange={(event) => updateSetting("delivery_elite_inventory_boost", event.target.value)} className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-bold outline-none focus:border-blue-500" />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><AlertTriangle size={14} /> Attention</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{queue.length}</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Leaderboard title="Top Mini Apps" type="miniapp" rows={data?.leaderboards?.miniapps || []} onOverride={updateOverride} />
              <Leaderboard title="Top Channels" type="channel" rows={data?.leaderboards?.channels || []} onOverride={updateOverride} />
              <Leaderboard title="Top Bots" type="bot" rows={data?.leaderboards?.bots || []} onOverride={updateOverride} />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Attention Needed Queue</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Inventory</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Created</th><th className="px-3 py-2 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {queue.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-500">No inventory needs attention.</td></tr>
                    ) : queue.map((item: any) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2"><Link href={entityHref(item.entity_type, item.entity_id)} className="font-semibold capitalize text-blue-700 hover:text-blue-900">{item.entity_type} #{item.entity_id}</Link></td>
                        <td className="px-3 py-2"><span className={`rounded border px-2 py-0.5 text-xs font-bold ${scoreClass(Number(item.inventory_score || 0))}`}>{item.inventory_score} / {label(item.inventory_rank)}</span></td>
                        <td className="px-3 py-2">{item.reason}</td>
                        <td className="px-3 py-2">{new Date(item.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => patch({ action: "queue", id: item.id, status: "review" })} className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" title="review"><Check size={14} /></button>
                            <button onClick={() => patch({ action: "queue", id: item.id, status: "monitor" })} className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" title="monitor"><BarChart3 size={14} /></button>
                            <button onClick={() => patch({ action: "queue", id: item.id, status: "pause" })} className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" title="pause"><Pause size={14} /></button>
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
