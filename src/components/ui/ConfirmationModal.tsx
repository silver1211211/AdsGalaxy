"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, X } from "lucide-react";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmBtnText?: string;
  closeBtnText?: string;
  confirmBtnVariant?: "danger" | "primary";
  isLoading?: boolean;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmBtnText = "Confirm",
  closeBtnText = "Close",
  confirmBtnVariant = "primary",
  isLoading = false,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        />

        {/* Modal content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-[400px] bg-white rounded-[28px] p-6 shadow-2xl overflow-hidden"
        >
          <div className="space-y-6">
            {/* Header with Icon and Title */}
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                confirmBtnVariant === "danger" ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-500"
              }`}>
                <AlertCircle size={20} />
              </div>
              <h3 className="text-xl font-black text-slate-900 leading-none">{title}</h3>
            </div>

            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              {message}
            </p>

            <div className="flex gap-3 w-full pt-2">
              <button
                disabled={isLoading}
                onClick={onClose}
                className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-black rounded-2xl hover:bg-slate-200 transition-all text-sm"
              >
                {closeBtnText}
              </button>
              <button
                disabled={isLoading}
                onClick={onConfirm}
                className={`flex-1 py-3.5 rounded-2xl font-black text-sm transition-all flex items-center justify-center ${
                  confirmBtnVariant === "danger"
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-[#0c9de8] text-white hover:bg-blue-600"
                }`}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  confirmBtnText
                )}
              </button>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={18} />
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
