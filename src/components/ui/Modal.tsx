"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePopupQueue } from "@/context/PopupQueueContext";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  type?: "error" | "info" | "success" | "warning";
}

const TYPE_CONFIG = {
  info: {
    iconBg: "bg-blue-50",
    iconColor: "text-[#0c9de8]",
    Icon: Info,
    btnClass: "bg-[#0c9de8] text-white hover:bg-blue-600",
  },
  success: {
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    Icon: CheckCircle2,
    btnClass: "bg-emerald-500 text-white hover:bg-emerald-600",
  },
  warning: {
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    Icon: AlertTriangle,
    btnClass: "bg-amber-500 text-white hover:bg-amber-600",
  },
  error: {
    iconBg: "bg-red-50",
    iconColor: "text-red-600",
    Icon: AlertCircle,
    btnClass: "bg-red-500 text-white hover:bg-red-600",
  },
} as const;

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  type = "info",
}: ModalProps) {
  const isQueueActive = usePopupQueue(isOpen, `modal:${type}:${title || ""}:${typeof children === "string" ? children : ""}`);

  useEffect(() => {
    if (isOpen && isQueueActive) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, isQueueActive]);

  const cfg = TYPE_CONFIG[type];

  return (
    <AnimatePresence>
      {isOpen && isQueueActive && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Container */}
          <motion.div
            key="modal-container"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="relative w-full max-w-sm bg-white rounded-3xl shadow-[0_20px_60px_rgba(15,23,42,0.16)] overflow-hidden"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
            >
              <X size={16} />
            </button>

            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-start gap-4 pr-10">
                <div
                  className={cn(
                    "h-11 w-11 shrink-0 flex items-center justify-center rounded-2xl",
                    cfg.iconBg,
                    cfg.iconColor,
                  )}
                >
                  <cfg.Icon size={20} />
                </div>
                {title && (
                  <div className="flex-1 min-w-0 pt-1.5">
                    <h3 className="text-[17px] font-black text-slate-900 leading-snug">
                      {title}
                    </h3>
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="text-sm font-medium text-slate-500 leading-relaxed">
                {children}
              </div>

              {/* Primary action */}
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  "w-full py-3.5 rounded-2xl text-sm font-black transition-colors",
                  cfg.btnClass,
                )}
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
