"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ShieldCheck, Search, Radio, Send, Users, Globe, Layers, BarChart3, Check, Clock, TrendingUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminAvailabilityPage() {
  const [checkType, setCheckType] = useState("broadcast");
  const [checkCategory, setCheckCategory] = useState("Crypto");
  const [selectedContinents, setSelectedContinents] = useState<string[]>(["Global"]);
  const [predictionMinutes, setPredictionMinutes] = useState(0);
  const [checkResults, setCheckResults] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  const runAvailabilityCheck = async () => {
    setChecking(true);
    try {
      const continents = selectedContinents.join(",");
      const res = await fetch(`/api/admin/availability?type=${checkType}&category=${encodeURIComponent(checkCategory)}&continents=${encodeURIComponent(continents)}&predictionMinutes=${predictionMinutes}`);
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
  }, [checkType, checkCategory, selectedContinents, predictionMinutes]);

  const categories = ["Crypto", "Finance", "NSFW +18", "Tech", "Gambling", "Entertainment", "Education", "Shopping", "Other"];
  const continents = ["Global", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"];

  const predictionOptions = [
    { label: "Now", value: 0 },
    { label: "30 Min", value: 30 },
    { label: "1 Hour", value: 60 },
    { label: "2 Hours", value: 120 },
    { label: "3 Hours", value: 180 },
    { label: "4 Hours", value: 240 },
    { label: "5 Hours", value: 300 },
    { label: "6 Hours", value: 360 },
  ];

  const toggleContinent = (cont: string) => {
    if (cont === "Global") {
      setSelectedContinents(["Global"]);
    } else {
      let newSelection = selectedContinents.filter(c => c !== "Global");
      if (newSelection.includes(cont)) {
        newSelection = newSelection.filter(c => c !== cont);
      } else {
        newSelection.push(cont);
      }
      if (newSelection.length === 0) newSelection = ["Global"];
      setSelectedContinents(newSelection);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-[var(--admin-text)] uppercase tracking-tight">Availability Checker</h1>
            <p className="text-xs text-slate-500 font-medium">Factor in posting frequency and cooldown periods for accurate reach forecasting.</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${checking ? 'bg-[var(--admin-accent)]/10 text-[var(--admin-accent)] border-[var(--admin-accent)]/20 animate-pulse' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}`}>
            {checking ? 'Analyzing Inventory...' : 'Live System'}
          </div>
        </div>

        {/* Configuration Section - Cloudflare Style */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Top Bar Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Campaign Model</label>
                  <div className="flex p-0.5 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
                    <button 
                      onClick={() => setCheckType("broadcast")}
                      className={cn(
                        "flex-1 py-1.5 px-3 rounded-md text-[11px] font-bold transition-all",
                        checkType === 'broadcast' 
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" 
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      Broadcast
                    </button>
                    <button 
                      onClick={() => setCheckType("clicks_views")}
                      className={cn(
                        "flex-1 py-1.5 px-3 rounded-md text-[11px] font-bold transition-all",
                        checkType === 'clicks_views' 
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" 
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      Clicks/Views
                    </button>
                  </div>
               </div>

               <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Prediction Timer</label>
                  <div className="relative">
                    <select 
                      value={predictionMinutes}
                      onChange={(e) => setPredictionMinutes(parseInt(e.target.value))}
                      className="w-full bg-slate-100 dark:bg-slate-800/50 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-900 dark:text-white appearance-none outline-none focus:ring-1 focus:ring-[var(--admin-accent)] cursor-pointer"
                    >
                      {predictionOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
               </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                <Globe size={14} className="text-[var(--admin-accent)]" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Geographic Target Regions</span>
              </div>
              
              <div className="p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {continents.map((cont) => {
                    const isActive = selectedContinents.includes(cont);
                    return (
                      <button
                        key={cont}
                        onClick={() => toggleContinent(cont)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all group",
                          isActive 
                            ? "bg-[var(--admin-accent)]/5 border-[var(--admin-accent)] text-[var(--admin-accent)] shadow-sm" 
                            : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700"
                        )}
                      >
                        <span className="text-[11px] font-bold tracking-tight">{cont}</span>
                        {isActive && <Check size={12} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Side Control & Results */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                <Search size={14} className="text-[var(--admin-accent)]" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Niche Analysis</span>
              </div>
              <div className="p-5">
                <select 
                  value={checkCategory} 
                  onChange={(e) => setCheckCategory(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-[var(--admin-accent)] transition-all cursor-pointer mb-6"
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <div className="space-y-4">
                  <div className="p-4 bg-[var(--admin-accent)] rounded-xl text-white shadow-lg shadow-[var(--admin-accent)]/20 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:scale-110 transition-transform">
                      {checkType === 'broadcast' ? <Radio size={64} /> : <Send size={64} />}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">
                      {predictionMinutes > 0 ? `Reach In ${predictionOptions.find(o => o.value === predictionMinutes)?.label}` : `Current Reach`}
                    </p>
                    <p className="text-3xl font-black tabular-nums">{checking ? '...' : (checkResults?.userCount || 0).toLocaleString()}</p>
                  </div>

                  <div className="p-4 bg-slate-900 dark:bg-slate-800 rounded-xl text-white border border-white/5">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Eligible Nodes</p>
                    <div className="flex items-end justify-between">
                      <p className="text-2xl font-black tabular-nums">{checking ? '...' : (checkResults?.itemCount || 0).toLocaleString()}</p>
                      <button 
                        onClick={runAvailabilityCheck}
                        disabled={checking}
                        className="text-[10px] font-bold uppercase text-[var(--admin-accent)] hover:underline disabled:opacity-50"
                      >
                        {checking ? 'Updating...' : 'Sync Data'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Summary Tip */}
            <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/20 rounded-xl p-4 flex gap-3">
              <div className="text-blue-500 shrink-0"><BarChart3 size={18} /></div>
              <p className="text-[10px] text-blue-700 dark:text-blue-400 font-medium leading-relaxed">
                {predictionMinutes > 0 ? (
                  <>Predicted reach factors in cooldowns expiring within the next <span className="font-bold">{predictionOptions.find(o => o.value === predictionMinutes)?.label}</span>.</>
                ) : (
                  <>Current figures reflect only nodes that have cleared their frequency cooldowns as of <span className="font-bold">Now</span>.</>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
