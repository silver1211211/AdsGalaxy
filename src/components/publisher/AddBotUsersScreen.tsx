"use client";

import React, { useState, useEffect } from "react";
import { 
  Users, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Info, 
  Copy, 
  ChevronDown, 
  ChevronUp,
  Terminal,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import Toast from "@/components/ui/Toast";

interface AddBotUsersScreenProps {
  bot: any;
  onClose: () => void;
}

export default function AddBotUsersScreen({ bot, onClose }: AddBotUsersScreenProps) {
  const [userIdsText, setUserIdsText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);
  const [stats, setStats] = useState<{ newlyAdded: number; alreadyAdded: number; invalid: number } | null>(null);
  const [totalSubscribers, setTotalSubscribers] = useState<{ total: number; active: number; blocked: number }>({ total: 0, active: 0, blocked: 0 });

  const apiEndpoint = `${window.location.origin}/api/bot/add-user?bot_token=${bot.bot_token}&chat_id={CHAT_ID}`;

  useEffect(() => {
    fetchStats();
    
    // Telegram Back Button
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

  const fetchStats = async () => {
    try {
      const res = await apiFetch(`/api/publisher/bots/${bot.id}/users`);
      const data = await res.json();
      if (res.ok) {
        setTotalSubscribers(data);
      }
    } catch (e) {}
  };

  const handleBulkAdd = async () => {
    if (!userIdsText.trim()) return;

    setIsLoading(true);
    setStats(null);
    setNotification(null);

    // Parse comma separated IDs
    const chat_ids = userIdsText
      .split(/[\s,]+/)
      .map(id => id.trim())
      .filter(id => id && /^\d+$/.test(id));

    if (chat_ids.length === 0) {
      setNotification({
        type: "error",
        title: "Invalid Input",
        message: "Please enter valid numerical Telegram User IDs."
      });
      setIsLoading(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/publisher/bots/${bot.id}/users`, {
        method: "POST",
        body: JSON.stringify({ chat_ids })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to add users");

      setStats(data);
      setNotification({
        type: "success",
        title: "Batch Processed",
        message: `Successfully added ${data.newlyAdded} new users.`
      });
      setUserIdsText("");
      fetchStats();
    } catch (err: any) {
      setNotification({
        type: "error",
        title: "Bulk Add Failed",
        message: err.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyApi = () => {
    navigator.clipboard.writeText(apiEndpoint);
    setNotification({
      type: "success",
      title: "Copied",
      message: "API Endpoint copied to clipboard."
    });
  };

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
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500">
              <Users size={32} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">Add Bot Users</h2>
              <p className="text-sm text-slate-500">Manage subscribers for @{bot.bot_username}</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <div className="inline-flex items-center px-3 py-1 bg-emerald-50 rounded-full text-[10px] font-black text-emerald-600 uppercase tracking-widest border border-emerald-100">
                  Active: {totalSubscribers.active.toLocaleString()}
                </div>
                <div className="inline-flex items-center px-3 py-1 bg-red-50 rounded-full text-[10px] font-black text-red-600 uppercase tracking-widest border border-red-100">
                  Blocked: {totalSubscribers.blocked.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Automatic Add API (Collapsed) */}
          <div className="bg-slate-50 rounded-2xl overflow-hidden border border-slate-100">
            <button 
              onClick={() => setShowApi(!showApi)}
              className="w-full px-6 py-4 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <Terminal size={18} className="text-slate-400" />
                <span className="text-sm font-black text-slate-700 uppercase tracking-tight">Automatic Add API</span>
              </div>
              {showApi ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
            </button>
            
            <AnimatePresence>
              {showApi && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="px-6 pb-6 pt-2 space-y-4"
                >
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                    <span className="text-slate-900 font-bold">Recommendation:</span> Call this API within your bot's <code className="bg-slate-200 px-1 rounded text-slate-700">/start</code> command handler. This ensures every new user is automatically registered in the database.
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest bg-slate-100 px-2 py-1 rounded inline-block">
                    Supports GET requests only
                  </p>
                  <div className="relative group">
                    <div className="w-full p-4 bg-slate-900 rounded-2xl text-[10px] font-mono text-indigo-300 break-all pr-12">
                      {apiEndpoint}
                    </div>
                    <button 
                      onClick={copyApi}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white transition-colors"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-700 font-medium leading-relaxed">
                      Keep your bot token private. Users re-entering your bot will be automatically marked as <b>Active</b> again.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Bulk Add Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Manual Bulk Add</label>
              <textarea
                value={userIdsText}
                onChange={(e) => setUserIdsText(e.target.value)}
                placeholder="Paste User IDs here (comma or space separated)..."
                className="w-full h-40 px-5 py-4 bg-slate-50 border-none rounded-2xl focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none text-sm font-mono text-slate-900 resize-none"
              />
            </div>

            <button
              onClick={handleBulkAdd}
              disabled={isLoading || !userIdsText.trim()}
              className="w-full py-4 bg-indigo-600 disabled:bg-indigo-300 text-white font-black rounded-2xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Verifying & Adding...
                </>
              ) : (
                <>Add Users in Bulk</>
              )}
            </button>

            {/* Results Stats */}
            {stats && (
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 rounded-2xl text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Already Added</p>
                  <p className="text-lg font-black text-slate-600">{stats.alreadyAdded}</p>
                </div>
                <div className="p-3 bg-red-50 rounded-2xl text-center border border-red-100">
                  <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">Invalid Users</p>
                  <p className="text-lg font-black text-red-600">{stats.invalid}</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-2xl text-center border border-emerald-100">
                  <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">Newly Added</p>
                  <p className="text-lg font-black text-emerald-600">{stats.newlyAdded}</p>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4">
            <button
              onClick={onClose}
              className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />
    </motion.div>
  );
}
