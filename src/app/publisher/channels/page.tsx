"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Plus,
  Tv,
  MoreVertical,
  ExternalLink,
  Trash2,
  Pause,
  Play,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  PauseCircle,
  FileText,
  Loader2,
  Edit3
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import AddChannelScreen from "@/components/publisher/AddChannelScreen";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Toast from "@/components/ui/Toast";
import ChannelDetailsScreen from "@/components/publisher/ChannelDetailsScreen";
import { useHeader } from "@/context/HeaderContext";

export default function MyChannels() {
  const { setTitle } = useHeader();
  const [channels, setChannels] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isAddingChannel, setIsAddingChannel] = useState(false);
  const [viewingChannel, setViewingChannel] = useState<any | null>(null);
  const [editingChannel, setEditingChannel] = useState<any | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);

  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    id: number | null;
    title: string;
    message: string;
    confirmText: string;
    action: "remove" | "status";
  }>({
    isOpen: false,
    id: null,
    title: "",
    message: "",
    confirmText: "Remove",
    action: "remove"
  });

  const fetchChannels = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await apiFetch("/api/publisher/channels");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setChannels(data);
    } catch (error) {
      console.error("Error fetching channels:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();

    // Close menu when clicking outside
    const handleClick = () => setMenuOpenId(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleToggleStatus = async (id: number) => {
    setIsActionLoading(true);
    setProcessingId(id);
    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) webapp.HapticFeedback.impactOccurred('medium');

    try {
      const res = await apiFetch(`/api/publisher/channels/${id}`, { 
        method: "PATCH",
        body: JSON.stringify({ action: "toggle_status" }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      
      await fetchChannels(true);
      if (webapp) webapp.HapticFeedback.notificationOccurred('success');
      setNotification({
        type: "success",
        title: "Status Updated",
        message: "Your channel status has been updated successfully."
      });
    } catch (error: any) {
      if (webapp) webapp.HapticFeedback.notificationOccurred('error');
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

  const handleRemove = async (id: number) => {
    setIsActionLoading(true);
    setProcessingId(id);
    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) webapp.HapticFeedback.impactOccurred('medium');

    try {
      const res = await apiFetch(`/api/publisher/channels/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove channel");
      
      await fetchChannels(true);
      if (webapp) webapp.HapticFeedback.notificationOccurred('success');
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      setNotification({
        type: "success",
        title: "Channel Removed",
        message: "The channel has been successfully removed from your account."
      });
    } catch (error: any) {
      if (webapp) webapp.HapticFeedback.notificationOccurred('error');
      setNotification({
        type: "error",
        title: "Removal Failed",
        message: error.message
      });
    } finally {
      setIsActionLoading(false);
      setProcessingId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active": return <CheckCircle2 className="text-emerald-500" size={14} />;
      case "pending": return <Clock className="text-amber-500" size={14} />;
      case "rejected": return <XCircle className="text-red-500" size={14} />;
      case "paused": return <PauseCircle className="text-slate-400" size={14} />;
      default: return null;
    }
  };

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Channels</h1>
          <button
            onClick={() => setIsAddingChannel(true)}
            className="w-10 h-10 bg-[#0c9de8] text-white rounded-full flex items-center justify-center hover:bg-blue-600 transition-all active:scale-95"
          >
            <Plus size={24} />
          </button>
        </div>

        {/* Channels List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-3 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Loading...</p>
          </div>
        ) : channels.length === 0 ? (
          <div className="py-20 text-center space-y-6">
            <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center mx-auto text-slate-300">
              <Tv size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900">Start here</h3>
              <p className="text-slate-400 text-sm max-w-[240px] mx-auto font-medium">
                Add your first Telegram channel to join the advertising network.
              </p>
            </div>
            <button
              onClick={() => setIsAddingChannel(true)}
              className="text-[#0c9de8] font-black text-sm uppercase tracking-widest"
            >
              Add Channel
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="relative bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-4 group"
              >
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 shrink-0">
                  <Tv size={24} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-slate-900 truncate text-sm">{channel.title}</h3>
                    {getStatusIcon(channel.status)}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                    <span>@{channel.username}</span>
                    <span className="w-1 h-1 bg-slate-200 rounded-full" />
                    <span>{channel.posts_per_day} post/day</span>
                  </div>
                </div>

                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === channel.id ? null : channel.id);
                    }}
                    className="w-10 h-10 flex items-center justify-center text-slate-400 hover:bg-slate-50 rounded-full transition-all"
                  >
                    <MoreVertical size={20} />
                  </button>

                  <AnimatePresence>
                    {menuOpenId === channel.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        className="absolute right-0 top-12 w-48 bg-white border border-slate-100 rounded-2xl p-2 z-[100] shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setViewingChannel(channel);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all"
                        >
                          <FileText size={16} /> View Details
                        </button>
                        <button
                          onClick={() => {
                            setEditingChannel(channel);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all mt-1"
                        >
                          <Edit3 size={16} /> Edit Channel
                        </button>
                        <button
                          disabled={channel.status === "pending" || processingId === channel.id}
                          onClick={() => handleToggleStatus(channel.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold rounded-xl transition-all mt-1",
                            channel.status === "pending" || processingId === channel.id
                              ? "text-slate-300 cursor-not-allowed"
                              : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          {processingId === channel.id ? (
                            <><Loader2 className="animate-spin" size={16} /> Processing...</>
                          ) : channel.status === "paused" ? (
                            <><Play size={16} /> Resume Channel</>
                          ) : (
                            <><Pause size={16} /> Pause Channel</>
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmModal({
                            isOpen: true,
                            id: channel.id,
                            title: "Remove Channel",
                            message: `Are you sure you want to remove @${channel.username}? This action cannot be undone.`,
                            confirmText: "Remove",
                            action: "remove"
                          })}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-all mt-1"
                        >
                          <Trash2 size={16} /> Remove Channel
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

      {/* Confirmation Modal */}
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

      {/* Success/Error Toast (Non-blocking) */}
      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />

      <AnimatePresence>
        {isAddingChannel && (
          <AddChannelScreen
            onClose={() => setIsAddingChannel(false)}
            onSuccess={() => {
              setIsAddingChannel(false);
              fetchChannels(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingChannel && (
          <AddChannelScreen
            channel={editingChannel}
            onClose={() => setEditingChannel(null)}
            onSuccess={() => {
              setEditingChannel(null);
              fetchChannels(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingChannel && (
          <ChannelDetailsScreen
            channel={viewingChannel}
            onClose={() => setViewingChannel(null)}
          />
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
