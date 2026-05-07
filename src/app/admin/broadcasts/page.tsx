"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Search, Radio, Send, Users, DollarSign, Activity, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminBroadcastsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
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
      setCampaigns(data.campaigns || []);
      setTotalPages(data.totalPages || 1);
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
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Reach</p>
              <p className="text-xl font-black text-slate-900">
                {campaigns.reduce((acc, c) => acc + c.delivery_count, 0).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Spent</p>
              <p className="text-xl font-black text-slate-900">
                ${campaigns.reduce((acc, c) => acc + c.total_spent, 0).toFixed(2)}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active Tasks</p>
              <p className="text-xl font-black text-slate-900">
                {campaigns.filter(c => c.status === 'active').length}
              </p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
              <Users size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Advertisers</p>
              <p className="text-xl font-black text-slate-900">
                {new Set(campaigns.map(c => c.user_id)).size}
              </p>
            </div>
          </div>
        </div>

        {/* Main Table Section */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Broadcast Delivery Audit</h2>
              <p className="text-xs text-slate-500 font-medium">Tracking message distribution across the bot network.</p>
            </div>

            <form onSubmit={handleSearch} className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search campaigns or owners..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-blue-500 outline-none transition-all font-medium"
              />
            </form>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-600" size={32} />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                <AlertCircle size={32} />
                <p className="text-sm font-bold uppercase tracking-widest">No broadcasts found</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Owner</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Delivery / Budget</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Spend / CPM</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Last Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {campaigns.map((c: any) => {
                    const progress = Math.min(100, (c.total_spent / (c.total_spent + parseFloat(c.budget))) * 100);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                              <Send size={14} />
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-900">{c.name}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase">ID: #{c.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-slate-700">@{c.owner_username}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight inline-flex items-center gap-1.5",
                            c.status === 'active' ? "bg-emerald-50 text-emerald-600" :
                            c.status === 'paused' ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-600"
                          )}>
                            {c.status === 'active' ? <Activity size={10} className="animate-pulse" /> : 
                             c.status === 'completed' ? <CheckCircle size={10} /> : <Clock size={10} />}
                            {c.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-2 max-w-[160px] mx-auto">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-tight">
                              <span className="text-blue-600">{c.delivery_count.toLocaleString()} sent</span>
                              <span className="text-slate-400">${parseFloat(c.budget).toFixed(2)} left</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="text-sm font-black text-slate-900">${c.total_spent.toFixed(2)}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">${parseFloat(c.cpm).toFixed(2)} CPM</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="text-xs font-bold text-slate-600">{new Date(c.created_at).toLocaleDateString()}</p>
                          <p className="text-[10px] font-medium text-slate-400">{new Date(c.created_at).toLocaleTimeString()}</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Page {page} of {totalPages}
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
