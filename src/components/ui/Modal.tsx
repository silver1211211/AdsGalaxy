"use client";

import React, { useEffect } from "react";
import { X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  type?: "error" | "info" | "success";
}

export default function Modal({ isOpen, onClose, title, children, type = "info" }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => { document.body.style.overflow = "unset"; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" 
        onClick={onClose} 
      />
      
      {/* Modal Content */}
      <div className={cn(
        "relative w-full max-w-md bg-white rounded-[2rem] border-4 border-slate-900 overflow-hidden shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] animate-in zoom-in-95 fade-in duration-200",
        type === "error" && "border-red-600 shadow-[8px_8px_0px_0px_rgba(220,38,38,1)]"
      )}>
        {/* Header */}
        <div className={cn(
          "px-6 py-4 border-b-4 border-slate-900 flex items-center justify-between",
          type === "error" ? "bg-red-50 border-red-600" : "bg-slate-50"
        )}>
          <div className="flex items-center gap-2">
            {type === "error" && <AlertCircle className="text-red-600" size={20} />}
            <h3 className={cn(
              "font-black uppercase tracking-tight",
              type === "error" ? "text-red-600" : "text-slate-900"
            )}>
              {title || (type === "error" ? "Error" : "Attention")}
            </h3>
          </div>
          <button 
            onClick={onClose}
            className={cn(
              "p-1 hover:bg-slate-200 rounded-lg transition-colors",
              type === "error" && "hover:bg-red-100 text-red-600"
            )}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-8">
          <div className="text-slate-600 font-bold leading-relaxed">
            {children}
          </div>
          
          <button 
            onClick={onClose}
            className={cn(
              "w-full mt-8 py-4 rounded-2xl font-black uppercase tracking-widest transition-none active:translate-y-1 active:shadow-none",
              type === "error" 
                ? "bg-red-600 text-white shadow-[0px_4px_0px_0px_rgba(153,27,27,1)]" 
                : "bg-slate-900 text-white shadow-[0px_4px_0px_0px_rgba(15,23,42,1)]"
            )}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
