"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  ArrowDownLeft, 
  Globe, 
  Hash,
  Wallet,
  AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WithdrawalDetailSheetProps {
  withdrawal: any;
  onClose: () => void;
}

export default function WithdrawalDetailSheet({ withdrawal, onClose }: WithdrawalDetailSheetProps) {
  // Telegram Back Button Logic
  useEffect(() => {
    const twa = window.Telegram?.WebApp;
    if (twa?.BackButton) {
      twa.BackButton.show();
      twa.BackButton.onClick(onClose);
      return () => {
        twa.BackButton.offClick(onClose);
        twa.BackButton.hide();
      };
    }
  }, [onClose]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success": return "text-emerald-500 bg-emerald-50";
      case "pending": return "text-amber-500 bg-amber-50";
      case "rejected": return "text-red-500 bg-red-50";
      default: return "text-slate-500 bg-slate-50";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle2 size={24} />;
      case "pending": return <Clock size={24} />;
      case "rejected": return <XCircle size={24} />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      {/* Backdrop with independent fade-in */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Sheet with slide-up */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative bg-white rounded-t-[40px] w-full max-h-[85vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white/80 backdrop-blur-md z-10 flex justify-center py-3">
          <div className="w-12 h-1.5 bg-slate-100 rounded-full" />
        </div>

        <div className="p-8 space-y-8">
          {/* Amount Display */}
          <div className="text-center space-y-2">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Withdrawal Amount</h3>
            <div className="text-4xl font-black text-slate-900">${parseFloat(withdrawal.amount).toFixed(2)}</div>
            <div className={cn("inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider", getStatusColor(withdrawal.status))}>
              {withdrawal.status}
            </div>
          </div>

          {/* Details List */}
          <div className="space-y-4">
            <div className="p-6 bg-slate-50 rounded-[32px] space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-slate-400">
                  <Globe size={18} />
                  <span className="text-xs font-black uppercase tracking-tight">Network</span>
                </div>
                <span className="text-sm font-black text-slate-900">{withdrawal.network}</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-3 text-slate-400">
                  <Wallet size={18} />
                  <span className="text-xs font-black uppercase tracking-tight">Address</span>
                </div>
                <div className="p-4 bg-white rounded-2xl border border-slate-100 font-mono text-xs font-bold text-slate-600 break-all leading-relaxed">
                  {withdrawal.address}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-slate-400">
                  <Clock size={18} />
                  <span className="text-xs font-black uppercase tracking-tight">Date</span>
                </div>
                <span className="text-sm font-black text-slate-900">
                  {new Date(withdrawal.created_at).toLocaleDateString([], { dateStyle: 'medium' })}
                </span>
              </div>
            </div>

            {/* Error/Refund Info */}
            {withdrawal.status === "rejected" && (
              <div className="p-6 bg-red-50 rounded-[32px] space-y-3">
                <div className="flex items-center gap-3 text-red-500">
                  <AlertTriangle size={18} />
                  <span className="text-xs font-black uppercase tracking-tight">Rejection Reason</span>
                </div>
                <p className="text-sm font-bold text-red-700 leading-relaxed">
                  {withdrawal.reject_reason || "No reason provided by admin."}
                </p>
                {withdrawal.refunded && (
                  <div className="mt-2 py-1.5 px-3 bg-red-100 rounded-full inline-block text-[10px] font-black text-red-700 uppercase">
                    Amount Refunded
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 flex flex-col gap-3">
            <button
              onClick={onClose}
              className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl text-sm"
            >
              Close Receipt
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
