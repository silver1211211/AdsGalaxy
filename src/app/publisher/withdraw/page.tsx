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
import { useHeader } from "@/context/HeaderContext";

export default function WithdrawalPage() {
  const { setTitle } = useHeader();
  const [data, setData] = useState<any>({ balance: { balance_available: 0, balance_locked: 0 }, history: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any | null>(null);

  useEffect(() => {
    setTitle("Withdrawals");
  }, [setTitle]);

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
        {/* Unified Balance Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-slate-400">
                <Wallet size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Available Balance</span>
              </div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">
                ${parseFloat(data.balance.balance_available).toFixed(2)}
              </h2>
            </div>
            <div className="text-right space-y-1">
              <div className="flex items-center justify-end gap-2 text-slate-400">
                <Lock size={12} />
                <span className="text-[10px] font-black uppercase tracking-widest">Locked</span>
              </div>
              <p className="text-sm font-black text-amber-600 bg-amber-50 px-3 py-1 rounded-lg inline-block">
                ${parseFloat(data.balance.balance_locked).toFixed(2)}
              </p>
            </div>
          </div>

          <button 
            onClick={() => setIsWithdrawing(true)}
            className="w-full py-4 bg-[#0c9de8] text-white rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
          >
            <ArrowUpRight size={20} />
            Withdraw Funds
          </button>
        </div>

        {/* Withdrawal History */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-100 text-slate-400 rounded-lg flex items-center justify-center">
              <History size={18} />
            </div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Withdrawal History</h2>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 animate-pulse">
                  <div className="w-12 h-12 bg-slate-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-100 rounded-md w-24" />
                    <div className="h-3 bg-slate-50 rounded-md w-32" />
                  </div>
                  <div className="w-6 h-6 bg-slate-50 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          ) : data.history.length === 0 ? (
            <div className="py-20 text-center space-y-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
              <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center mx-auto text-slate-200">
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
                  className="w-full bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4 transition-all"
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
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
                      <span>{new Date(withdrawal.created_at).toLocaleDateString([], { dateStyle: 'medium' })}</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <ChevronRight size={24} className="text-slate-300" />
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