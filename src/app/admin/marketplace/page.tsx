"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, Save, Search, Store } from "lucide-react";

type Row = {
  inventory_type: "miniapp" | "channel" | "bot";
  id: number;
  name: string;
  username: string;
  status: string;
  marketplace_visible: number | boolean;
  marketplace_admin_status: string;
  marketplace_featured: number | boolean;
  marketplace_pinned: number | boolean;
  marketplace_highlighted: number | boolean;
  marketplace_category: string | null;
  marketplace_country: string | null;
  marketplace_language: string | null;
  marketplace_average_cpm: string | number | null;
  marketplace_direct_min_cpm: string | number | null;
  marketplace_premium_cpm: string | number | null;
  marketplace_featured_cpm: string | number | null;
  marketplace_monthly_impressions: string | number;
  marketplace_avg_completion_rate: string | number;
  traffic_quality_rating: string;
  inventory_rank_label: string;
};

const types = ["all", "miniapp", "channel", "bot"];

export default function AdminMarketplacePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  const fetchRows = async () => {
    setLoading(true);
    const params = new URLSearchParams({ type, search });
    const res = await fetch(`/api/admin/marketplace?${params.toString()}`);
    const data = await res.json();
    setRows(data.inventory || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
  }, [type]);

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => `${row.inventory_type}-${row.id}` === key ? { ...row, ...patch } : row));
  };

  const save = async (row: Row) => {
    const key = `${row.inventory_type}-${row.id}`;
    setSavingId(key);
    setMessage("");
    const res = await fetch("/api/admin/marketplace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...row, inventory_id: row.id }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingId(null);
    setMessage(res.ok ? "Marketplace controls saved." : data.error || "Failed to save controls.");
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Store size={24} /> Marketplace Controls</h1>
            <p className="text-sm font-semibold text-slate-500">Approve visibility, hide inventory, feature, pin, highlight, and set direct placement CPM metadata.</p>
          </div>
          {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <select value={type} onChange={(event) => setType(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              {types.map((item) => <option key={item} value={item}>{item === "all" ? "All inventory" : item}</option>)}
            </select>
            <div className="relative md:col-span-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm" />
            </div>
            <button onClick={fetchRows} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Search</button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm font-semibold text-slate-500">No inventory found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Inventory</th>
                    <th className="px-3 py-2">Visibility</th>
                    <th className="px-3 py-2">Admin Status</th>
                    <th className="px-3 py-2">Feature</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Country</th>
                    <th className="px-3 py-2">Language</th>
                    <th className="px-3 py-2">Avg CPM</th>
                    <th className="px-3 py-2">Direct Min CPM</th>
                    <th className="px-3 py-2">Premium CPM</th>
                    <th className="px-3 py-2">Featured CPM</th>
                    <th className="px-3 py-2">Monthly Impressions</th>
                    <th className="px-3 py-2">Completion %</th>
                    <th className="px-3 py-2">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const key = `${row.inventory_type}-${row.id}`;
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2">
                          <div className="font-black text-slate-900">{row.name}</div>
                          <div className="text-xs font-semibold text-slate-400">@{row.username} / {row.inventory_type} / {row.traffic_quality_rating} / {row.inventory_rank_label}</div>
                        </td>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={Boolean(row.marketplace_visible)} onChange={(event) => updateRow(key, { marketplace_visible: event.target.checked })} />
                        </td>
                        <td className="px-3 py-2">
                          <select value={row.marketplace_admin_status} onChange={(event) => updateRow(key, { marketplace_admin_status: event.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs">
                            <option value="approved">Approved</option>
                            <option value="pending">Pending</option>
                            <option value="hidden">Hidden</option>
                            <option value="removed">Removed</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <label className="mr-2"><input type="checkbox" checked={Boolean(row.marketplace_featured)} onChange={(event) => updateRow(key, { marketplace_featured: event.target.checked })} /> Featured</label>
                          <label className="mr-2"><input type="checkbox" checked={Boolean(row.marketplace_pinned)} onChange={(event) => updateRow(key, { marketplace_pinned: event.target.checked })} /> Pin</label>
                          <label><input type="checkbox" checked={Boolean(row.marketplace_highlighted)} onChange={(event) => updateRow(key, { marketplace_highlighted: event.target.checked })} /> Highlight</label>
                        </td>
                        {[
                          "marketplace_category",
                          "marketplace_country",
                          "marketplace_language",
                          "marketplace_average_cpm",
                          "marketplace_direct_min_cpm",
                          "marketplace_premium_cpm",
                          "marketplace_featured_cpm",
                          "marketplace_monthly_impressions",
                          "marketplace_avg_completion_rate",
                        ].map((field) => (
                          <td key={field} className="px-3 py-2">
                            <input
                              value={String((row as any)[field] ?? "")}
                              onChange={(event) => updateRow(key, { [field]: event.target.value } as Partial<Row>)}
                              className="w-28 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <button onClick={() => save(row)} disabled={savingId === key} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:bg-slate-300">
                            {savingId === key ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />}
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
