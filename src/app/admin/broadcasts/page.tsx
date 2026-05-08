"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Search, Radio, Send, Users, DollarSign, Activity, CheckCircle, Clock, AlertCircle, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminBroadcastsPage() {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const fetchBroadcasts = async (p: number, s: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/broadcast-audits", window.location.origin);
      url.searchParams.set("page", p.toString());
      if (s) url.searchParams.set("search", s);

      const res = await fetch(url.toString());
      const data = await res.json();
      setDeliveries(data.deliveries || []);
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBroadcasts(page, search);
  }, [page, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
              <Radio size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Deliveries</p>
              <p className="text-xl font-black text-slate-900">{totalItems.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Revenue</p>
              <p className="text-xl font-black text-slate-900">
                ${deliveries.reduce((acc, d) => acc + parseFloat(d.cost), 0).toFixed(2)}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Publisher Rewards</p>
              <p className="text-xl font-black text-slate-900">
                ${deliveries.reduce((acc, d) => acc + parseFloat(d.publisher_reward), 0).toFixed(2)}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
              <Users size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Unique Recipients</p>
              <p className="text-xl font-black text-slate-900">
                {new Set(deliveries.map(d => d.chat_id)).size}
              </p>
            </div>
          </div>
        </div>

        {/* Main Table Section */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight text-gradient">Broadcast Audit Log</h2>
              <p className="text-xs text-slate-500 font-medium tracking-wide">Real-time verification of message distribution.</p>
            </div>

            <form onSubmit={handleSearch} className="relative w-full sm:w-72 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input
                type="text"
                placeholder="Search campaign, bot, or chat ID..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-blue-500 outline-none transition-all font-medium placeholder:text-slate-400"
              />
            </form>
          </div>

          <div className="overflow-x-auto overflow-y-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-600" size={32} />
              </div>
            ) : deliveries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                <AlertCircle size={32} />
                <p className="text-sm font-bold uppercase tracking-widest">No deliveries found</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign / Bot</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Recipient (Chat ID)</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Publisher</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Cost</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Reward</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {deliveries.map((d: any) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5">
                          <p className="text-sm font-black text-slate-900">{d.campaign_name}</p>
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                            <Bot size={10} className="text-blue-500" />
                            {d.bot_name}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{d.chat_id}</code>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold text-slate-700">@{d.publisher_username}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm font-black text-slate-900">${parseFloat(d.cost).toFixed(4)}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm font-black text-emerald-600">${parseFloat(d.publisher_reward).toFixed(4)}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-xs font-bold text-slate-600 whitespace-nowrap">
                          {new Date(d.created_at).toLocaleDateString()}
                        </p>
                        <p className="text-[10px] font-medium text-slate-400">
                          {new Date(d.created_at).toLocaleTimeString()}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest tracking-widest">
              Showing {deliveries.length} of {totalItems} total logs
            </p>
            <div className="flex gap-2">
              <button
                disabled={page === 1 || loading}
                onClick={() => setPage(p => p - 1)}
                className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all shadow-sm cursor-pointer"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                disabled={page === totalPages || loading}
                onClick={() => setPage(p => p + 1)}
                className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all shadow-sm cursor-pointer"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
