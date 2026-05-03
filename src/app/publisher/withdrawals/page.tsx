"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { 
  Wallet, 
  ArrowUpRight, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  ChevronRight,
  Loader2,
  History,
  Lock,
  ArrowRightLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import WithdrawalForm from "@/components/publisher/WithdrawalForm";
import WithdrawalDetailSheet from "@/components/publisher/WithdrawalDetailSheet";

export default function WithdrawalPage() {
  const [data, setData] = useState<any>({ balance: { balance_available: 0, balance_locked: 0 }, history: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any | null>(null);

  const fetchData = async () => {
    try {
      const res = await apiFetch("/api/publisher/withdrawals");
      const json = await res.json();
      if (res.ok) setData(json);
    } catch (error) {
      console.error("Error fetching withdrawal data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle2 className="text-emerald-500" size={16} />;
      case "pending": return <Clock className="text-amber-500" size={16} />;
      case "rejected": return <XCircle className="text-red-500" size={16} />;
      default: return null;
    }
  };

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-8">
        {/* Balance Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-6 bg-white border border-slate-100 rounded-[32px] space-y-4">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Available</p>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">${parseFloat(data.balance.balance_available).toFixed(2)}</h2>
            </div>
            <button 
              onClick={() => setIsWithdrawing(true)}
              className="w-full py-2 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/10 active:scale-95"
            >
              Withdraw
            </button>
          </div>

          <div className="p-6 bg-white border border-slate-100 rounded-[32px] space-y-4 opacity-80">
            <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
              <Lock size={20} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Locked</p>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">${parseFloat(data.balance.balance_locked).toFixed(2)}</h2>
            </div>
            <div className="w-full py-2 bg-slate-50 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest text-center">
              Pending
            </div>
          </div>
        </div>

        {/* Withdrawal History */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center">
              <History size={18} />
            </div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Withdrawal History</h2>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-3 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Syncing History...</p>
            </div>
          ) : data.history.length === 0 ? (
            <div className="py-20 text-center space-y-4 bg-slate-50 rounded-[40px] border-2 border-dashed border-slate-200">
              <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mx-auto text-slate-200 shadow-sm">
                <ArrowRightLeft size={32} />
              </div>
              <div className="space-y-1">
                <p className="text-slate-900 font-black text-sm uppercase tracking-tight">No Transactions</p>
                <p className="text-slate-400 text-[10px] font-bold uppercase max-w-[200px] mx-auto leading-relaxed">
                  Your withdrawal history will appear here once you place a request.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {data.history.map((withdrawal: any) => (
                <button
                  key={withdrawal.id}
                  onClick={() => setSelectedWithdrawal(withdrawal)}
                  className="w-full bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-4 hover:bg-slate-50 transition-all active:scale-[0.98]"
                >
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                    withdrawal.status === "success" ? "bg-emerald-50 text-emerald-500" : 
                    withdrawal.status === "pending" ? "bg-amber-50 text-amber-500" : 
                    "bg-red-50 text-red-500"
                  )}>
                    <ArrowUpRight size={24} />
                  </div>
                  
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-900 text-sm">${parseFloat(withdrawal.amount).toFixed(2)}</span>
                      {getStatusIcon(withdrawal.status)}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-2">
                      <span>{withdrawal.network}</span>
                      <span className="w-1 h-1 bg-slate-200 rounded-full" />
                      <span className="truncate max-w-[120px]">{withdrawal.address}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-black text-slate-900 uppercase tracking-tighter">
                      {new Date(withdrawal.created_at).toLocaleDateString()}
                    </p>
                    <ChevronRight size={16} className="text-slate-300 ml-auto" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isWithdrawing && (
          <WithdrawalForm 
            availableBalance={parseFloat(data.balance.balance_available)}
            onClose={() => setIsWithdrawing(false)}
            onSuccess={fetchData}
          />
        )}
        {selectedWithdrawal && (
          <WithdrawalDetailSheet
            withdrawal={selectedWithdrawal}
            onClose={() => setSelectedWithdrawal(null)}
          />
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
