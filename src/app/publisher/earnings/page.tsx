"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Loader2, DollarSign, Clock, MousePointerClick, Eye, ChevronRight, X, Calendar, Hash, Target, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/api";

export default function PublisherEarningsPage() {
  const [earnings, setEarnings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEarning, setSelectedEarning] = useState<any>(null);

  useEffect(() => {
    apiFetch("/api/publisher/earnings")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEarnings(data.earnings || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    if (selectedEarning) {
      tg.BackButton.show();
      const handleBack = () => setSelectedEarning(null);
      tg.BackButton.onClick(handleBack);
      return () => {
        tg.BackButton.offClick(handleBack);
      };
    } else {
      tg.BackButton.hide();
    }
  }, [selectedEarning]);

  const totalLocked = earnings.filter(e => e.status === 'locked').reduce((acc, curr) => acc + parseFloat(curr.amount), 0);
  const totalUnlocked = earnings.filter(e => e.status === 'unlocked').reduce((acc, curr) => acc + parseFloat(curr.amount), 0);

  return (
    <DashboardLayout type="publisher">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">My Earnings</h1>
        <p className="text-slate-500 text-sm mt-1">Track your ad settlements and unlock status.</p>
      </div>

      {error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100 text-sm font-medium">
          {error}
        </div>
      ) : loading ? (
        <div className="flex justify-center items-center h-48">
          <Loader2 className="animate-spin text-blue-600" size={32} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><CheckCircle size={14} className="text-emerald-500"/> Unlocked Total</p>
              <p className="text-2xl font-black text-slate-900">${totalUnlocked.toFixed(4)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={14} className="text-amber-500"/> Locked Total</p>
              <p className="text-2xl font-black text-slate-900">${totalLocked.toFixed(4)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-bold text-slate-900">Earning History</h3>
            </div>
            
            {earnings.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">No earnings recorded yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {earnings.map((earning) => (
                  <div 
                    key={`${earning.type}-${earning.id}`} 
                    onClick={() => setSelectedEarning(earning)}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-full ${earning.type === 'click' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                        {earning.type === 'click' ? <MousePointerClick size={20} /> : <Eye size={20} />}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{earning.campaign_name || "Unknown Campaign"}</p>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          <Clock size={12} /> {new Date(earning.created_at).toLocaleDateString()} • {earning.status === 'unlocked' ? (
                            <span className="text-emerald-600 font-semibold">Unlocked</span>
                          ) : (
                            <span className="text-amber-600 font-semibold">Locked</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-black text-slate-900">+${parseFloat(earning.amount).toFixed(4)}</p>
                        <p className="text-xs font-semibold text-slate-500">{earning.count} {earning.type}s</p>
                      </div>
                      <ChevronRight size={18} className="text-slate-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Bottom Sheet Modal */}
      <AnimatePresence>
        {selectedEarning && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 z-40 backdrop-blur-sm"
              onClick={() => setSelectedEarning(null)}
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-[32px] shadow-2xl border-t border-slate-200 overflow-hidden"
            >
              <div className="p-6">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-black text-slate-900">Earning Details</h3>
                    <p className="text-sm text-slate-500 font-medium">#{selectedEarning.id} • {selectedEarning.type.toUpperCase()}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedEarning(null)}
                    className="p-2 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Reward</p>
                    <p className="text-3xl font-black text-slate-900">${parseFloat(selectedEarning.amount).toFixed(4)}</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${selectedEarning.status === 'unlocked' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {selectedEarning.status.toUpperCase()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Target size={18} /></div>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase">Campaign</p>
                      <p className="text-sm font-semibold text-slate-900">{selectedEarning.campaign_name || "Unknown"}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Hash size={18} /></div>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase">Channel</p>
                      <p className="text-sm font-semibold text-slate-900">@{selectedEarning.channel_username || "Unknown"}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                      {selectedEarning.type === 'click' ? <MousePointerClick size={18} /> : <Eye size={18} />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase">Valid {selectedEarning.type}s</p>
                      <p className="text-sm font-semibold text-slate-900">{selectedEarning.count}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-slate-100 text-slate-600 rounded-lg"><Calendar size={18} /></div>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase">Date Recorded</p>
                      <p className="text-sm font-semibold text-slate-900">{new Date(selectedEarning.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedEarning(null)}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
