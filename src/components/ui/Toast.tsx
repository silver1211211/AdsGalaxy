"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePopupQueue } from "@/context/PopupQueueContext";

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
  const isQueueActive = usePopupQueue(isOpen, `toast:${type}:${title}:${message}`);

  useEffect(() => {
    if (!isOpen || !isQueueActive) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [isOpen, isQueueActive, onClose, duration]);

  return (
    <AnimatePresence>
      {isOpen && isQueueActive && (
        <div className="fixed top-20 left-4 right-4 z-[2000] flex justify-center pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className={cn(
              "pointer-events-auto w-full max-w-sm bg-white rounded-2xl",
              "shadow-[0_8px_32px_rgba(15,23,42,0.12)] border p-4 flex items-center gap-4",
              type === "success" ? "border-emerald-100" : "border-red-100",
            )}
          >
            {/* Icon */}
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                type === "success"
                  ? "bg-emerald-50 text-emerald-500"
                  : "bg-red-50 text-red-500",
              )}
            >
              {type === "success" ? (
                <CheckCircle2 size={20} />
              ) : (
                <XCircle size={20} />
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-black text-slate-900 leading-snug">
                {title}
              </p>
              <p className="text-[11px] font-medium text-slate-500 leading-tight mt-0.5 truncate">
                {message}
              </p>
            </div>

            {/* Dismiss */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Dismiss"
              className="h-7 w-7 flex items-center justify-center rounded-full text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
