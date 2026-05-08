"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Search, Radio, Send, Users, DollarSign, Activity, CheckCircle, Clock, AlertCircle, Bot, X, Eye, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminBroadcastsPage() {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const [checkType, setCheckType] = useState("broadcast");
  const [checkCategory, setCheckCategory] = useState("Crypto");
  const [checkContinent, setCheckContinent] = useState("Global");
  const [checkResults, setCheckResults] = useState<any>(null);
  const [checking, setChecking] = useState(false);

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

  const runAvailabilityCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/admin/availability?type=${checkType}&category=${encodeURIComponent(checkCategory)}&continent=${encodeURIComponent(checkContinent)}`);
      const data = await res.json();
      setCheckResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    fetchBroadcasts(page, search);
  }, [page, search]);

  useEffect(() => {
    runAvailabilityCheck();
  }, [checkType, checkCategory, checkContinent]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const renderContinents = (str: string) => {
    if (!str) return "Global";
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed.join(", ") : str;
    } catch (e) { return str; }
  };

  const renderCategories = (str: string) => {
    if (!str) return "None";
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed.join(", ") : str;
    } catch (e) { return str; }
  };

  const categories = ["Crypto", "Finance", "NSFW +18", "Tech", "Gambling", "Entertainment", "Education", "Shopping", "Other"];
  const continents = ["Global", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"];

  return (
    <AdminLayout>
      {/* Campaign Info Modal */}
      {campaignModalOpen && selectedItem && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-lg w-full max-w-xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Campaign Details (#{selectedItem.campaign_id})</h3>
              <button onClick={() => setCampaignModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Campaign Name</p>
                  <p className="font-bold text-slate-900">{selectedItem.campaign_name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Creator</p>
                  <p className="font-bold text-slate-900">{selectedItem.adv_first_name} {selectedItem.adv_last_name} (@{selectedItem.adv_username})</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ad Message</p>
                <div className="bg-slate-50 p-2 rounded border border-slate-100 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">{selectedItem.message_text}</div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Category</p><p className="font-bold">{selectedItem.campaign_category}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Status</p><p className="font-bold capitalize">{selectedItem.campaign_status}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">CPM</p><p className="font-bold">${selectedItem.campaign_cpm}</p></div>
              </div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Targeting</p><p className="font-bold text-slate-700">{renderContinents(selectedItem.campaign_continents)}</p></div>
            </div>
          </div>
        </div>
      )}

      {/* Bot Info Modal */}
      {botModalOpen && selectedItem && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-lg w-full max-w-xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Bot Details (#{selectedItem.bot_id})</h3>
              <button onClick={() => setBotModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bot Name</p>
                  <p className="font-bold text-slate-900">{selectedItem.bot_name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Username</p>
                  <p className="font-bold text-blue-600">@{selectedItem.bot_username}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Publisher</p>
                <p className="font-bold text-slate-900">{selectedItem.pub_first_name} {selectedItem.pub_last_name} (@{selectedItem.publisher_username})</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Posts / Day</p><p className="font-bold">{selectedItem.posts_per_day}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Status</p><p className="font-bold capitalize">{selectedItem.bot_status}</p></div>
              </div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Categories</p><p className="font-bold text-slate-700">{renderCategories(selectedItem.bot_categories)}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Audience</p><p className="font-bold text-slate-700">{renderContinents(selectedItem.bot_continents)}</p></div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Availability Checker - Compact */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck size={14} className="text-blue-500" />
              Availability Checker
            </h3>
            {checking && <Loader2 size={12} className="animate-spin text-blue-500" />}
          </div>
          <div className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Campaign Type</p>
                <select 
                  value={checkType} 
                  onChange={(e) => setCheckType(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-medium outline-none focus:border-blue-500 transition-all"
                >
                  <option value="broadcast">Broadcast (Bots)</option>
                  <option value="clicks_views">Clicks & Views (Channels)</option>
                </select>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Category</p>
                <select 
                  value={checkCategory} 
                  onChange={(e) => setCheckCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-medium outline-none focus:border-blue-500 transition-all"
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Continent</p>
                <select 
                  value={checkContinent} 
                  onChange={(e) => setCheckContinent(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-medium outline-none focus:border-blue-500 transition-all"
                >
                  {continents.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              
              <div className="flex items-center gap-4 bg-blue-50/50 rounded-lg px-4 border border-blue-100/50">
                <div className="flex-1">
                  <p className="text-[9px] font-bold text-blue-400 uppercase leading-none mb-1">Available {checkType === 'broadcast' ? 'Bots' : 'Channels'}</p>
                  <p className="text-sm font-black text-blue-700 leading-none">{checkResults?.itemCount || 0}</p>
                </div>
                <div className="w-px h-6 bg-blue-200" />
                <div className="flex-1">
                  <p className="text-[9px] font-bold text-blue-400 uppercase leading-none mb-1">Total {checkType === 'broadcast' ? 'Users' : 'Subscribers'}</p>
                  <p className="text-sm font-black text-blue-700 leading-none">{(checkResults?.userCount || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Header Stats - Compact */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Deliveries", val: totalItems.toLocaleString(), icon: Radio, color: "blue" },
            { label: "Total Revenue", val: `$${deliveries.reduce((acc, d) => acc + parseFloat(d.cost), 0).toFixed(2)}`, icon: DollarSign, color: "emerald" },
            { label: "Pub Rewards", val: `$${deliveries.reduce((acc, d) => acc + parseFloat(d.publisher_reward), 0).toFixed(2)}`, icon: Activity, color: "purple" },
            { label: "Unique Users", val: new Set(deliveries.map(d => d.chat_id)).size, icon: Users, color: "orange" },
          ].map((stat, i) => (
            <div key={i} className="bg-white px-3 py-2.5 rounded-lg border border-slate-200 flex items-center gap-3">
              <div className={`p-1.5 rounded-md bg-${stat.color}-50 text-${stat.color}-600`}>
                <stat.icon size={14} />
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none mb-1">{stat.label}</p>
                <p className="text-sm font-bold text-slate-900 leading-none">{stat.val}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Main Table Section - Compact */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-180px)]">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
            <h2 className="text-sm font-bold text-slate-900">Broadcast Audit Log</h2>

            <form onSubmit={handleSearch} className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs outline-none focus:border-blue-500 transition-all font-medium"
              />
            </form>
          </div>

          <div className="overflow-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-600" size={24} />
              </div>
            ) : deliveries.length === 0 ? (
              <div className="text-center p-12 text-slate-400 text-xs">No deliveries found.</div>
            ) : (
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider">Campaign</th>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider">Bot</th>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider">Recipient</th>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider">Publisher</th>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider text-right">Cost</th>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider text-right">Reward</th>
                    <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deliveries.map((d: any) => (
                    <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 group">
                          <span className="font-bold text-slate-900">{d.campaign_name}</span>
                          <button 
                            onClick={() => { setSelectedItem(d); setCampaignModalOpen(true); }}
                            className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-all cursor-pointer"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 group">
                          <span className="text-slate-600 flex items-center gap-1 font-medium">
                            <Bot size={10} /> {d.bot_name}
                          </span>
                          <button 
                            onClick={() => { setSelectedItem(d); setBotModalOpen(true); }}
                            className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-all cursor-pointer"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-mono text-slate-600">{d.chat_id}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">@{d.publisher_username}</td>
                      <td className="px-4 py-2 text-right font-medium text-slate-900">${parseFloat(d.cost).toFixed(4)}</td>
                      <td className="px-4 py-2 text-right font-medium text-emerald-600">${parseFloat(d.publisher_reward).toFixed(4)}</td>
                      <td className="px-4 py-2 text-right">
                        <p className="font-medium text-slate-600">{new Date(d.created_at).toLocaleDateString()}</p>
                        <p className="text-[10px] text-slate-400 leading-none">{new Date(d.created_at).toLocaleTimeString()}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase">
              Showing {deliveries.length} of {totalItems} logs
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 1 || loading}
                onClick={() => setPage(p => p - 1)}
                className="p-1 rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-all cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                disabled={page === totalPages || loading}
                onClick={() => setPage(p => p + 1)}
                className="p-1 rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-all cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
