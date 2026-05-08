"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ShieldCheck, Search, Radio, Send, Users, Globe, Layers, BarChart3 } from "lucide-react";

export default function AdminAvailabilityPage() {
  const [checkType, setCheckType] = useState("broadcast");
  const [checkCategory, setCheckCategory] = useState("Crypto");
  const [checkContinent, setCheckContinent] = useState("Global");
  const [checkResults, setCheckResults] = useState<any>(null);
  const [checking, setChecking] = useState(false);

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
    runAvailabilityCheck();
  }, [checkType, checkCategory, checkContinent]);

  const categories = ["Crypto", "Finance", "NSFW +18", "Tech", "Gambling", "Entertainment", "Education", "Shopping", "Other"];
  const continents = ["Global", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"];

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Availability Checker</h1>
            <p className="text-xs text-slate-500 font-medium">Verify network reach and audience capacity in real-time.</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${checking ? 'bg-amber-50 text-amber-600 border-amber-200 animate-pulse' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
            {checking ? 'Refreshing Inventory...' : 'Live Inventory'}
          </div>
        </div>

        {/* Configuration Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2">
              <Layers size={14} className="text-blue-500" />
              Targeting Parameters
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Campaign Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setCheckType("broadcast")}
                    className={`py-2 px-3 rounded-lg border text-[11px] font-bold transition-all ${checkType === 'broadcast' ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'}`}
                  >
                    Broadcast
                  </button>
                  <button 
                    onClick={() => setCheckType("clicks_views")}
                    className={`py-2 px-3 rounded-lg border text-[11px] font-bold transition-all ${checkType === 'clicks_views' ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'}`}
                  >
                    Clicks/Views
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Content Category</label>
                <select 
                  value={checkCategory} 
                  onChange={(e) => setCheckCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Geographic Reach</label>
                <select 
                  value={checkContinent} 
                  onChange={(e) => setCheckContinent(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
                >
                  {continents.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Results Card */}
        <div className="bg-slate-900 rounded-2xl p-8 text-white shadow-2xl relative overflow-hidden group">
          {/* Decorative background elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-32 -mt-32 transition-all group-hover:bg-blue-500/20" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -ml-32 -mb-32 transition-all group-hover:bg-indigo-500/20" />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 text-[10px] font-bold uppercase tracking-widest">
                <BarChart3 size={12} />
                Availability Summary
              </div>
              
              <div className="space-y-2">
                <h2 className="text-3xl font-black tracking-tight leading-none">
                  {checkType === 'broadcast' ? 'Bot Network' : 'Channel Network'}
                </h2>
                <p className="text-slate-400 text-sm font-medium">
                  Verified assets matching <span className="text-blue-400 font-bold">{checkCategory}</span> in <span className="text-blue-400 font-bold">{checkContinent}</span>.
                </p>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={runAvailabilityCheck}
                  disabled={checking}
                  className="px-6 py-2.5 bg-white text-slate-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-100 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 cursor-pointer shadow-lg shadow-white/5"
                >
                  {checking ? 'Analyzing...' : 'Recalculate'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 transition-all hover:bg-white/10 hover:border-white/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                    {checkType === 'broadcast' ? <Radio size={24} /> : <Send size={24} />}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active {checkType === 'broadcast' ? 'Bots' : 'Channels'}</p>
                    <p className="text-3xl font-black tabular-nums">{checking ? '...' : (checkResults?.itemCount || 0).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 transition-all hover:bg-white/10 hover:border-white/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Users size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total {checkType === 'broadcast' ? 'Bot Users' : 'Subscribers'}</p>
                    <p className="text-3xl font-black tabular-nums text-emerald-400">{checking ? '...' : (checkResults?.userCount || 0).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: "Dynamic Scaling", desc: "Results reflect live inventory, accounts for offline or blocked nodes.", icon: BarChart3 },
            { title: "Global Reach", desc: "Select 'Global' to see assets with worldwide audience targeting.", icon: Globe },
            { title: "Verified Assets", desc: "Only active, non-deleted nodes are included in these calculations.", icon: ShieldCheck },
          ].map((tip, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
              <div className="text-slate-400 shrink-0"><tip.icon size={18} /></div>
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-900 leading-none">{tip.title}</p>
                <p className="text-[10px] text-slate-500 font-medium leading-tight">{tip.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
