"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Smartphone, CheckCircle2, Clock, XCircle, PauseCircle,
  Globe, Calendar, Link2, Bot, Hash, BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MiniAppDetailsScreenProps {
  miniapp: any;
  onClose: () => void;
}

export default function MiniAppDetailsScreen({ miniapp, onClose }: MiniAppDetailsScreenProps) {
  useEffect(() => {
    const twa = (window as any).Telegram?.WebApp;
    if (twa?.BackButton) {
      twa.BackButton.show();
      twa.BackButton.onClick(onClose);
      return () => {
        twa.BackButton.offClick(onClose);
        twa.BackButton.hide();
      };
    }
  }, [onClose]);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case "active":
      case "approved":
        return { icon: <CheckCircle2 size={24} />, color: "text-emerald-700", label: "Active", bg: "bg-emerald-100/50" };
      case "pending":
        return { icon: <Clock size={24} />, color: "text-amber-700", label: "Pending Review", bg: "bg-amber-100/50" };
      case "rejected":
        return { icon: <XCircle size={24} />, color: "text-red-700", label: "Rejected", bg: "bg-red-100/50" };
      case "paused":
        return { icon: <PauseCircle size={24} />, color: "text-slate-600", label: "Paused", bg: "bg-slate-100" };
      default:
        return { icon: <Clock size={24} />, color: "text-slate-600", label: "Pending", bg: "bg-slate-100" };
    }
  };

  const statusInfo = getStatusInfo(miniapp.status);

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed top-16 left-0 right-0 bottom-0 z-[55] bg-white flex flex-col"
    >
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-8">
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-20 h-20 bg-emerald-50 rounded-[32px] flex items-center justify-center text-emerald-400">
              <Smartphone size={40} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">{miniapp.miniapp_name}</h2>
              <p className="text-emerald-500 font-bold">@{miniapp.miniapp_username}</p>
            </div>
          </div>

          {/* Status */}
          <div className={cn("p-6 rounded-[32px] flex items-center gap-4 border border-transparent", statusInfo.bg)}>
            <div className={statusInfo.color}>{statusInfo.icon}</div>
            <div>
              <p className={cn("text-[10px] font-black uppercase tracking-widest opacity-70", statusInfo.color)}>Mini App Status</p>
              <p className={cn("text-lg font-black", statusInfo.color)}>{statusInfo.label}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 bg-blue-50 rounded-[28px] border border-blue-100 space-y-1">
              <div className="flex items-center gap-2 text-blue-600 mb-1">
                <BarChart2 size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Requests</span>
              </div>
              <p className="text-xl font-black text-blue-700">{Number(miniapp.total_requests || 0).toLocaleString()}</p>
            </div>
            <div className="p-5 bg-emerald-50 rounded-[28px] border border-emerald-100 space-y-1">
              <div className="flex items-center gap-2 text-emerald-600 mb-1">
                <CheckCircle2 size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Impressions</span>
              </div>
              <p className="text-xl font-black text-emerald-700">{Number(miniapp.total_impressions || 0).toLocaleString()}</p>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-3">
            <div className="p-5 bg-slate-50 rounded-[28px] space-y-1">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Bot size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Bot ID</span>
              </div>
              <p className="text-sm font-bold text-slate-900 font-mono">{miniapp.bot_id}</p>
            </div>
            <div className="p-5 bg-slate-50 rounded-[28px] space-y-1">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Globe size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Web App URL</span>
              </div>
              <p className="text-sm font-bold text-slate-900 break-all">{miniapp.webapp_url}</p>
            </div>
            <div className="p-5 bg-slate-50 rounded-[28px] space-y-1">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Link2 size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Mini App URL</span>
              </div>
              <p className="text-sm font-bold text-slate-900 break-all">{miniapp.miniapp_url}</p>
            </div>
            <div className="p-5 bg-slate-50 rounded-[28px] flex items-center justify-between">
              <div className="flex items-center gap-3 text-slate-400">
                <Calendar size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest">Registered</span>
              </div>
              <p className="text-sm font-bold text-slate-900">
                {new Date(miniapp.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={onClose}
              className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl text-sm"
            >
              Close Details
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
