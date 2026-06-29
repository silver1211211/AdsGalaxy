"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  CheckCircle2,
  Clock,
  XCircle,
  Globe,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WithdrawalDetailSheetProps {
  withdrawal: any;
  onClose: () => void;
}

function getStatusConfig(status: string) {
  switch (status) {
    case "success":
      return {
        label: "Completed",
        icon: CheckCircle2,
        pill: "bg-emerald-50 text-emerald-700 border border-emerald-100",
        dot: "bg-emerald-500",
      };
    case "pending":
      return {
        label: "Pending",
        icon: Clock,
        pill: "bg-amber-50 text-amber-700 border border-amber-100",
        dot: "bg-amber-400",
      };
    case "rejected":
      return {
        label: "Rejected",
        icon: XCircle,
        pill: "bg-red-50 text-red-700 border border-red-100",
        dot: "bg-red-500",
      };
    default:
      return {
        label: status,
        icon: Clock,
        pill: "bg-slate-50 text-slate-700 border border-slate-200",
        dot: "bg-slate-400",
      };
  }
}

export default function WithdrawalDetailSheet({
  withdrawal,
  onClose,
}: WithdrawalDetailSheetProps) {
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

  const statusCfg = getStatusConfig(withdrawal.status);
  const StatusIcon = statusCfg.icon;
  const amount = parseFloat(withdrawal.amount);
  const fee = parseFloat(withdrawal.fee || "0");
  const net = Math.max(0, parseFloat(withdrawal.net_amount || withdrawal.amount));
  const hasFee = fee > 0;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[600] flex flex-col justify-end">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Sheet */}
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="relative bg-white rounded-t-3xl w-full max-h-[85vh] overflow-y-auto"
        >
          {/* Drag handle */}
          <div className="sticky top-0 bg-white/90 backdrop-blur-sm z-10 flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-4 z-20 h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <X size={16} />
          </button>

          <div className="px-6 pb-8 space-y-5">
            {/* Amount hero */}
            <div className="pt-2 text-center space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Withdrawal Amount
              </p>
              <p className="text-4xl font-black text-slate-900 tracking-tight">
                ${amount.toFixed(2)}
              </p>
              {hasFee && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-600">
                    Network fee: −${fee.toFixed(2)}
                  </p>
                  <p className="text-sm font-black text-emerald-600">
                    You receive: ${net.toFixed(2)}
                  </p>
                </div>
              )}
              {/* Status pill */}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold",
                  statusCfg.pill,
                )}
              >
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusCfg.dot)}
                />
                {statusCfg.label}
              </span>
            </div>

            {/* Details card */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50 divide-y divide-slate-100">
              {/* Network */}
              <div className="flex items-center justify-between px-4 py-3.5 gap-3">
                <div className="flex items-center gap-2 text-slate-400 shrink-0">
                  <Globe size={15} />
                  <span className="text-xs font-black uppercase tracking-tight">Network</span>
                </div>
                <span className="text-sm font-black text-slate-900 truncate text-right">
                  {withdrawal.network}
                </span>
              </div>

              {/* Address */}
              <div className="px-4 py-3.5 space-y-2">
                <div className="flex items-center gap-2 text-slate-400">
                  <Wallet size={15} />
                  <span className="text-xs font-black uppercase tracking-tight">Address</span>
                </div>
                <p className="font-mono text-xs font-bold text-slate-700 break-all leading-relaxed bg-white rounded-xl border border-slate-100 px-3 py-2.5">
                  {withdrawal.address}
                </p>
              </div>

              {/* Date */}
              <div className="flex items-center justify-between px-4 py-3.5 gap-3">
                <div className="flex items-center gap-2 text-slate-400 shrink-0">
                  <Clock size={15} />
                  <span className="text-xs font-black uppercase tracking-tight">Date</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {new Date(withdrawal.created_at).toLocaleDateString([], {
                    dateStyle: "medium",
                  })}
                </span>
              </div>
            </div>

            {/* Rejection detail */}
            {withdrawal.status === "rejected" && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle size={15} />
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    Rejection Reason
                  </span>
                </div>
                <p className="text-sm font-medium text-red-700 leading-relaxed">
                  {withdrawal.reject_reason || "No reason provided."}
                </p>
                {withdrawal.refunded && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black bg-red-100 text-red-700 uppercase tracking-wide">
                    Amount Refunded
                  </span>
                )}
              </div>
            )}

            {/* Close action */}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl text-sm font-black bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              Close Receipt
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
