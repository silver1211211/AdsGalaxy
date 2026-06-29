"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePopupQueue } from "@/context/PopupQueueContext";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  children?: React.ReactNode;
  confirmBtnText?: string;
  closeBtnText?: string;
  confirmBtnVariant?: "danger" | "primary";
  isLoading?: boolean;
  typedConfirmation?: {
    phrase: string;
    value: string;
    onChange: (value: string) => void;
    label?: string;
  };
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  children,
  confirmBtnText = "Confirm",
  closeBtnText = "Cancel",
  confirmBtnVariant = "primary",
  isLoading = false,
  typedConfirmation,
}: ConfirmationModalProps) {
  const isQueueActive = usePopupQueue(isOpen, `confirmation:${title}:${message}`);
  if (!isOpen || !isQueueActive) return null;

  const typedConfirmationMatches =
    !typedConfirmation || typedConfirmation.value === typedConfirmation.phrase;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        aria-modal="true"
        role="dialog"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
          aria-hidden="true"
        />

        {/* Container */}
        <motion.div
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
                  confirmBtnVariant === "danger"
                    ? "bg-red-50 text-red-600"
                    : "bg-blue-50 text-[#0c9de8]",
                )}
              >
                {confirmBtnVariant === "danger" ? (
                  <AlertTriangle size={20} />
                ) : (
                  <AlertCircle size={20} />
                )}
              </div>
              <div className="flex-1 min-w-0 pt-1.5">
                <h3 className="text-[17px] font-black text-slate-900 leading-snug">
                  {title}
                </h3>
              </div>
            </div>

            {/* Message */}
            <p className="text-sm font-medium text-slate-500 leading-relaxed">
              {message}
            </p>

            {/* Custom content */}
            {children}

            {/* Typed confirmation input */}
            {typedConfirmation && (
              <div className="space-y-2">
                <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400">
                  {typedConfirmation.label ||
                    `Type "${typedConfirmation.phrase}" to continue`}
                </label>
                <input
                  value={typedConfirmation.value}
                  onChange={(e) => typedConfirmation.onChange(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#0c9de8] focus:ring-4 focus:ring-[#0c9de8]/10 transition-shadow"
                  placeholder={typedConfirmation.phrase}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={isLoading}
                onClick={onClose}
                className="flex-1 py-3.5 rounded-2xl text-sm font-black bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {closeBtnText}
              </button>
              <button
                type="button"
                disabled={isLoading || !typedConfirmationMatches}
                onClick={onConfirm}
                className={cn(
                  "flex-1 py-3.5 rounded-2xl text-sm font-black transition-colors flex items-center justify-center",
                  confirmBtnVariant === "danger"
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-[#0c9de8] text-white hover:bg-blue-600",
                  (isLoading || !typedConfirmationMatches) &&
                    "opacity-50 cursor-not-allowed",
                )}
              >
                {isLoading ? (
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  confirmBtnText
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
