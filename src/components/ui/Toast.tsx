"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastProps {
  isOpen: boolean;
  onClose: () => void;
  type: "success" | "error";
  title: string;
  message: string;
  duration?: number;
}

export default function Toast({
  isOpen,
  onClose,
  type,
  title,
  message,
  duration = 4000,
}: ToastProps) {
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose, duration]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed top-20 left-4 right-4 z-[2000] flex justify-center pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className={cn(
              "pointer-events-auto w-full max-w-sm bg-white rounded-2xl shadow-2xl border p-4 flex items-center gap-4",
              type === "success" ? "border-emerald-100" : "border-red-100"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              type === "success" ? "bg-emerald-50 text-emerald-500" : "bg-red-50 text-red-500"
            )}>
              {type === "success" ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{title}</p>
              <p className="text-[10px] font-bold text-slate-500 leading-tight truncate">{message}</p>
            </div>

            <button 
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-slate-900 transition-colors"
            >
              <X size={16} />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
