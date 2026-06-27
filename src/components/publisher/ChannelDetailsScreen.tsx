"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Tv, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  PauseCircle,
  Hash,
  Globe,
  Calendar,
  MessageSquare,
  Users,
  LayoutGrid
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelDetailsScreenProps {
  channel: any;
  onClose: () => void;
}

export default function ChannelDetailsScreen({ channel, onClose }: ChannelDetailsScreenProps) {
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

  const getStatusInfo = (status: string) => {
    switch (status) {
      case "active": return { icon: <CheckCircle2 size={24} />, color: "text-emerald-700", label: "Active", bg: "bg-emerald-100/50" };
      case "pending": return { icon: <Clock size={24} />, color: "text-amber-700", label: "Pending Review", bg: "bg-amber-100/50" };
      case "rejected": return { icon: <XCircle size={24} />, color: "text-red-700", label: "Rejected", bg: "bg-red-100/50" };
      case "paused": return { icon: <PauseCircle size={24} />, color: "text-slate-600", label: "Paused", bg: "bg-slate-100" };
      case "bot_removed": return { icon: <XCircle size={24} />, color: "text-red-700", label: "Bot Removed", bg: "bg-red-100/50" };
      case "channel_not_found": return { icon: <XCircle size={24} />, color: "text-red-700", label: "Channel Not Found", bg: "bg-red-100/50" };
      case "permission_missing": return { icon: <XCircle size={24} />, color: "text-red-700", label: "Permission Missing", bg: "bg-red-100/50" };
      case "deleted": return { icon: <XCircle size={24} />, color: "text-red-700", label: "Deleted", bg: "bg-red-100/50" };
      default: return { icon: <Clock size={24} />, color: "text-slate-600", label: "Unknown", bg: "bg-slate-100" };
    }
  };

  const statusInfo = getStatusInfo(channel.status);
  const continents = JSON.parse(channel.audience_continents || "[]");
  const categories = channel.categories ? (typeof channel.categories === 'string' ? JSON.parse(channel.categories) : channel.categories) : [];

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
          {/* Header Info */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center text-slate-400">
              <Tv size={40} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">{channel.title}</h2>
              <p className="text-blue-500 font-bold">@{channel.username}</p>
            </div>
          </div>

          {/* Status Card */}
          <div className={cn("p-6 rounded-[32px] flex items-center gap-4 border border-transparent", statusInfo.bg)}>
            <div className={statusInfo.color}>{statusInfo.icon}</div>
            <div>
              <p className={cn("text-[10px] font-black uppercase tracking-widest", statusInfo.color, "opacity-70")}>Channel Status</p>
              <p className={cn("text-lg font-black", statusInfo.color)}>{statusInfo.label}</p>
              {(channel.paused_reason || channel.failure_reason || channel.suggested_fix) && (
                <div className="mt-2 space-y-1 text-left">
                  {(channel.paused_reason || channel.failure_reason) && <p className="text-xs font-bold text-slate-700">{channel.paused_reason || channel.failure_reason}</p>}
                  {channel.suggested_fix && <p className="text-xs font-semibold text-slate-500">{channel.suggested_fix}</p>}
                </div>
              )}
            </div>
          </div>

          {/* Details Grid */}
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 bg-slate-50 rounded-[28px] space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Hash size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Chat ID</span>
                </div>
                <p className="text-sm font-bold text-slate-900 font-mono truncate">{channel.chat_id}</p>
              </div>
              <div className="p-5 bg-slate-50 rounded-[28px] space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Users size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Subscribers</span>
                </div>
                <p className="text-sm font-bold text-slate-900">{channel.subscriber_count?.toLocaleString() || "0"}</p>
              </div>
              <div className="p-5 bg-slate-50 rounded-[28px] space-y-1 col-span-2">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <MessageSquare size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Monetization Rate</span>
                </div>
                <p className="text-sm font-bold text-slate-900">{channel.posts_per_day} Ad Posts / Day</p>
              </div>
            </div>

            {/* Categories */}
            <div className="p-6 bg-slate-50 rounded-[32px] space-y-4">
              <div className="flex items-center gap-2 text-slate-400">
                <LayoutGrid size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Channel Categories</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.length > 0 ? (
                  categories.map((cat: string) => (
                    <span 
                      key={cat} 
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-wider"
                    >
                      {cat}
                    </span>
                  ))
                ) : (
                  <span className="text-xs font-bold text-slate-400 italic">No categories selected</span>
                )}
              </div>
            </div>

            {/* Audience */}
            <div className="p-6 bg-slate-50 rounded-[32px] space-y-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Globe size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Target Audience</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {continents.length > 0 ? (
                  continents.map((cont: string) => (
                    <span 
                      key={cont} 
                      className="px-4 py-1.5 bg-white text-slate-600 rounded-full text-xs font-black border border-slate-100"
                    >
                      {cont}
                    </span>
                  ))
                ) : (
                  <span className="px-4 py-1.5 bg-white text-slate-400 rounded-full text-xs font-black">Global</span>
                )}
              </div>
            </div>

            {/* Added Date */}
            <div className="p-6 bg-slate-50 rounded-[32px] flex items-center justify-between">
              <div className="flex items-center gap-3 text-slate-400">
                <Calendar size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest">Registered On</span>
              </div>
              <p className="text-sm font-bold text-slate-900">
                {new Date(channel.created_at).toLocaleDateString()}
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
