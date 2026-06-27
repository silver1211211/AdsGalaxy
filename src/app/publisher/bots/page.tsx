"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Plus,
  Bot,
  MoreVertical,
  Trash2,
  Pause,
  Play,
  CheckCircle2,
  Clock,
  XCircle,
  PauseCircle,
  Loader2,
  Eye,
  Edit3,
  FileText,
  Users,
  HelpCircle
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import AddBotScreen from "@/components/publisher/AddBotScreen";
import BotDetailsScreen from "@/components/publisher/BotDetailsScreen";
import AddBotUsersScreen from "@/components/publisher/AddBotUsersScreen";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Toast from "@/components/ui/Toast";
import { useHeader } from "@/context/HeaderContext";

export default function MyBots() {
  const { setTitle } = useHeader();
  const [bots, setBots] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isAddingBot, setIsAddingBot] = useState(false);
  const [editingBot, setEditingBot] = useState<any | null>(null);
  const [viewingBot, setViewingBot] = useState<any | null>(null);
  const [addingUsersToBot, setAddingUsersToBot] = useState<any | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    id: number | null;
    title: string;
    message: string;
    confirmText: string;
  }>({
    isOpen: false,
    id: null,
    title: "",
    message: "",
    confirmText: "Remove"
  });

  const fetchBots = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await apiFetch("/api/publisher/bots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setBots(data);
    } catch (error) {
      console.error("Error fetching bots:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setTitle("My Bots");
    fetchBots();

    const handleClick = () => setMenuOpenId(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [setTitle]);

  const handleToggleStatus = async (id: number) => {
    setIsActionLoading(true);
    setProcessingId(id);
    try {
      const res = await apiFetch(`/api/publisher/bots/${id}`, { 
        method: "PATCH",
        body: JSON.stringify({ action: "toggle_status" }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      
      await fetchBots(true);
      setNotification({
        type: "success",
        title: "Status Updated",
        message: "Your bot status has been updated successfully."
      });
    } catch (error: any) {
      setNotification({
        type: "error",
        title: "Update Failed",
        message: error.message
      });
    } finally {
      setIsActionLoading(false);
      setProcessingId(null);
      setMenuOpenId(null);
    }
  };

  const handleMarketplaceVisibility = async (bot: any) => {
    setProcessingId(bot.id);
    try {
      const visible = !Boolean(bot.marketplace_visible);
      const res = await apiFetch(`/api/publisher/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "set_marketplace_visibility", visible }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update marketplace visibility");
      await fetchBots(true);
      setNotification({
        type: "success",
        title: "Marketplace Updated",
        message: visible ? "Bot is visible in the marketplace." : "Bot is hidden from the marketplace.",
      });
    } catch (error: any) {
      setNotification({ type: "error", title: "Update Failed", message: error.message });
    } finally {
      setProcessingId(null);
      setMenuOpenId(null);
    }
  };

  const handleRemove = async (id: number) => {
    setIsActionLoading(true);
    try {
      const res = await apiFetch(`/api/publisher/bots/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove bot");
      }
      
      await fetchBots(true);
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      setNotification({
        type: "success",
        title: "Bot Removed",
        message: "The bot has been successfully removed."
      });
    } catch (error: any) {
      setNotification({
        type: "error",
        title: "Removal Failed",
        message: error.message
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active": return <CheckCircle2 className="text-emerald-500" size={14} />;
      case "pending": return <Clock className="text-amber-500" size={14} />;
      case "paused": return <PauseCircle className="text-slate-400" size={14} />;
      case "token_invalid":
      case "bot_deleted":
      case "unreachable":
      case "deleted":
        return <XCircle className="text-red-500" size={14} />;
      default: return null;
    }
  };

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Monetize Bots</h1>
          <div className="flex items-center gap-2">
            <Link href="/docs/publisher/bots#overview" className="w-10 h-10 rounded-full border border-slate-200 bg-white text-slate-400 flex items-center justify-center hover:text-blue-600 transition-all">
              <HelpCircle size={18} />
            </Link>
            <button
              onClick={() => setIsAddingBot(true)}
              className="w-10 h-10 bg-[#0c9de8] text-white rounded-full flex items-center justify-center hover:bg-blue-600 transition-all active:scale-95"
            >
              <Plus size={24} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Loading Bots...</p>
          </div>
        ) : bots.length === 0 ? (
          <div className="py-20 text-center space-y-6">
            <div className="w-20 h-20 bg-indigo-50 rounded-[32px] flex items-center justify-center mx-auto text-indigo-300">
              <Bot size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900">No bots yet</h3>
              <p className="text-slate-400 text-sm max-w-[240px] mx-auto font-medium">
                Add your Telegram bot API token to start earning from automated ads.
              </p>
            </div>
            <button
              onClick={() => setIsAddingBot(true)}
              className="text-[#0c9de8] font-black text-sm uppercase tracking-widest"
            >
              Add My First Bot
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {bots.map((bot) => (
              <div
                key={bot.id}
                className="relative bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-4 group"
              >
                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shrink-0">
                  <Bot size={24} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-slate-900 truncate text-sm">{bot.bot_name}</h3>
                    {getStatusIcon(bot.status)}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold tracking-tight text-slate-400">
                    <span>@{bot.bot_username}</span>
                    <span className="w-1 h-1 bg-slate-200 rounded-full" />
                    <span>{bot.posts_per_day} post/day</span>
                  </div>
                  {(bot.paused_reason || bot.suggested_fix) && (
                    <div className="mt-1 text-[10px] font-semibold text-slate-500">
                      {bot.paused_reason || bot.suggested_fix}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === bot.id ? null : bot.id);
                    }}
                    className="w-10 h-10 flex items-center justify-center text-slate-400 hover:bg-slate-50 rounded-full transition-all"
                  >
                    <MoreVertical size={20} />
                  </button>

                  <AnimatePresence>
                    {menuOpenId === bot.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        className="absolute right-0 top-12 w-48 bg-white border border-slate-100 rounded-2xl p-2 z-[100] shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setViewingBot(bot);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all"
                        >
                          <FileText size={16} /> View Details
                        </button>
                        <button
                          onClick={() => {
                            setAddingUsersToBot(bot);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all mt-1"
                        >
                          <Users size={16} /> Add users
                        </button>
                        <button
                          onClick={() => {
                            setEditingBot(bot);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all mt-1"
                        >
                          <Edit3 size={16} /> Edit Bot
                        </button>
                        <button
                          disabled={bot.status === "pending" || processingId === bot.id}
                          onClick={() => handleToggleStatus(bot.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold rounded-xl transition-all mt-1",
                            bot.status === "pending" || processingId === bot.id
                              ? "text-slate-300 cursor-not-allowed"
                              : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          {processingId === bot.id ? (
                            "Processing..."
                          ) : bot.status !== "active" ? (
                            <><Play size={16} /> Resume</>
                          ) : (
                            <><Pause size={16} /> Pause</>
                          )}
                        </button>
                        <button
                          onClick={() => handleMarketplaceVisibility(bot)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all mt-1"
                        >
                          <Eye size={16} /> {bot.marketplace_visible ? "Hide from Marketplace" : "Visible in Marketplace"}
                        </button>
                        <button
                          onClick={() => setConfirmModal({
                            isOpen: true,
                            id: bot.id,
                            title: "Remove Bot",
                            message: `Are you sure you want to remove @${bot.bot_username}?`,
                            confirmText: "Remove"
                          })}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-all mt-1"
                        >
                          <Trash2 size={16} /> Remove
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => confirmModal.id && handleRemove(confirmModal.id)}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmBtnText={confirmModal.confirmText}
        confirmBtnVariant="danger"
        isLoading={isActionLoading}
      />

      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />

      <AnimatePresence>
        {isAddingBot && (
          <AddBotScreen
            onClose={() => setIsAddingBot(false)}
            onSuccess={() => {
              setIsAddingBot(false);
              fetchBots(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingBot && (
          <BotDetailsScreen
            bot={viewingBot}
            onClose={() => setViewingBot(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {addingUsersToBot && (
          <AddBotUsersScreen
            bot={addingUsersToBot}
            onClose={() => setAddingUsersToBot(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editingBot && (
          <AddBotScreen
            bot={editingBot}
            onClose={() => setEditingBot(null)}
            onSuccess={() => {
              setEditingBot(null);
              fetchBots(true);
            }}
          />
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
