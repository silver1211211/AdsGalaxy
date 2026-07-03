"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Plus,
  Tv,
  MoreVertical,
  Pause,
  Play,
  CheckCircle2,
  Clock,
  XCircle,
  PauseCircle,
  FileText,
  Target,
  BarChart3,
  DollarSign,
  Loader2,
  Smartphone,
  Bot,
  ArrowRight,
  X,
  Eye,
  MousePointer2,
  Edit2,
  TrendingUp,
  Sparkles,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import { useHeader } from "@/context/HeaderContext";
import { useRouter } from "next/navigation";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import CampaignDetailsScreen from "@/components/advertiser/CampaignDetailsScreen";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import Link from "next/link";

const CREATE_OPTIONS = [
  {
    key: "channel",
    href: "/advertiser/campaigns/new/channel",
    icon: Tv,
    title: "Channel Campaign",
    tagline: "Post ads in active Telegram channels",
    badge: "Most Popular",
  },
  {
    key: "miniapp",
    href: "/advertiser/miniapp-rewarded",
    icon: Smartphone,
    title: "Mini App Campaign",
    tagline: "Rewarded ads inside Telegram Mini Apps",
    badge: "High Engagement",
  },
  {
    key: "bot",
    href: "/advertiser/campaigns/new/bot",
    icon: Bot,
    title: "Bot Campaign",
    tagline: "Direct inbox delivery via Telegram bots",
    badge: "Direct Reach",
  },
];

interface Campaign {
  id: number;
  name: string;
  kind: "channel" | "bot" | "miniapp";
  type: string;
  status: "pending" | "approved" | "active" | "paused" | "completed" | "rejected" | "budget_exhausted";
  budget: string | number;
  cpm: string | number;
  message_text: string;
  image_url: string | null;
  link: string;
  button_text: string;
  category: string;
  continents: string;
  created_at: string;
  // miniapp stats
  impressions?: number;
  spend?: number;
  clicks?: number;
}

export default function MyCampaignsPage() {
  const { setTitle } = useHeader();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [viewingCampaign, setViewingCampaign] = useState<Campaign | null>(null);
  const [fundingCampaign, setFundingCampaign] = useState<Campaign | null>(null);
  const [fundingAmount, setFundingAmount] = useState("");
  const [error, setError] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    id: number | null;
    title: string;
    message: string;
    confirmText: string;
    action: "remove" | "status";
    kind?: Campaign["kind"];
  }>({
    isOpen: false,
    id: null,
    title: "",
    message: "",
    confirmText: "Remove",
    action: "remove"
  });

  const fetchCampaigns = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [regularRes, miniappRes] = await Promise.all([
        apiFetch("/api/advertiser/campaigns"),
        apiFetch("/api/advertiser/miniapp-rewarded-campaigns"),
      ]);
      const regularData = regularRes.ok ? await regularRes.json() : [];
      const miniappData = miniappRes.ok ? await miniappRes.json() : [];

      const regular = (Array.isArray(regularData) ? regularData : []).map((c: any) => ({
        ...c,
        kind: c.type === "broadcast" ? "bot" : "channel",
      }));

      const miniapp = (Array.isArray(miniappData) ? miniappData : []).map((c: any) => ({
        id: c.id,
        name: c.campaign_name,
        kind: "miniapp" as const,
        type: "rewarded",
        status: c.status,
        budget: c.budget,
        cpm: c.advertiser_cpm_bid,
        message_text: c.description || "",
        image_url: c.image_url || null,
        link: c.landing_url || "",
        button_text: c.cta_text || "",
        category: "",
        continents: "[]",
        created_at: c.created_at,
        impressions: Number(c.impressions || 0),
        spend: Number(c.spend || 0),
        clicks: Number(c.clicks || 0),
      }));

      const all = [...regular, ...miniapp].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setCampaigns(all);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setTitle("Campaigns");
    fetchCampaigns();

    const handleClick = () => setMenuOpenId(null);
    window.addEventListener("click", handleClick);

    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) {
      const handleBack = () => {
        if (fundingCampaign) setFundingCampaign(null);
        else if (viewingCampaign) setViewingCampaign(null);
      };

      if (fundingCampaign || viewingCampaign) {
        webapp.BackButton.show();
        webapp.BackButton.onClick(handleBack);
      } else {
        webapp.BackButton.hide();
      }

      return () => {
        window.removeEventListener("click", handleClick);
        webapp.BackButton.offClick(handleBack);
      };
    }

    return () => window.removeEventListener("click", handleClick);
  }, [setTitle, fundingCampaign, viewingCampaign]);

  const handleAddFund = async () => {
    if (!fundingCampaign || !fundingAmount || isActionLoading) return;
    
    setIsActionLoading(true);
    setProcessingId(fundingCampaign.id);
    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) webapp.HapticFeedback.impactOccurred('medium');

    try {
      const res = await apiFetch(`/api/advertiser/campaigns/${fundingCampaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "add_fund", amount: fundingAmount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add funds");
      
      setFundingCampaign(null);
      setFundingAmount("");
      await fetchCampaigns(true);
      if (webapp) webapp.HapticFeedback.notificationOccurred('success');
      setNotification({
        type: "success",
        title: "Funds Added",
        message: `$${fundingAmount} has been added to your campaign budget.`
      });
    } catch (error: any) {
      if (webapp) webapp.HapticFeedback.notificationOccurred('error');
      setNotification({
        type: "error",
        title: "Funding Failed",
        message: error.message
      });
    } finally {
      setIsActionLoading(false);
      setProcessingId(null);
    }
  };

  const handleToggleStatus = async (id: number) => {
    setIsActionLoading(true);
    setProcessingId(id);
    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) webapp.HapticFeedback.impactOccurred('medium');

    try {
      const res = await apiFetch(`/api/advertiser/campaigns/${id}`, { 
        method: "PATCH",
        body: JSON.stringify({ action: "toggle" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      
      await fetchCampaigns(true);
      if (webapp) webapp.HapticFeedback.notificationOccurred('success');
      setNotification({
        type: "success",
        title: "Status Updated",
        message: "Your campaign status has been updated successfully."
      });
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
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

  const handleMiniappToggleStatus = async (campaign: Campaign) => {
    setIsActionLoading(true);
    setProcessingId(campaign.id);
    try {
      const action = campaign.status === "paused" ? "resume" : "pause";
      const res = await apiFetch(`/api/advertiser/miniapp-rewarded-campaigns/${campaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} campaign`);
      await fetchCampaigns(true);
      setNotification({ type: "success", title: "Status Updated", message: `Campaign ${action === "pause" ? "paused" : "resumed"} successfully.` });
      setConfirmModal((previous) => ({ ...previous, isOpen: false }));
    } catch (error: unknown) {
      setNotification({ type: "error", title: "Update Failed", message: error instanceof Error ? error.message : "Failed to update campaign" });
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
      const res = await apiFetch(`/api/advertiser/campaigns/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove campaign");
      
      await fetchCampaigns(true);
      if (webapp) webapp.HapticFeedback.notificationOccurred('success');
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      setNotification({
        type: "success",
        title: "Campaign Removed",
        message: "The campaign has been successfully deleted."
      });
    } catch (error: any) {
      if (webapp) webapp.HapticFeedback.notificationOccurred('error');
      setNotification({
        type: "error",
        title: "Deletion Failed",
        message: error.message
      });
    } finally {
      setIsActionLoading(false);
      setProcessingId(null);
    }
  };

  const openEdit = (campaign: Campaign) => {
    setMenuOpenId(null);
    router.push(`/advertiser/miniapp-rewarded?edit=${campaign.id}`);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
      case "active": return <CheckCircle2 className="text-emerald-500" size={14} />;
      case "pending": return <Clock className="text-amber-500" size={14} />;
      case "rejected": return <XCircle className="text-red-500" size={14} />;
      case "paused": return <PauseCircle className="text-slate-400" size={14} />;
      default: return null;
    }
  };

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-blue-950/20">
          <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#0c9de8]/30 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-blue-100">
                <Sparkles size={12} />
                Campaign command
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">Active Ads</h1>
                <p className="mt-1 max-w-sm text-sm font-medium leading-relaxed text-blue-100/75">
                  Monitor every channel, bot, and rewarded mini app campaign without changing your existing flow.
                </p>
              </div>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-white/10 text-blue-100 ring-1 ring-white/10 sm:flex">
              <Megaphone size={25} />
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="relative mt-5 w-full rounded-2xl bg-[#0c9de8] px-5 py-4 text-sm font-black uppercase tracking-widest text-white flex items-center justify-center gap-2 hover:bg-blue-500 transition-all active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <Plus size={18} />
            Launch Campaign
          </button>
        </div>

        <Modal 
          isOpen={!!error} 
          onClose={() => setError("")} 
          type="error" 
          title="Campaign Error"
        >
          {error}
        </Modal>

        {/* Campaigns List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="animate-pulse rounded-[2rem] border border-slate-100 bg-white p-5">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 shrink-0 rounded-2xl bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/2 rounded-full bg-slate-100" />
                    <div className="h-2.5 w-2/3 rounded-full bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-20 text-center space-y-6 rounded-[2rem] border border-dashed border-blue-100 bg-white/80">
            <div className="w-20 h-20 bg-blue-50 rounded-[32px] flex items-center justify-center mx-auto text-[#0c9de8]">
              <Target size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900 uppercase">No Active Ads</h3>
              <p className="text-slate-400 text-sm max-w-[240px] mx-auto font-medium">
                Create your first advertising campaign to reach thousands of Telegram users.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
                className="text-[#0c9de8] font-black text-sm uppercase tracking-widest inline-flex rounded-2xl bg-blue-50 px-5 py-3"
            >
              Launch First Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={`${campaign.kind}-${campaign.id}`}
                className="relative bg-white border border-slate-100 rounded-[2rem] p-5 group hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/50 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border-2",
                    campaign.status === "active" ? "bg-emerald-50 border-emerald-100 text-emerald-500" : "bg-slate-50 border-slate-100 text-slate-400"
                  )}>
                    {campaign.kind === 'miniapp' ? <Smartphone size={28} /> :
                     campaign.kind === 'bot' ? <Bot size={28} /> :
                     campaign.type === 'views' ? <BarChart3 size={28} /> : <Target size={28} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-slate-900 truncate text-sm uppercase">{campaign.name}</h3>
                      {getStatusIcon(campaign.status)}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                      <span className="flex items-center gap-1 font-black text-slate-900">
                        <DollarSign size={10} />{parseFloat(String(campaign.budget)).toFixed(2)}
                      </span>
                      <span className="w-1 h-1 bg-slate-200 rounded-full" />
                      <span>{campaign.kind === 'miniapp' ? 'mini app' : campaign.type}</span>
                      <span className="w-1 h-1 bg-slate-200 rounded-full" />
                      <span className="text-[#0c9de8]">{campaign.status}</span>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === campaign.id ? null : campaign.id);
                      }}
                      className="w-10 h-10 flex items-center justify-center text-slate-400 hover:bg-slate-50 rounded-full transition-all"
                    >
                      <MoreVertical size={20} />
                    </button>

                    <AnimatePresence>
                      {menuOpenId === campaign.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -10 }}
                          className="absolute right-0 bottom-full mb-1 w-48 bg-white border border-slate-100 rounded-2xl p-2 z-[100] shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {campaign.kind === 'miniapp' ? (
                            <>
                              <button
                                onClick={() => openEdit(campaign)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all"
                              >
                                <Edit2 size={16} /> Edit Campaign
                              </button>
                              <button
                                disabled={!['approved', 'active', 'paused'].includes(campaign.status) || processingId === campaign.id}
                                onClick={() => {
                                  if (campaign.status === 'paused') {
                                    handleMiniappToggleStatus(campaign);
                                  } else {
                                    setConfirmModal({ isOpen: true, id: campaign.id, kind: 'miniapp', title: 'Pause Campaign', message: 'Pause this Mini App campaign? It will stop serving ads until you resume it.', confirmText: 'Pause', action: 'status' });
                                    setMenuOpenId(null);
                                  }
                                }}
                                className={cn("mt-1 w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold transition-all", ['approved', 'active', 'paused'].includes(campaign.status) ? "text-slate-700 hover:bg-slate-50" : "cursor-not-allowed text-slate-200")}
                              >
                                {processingId === campaign.id ? <><Loader2 className="animate-spin" size={16} /> Processing...</> : campaign.status === 'paused' ? <><Play size={16} /> Resume Ad</> : <><Pause size={16} /> Pause Ad</>}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => { setViewingCampaign(campaign); setMenuOpenId(null); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all"
                              >
                                <FileText size={16} /> View Details
                              </button>
                              <button
                                onClick={() => { setFundingCampaign(campaign); setMenuOpenId(null); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all mt-1"
                              >
                                <DollarSign size={16} /> Add Fund
                              </button>
                              <button
                                disabled={campaign.status === "pending" || campaign.status === "rejected" || campaign.status === "completed" || campaign.status === "budget_exhausted" || processingId === campaign.id}
                                onClick={() => {
                                  if (campaign.status === "active") {
                                    setConfirmModal({ isOpen: true, id: campaign.id, title: "Pause Campaign", message: "Pausing this campaign will delete all active posts from channels. You cannot resume this campaign for 1 hour unless an admin resumes it manually. Do you want to continue?", confirmText: "Pause", action: "status" });
                                    setMenuOpenId(null);
                                    return;
                                  }
                                  handleToggleStatus(campaign.id);
                                }}
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold rounded-xl transition-all mt-1",
                                  (campaign.status === "pending" || campaign.status === "rejected" || campaign.status === "completed" || campaign.status === "budget_exhausted" || processingId === campaign.id)
                                    ? "text-slate-200 cursor-not-allowed"
                                    : "text-slate-700 hover:bg-slate-50"
                                )}
                              >
                                {processingId === campaign.id ? <><Loader2 className="animate-spin" size={16} /> Processing...</> : campaign.status === "paused" ? <><Play size={16} /> Resume Ad</> : <><Pause size={16} /> Pause Ad</>}
                              </button>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Stats row for miniapp campaigns */}
                {campaign.kind === 'miniapp' && (campaign.impressions! > 0 || campaign.status === 'active') && (
                  <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                      <Eye size={11} className="text-slate-300" />
                      <span className="font-black text-slate-700">{(campaign.impressions || 0).toLocaleString()}</span>
                      <span>IMPR</span>
                    </div>
                    <div className="w-px h-3 bg-slate-100" />
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                      <TrendingUp size={11} className="text-slate-300" />
                      <span className="font-black text-slate-700">{(campaign.clicks || 0).toLocaleString()}</span>
                      <span>CLICKS</span>
                    </div>
                    <div className="w-px h-3 bg-slate-100" />
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                      <DollarSign size={11} className="text-slate-300" />
                      <span className="font-black text-slate-700">${(campaign.spend || 0).toFixed(2)}</span>
                      <span>SPEND</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Fund Bottom Sheet (Styled Modal) */}
      <AnimatePresence>
        {fundingCampaign && (
          <div className="fixed inset-0 z-[500] flex items-end justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFundingCampaign(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full max-w-[500px] bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 pb-10 shadow-2xl overflow-hidden"
            >
              {/* Handle Bar */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-slate-200 rounded-full" />
              
              <div className="space-y-6 mt-4">
                <div className="text-center">
                  <h3 className="text-xl font-black text-slate-900 uppercase">Add Funds</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                    To: {fundingCampaign.name}
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Amount ($)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-900 font-bold" size={20} />
                    <input 
                      type="number"
                      value={fundingAmount}
                      onChange={(e) => setFundingAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:border-[#0c9de8] outline-none font-black text-slate-900 text-xl transition-all"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                  <p className="text-[10px] font-medium text-blue-600 leading-relaxed">
                    Funds will be deducted from your main ad balance and locked for this campaign.
                  </p>
                </div>

                <button 
                  disabled={!fundingAmount || parseFloat(fundingAmount) <= 0 || isActionLoading}
                  onClick={handleAddFund}
                  className="w-full py-4 bg-[#0c9de8] text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:grayscale transition-all active:scale-95"
                >
                  {isActionLoading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                  {isActionLoading ? "Processing..." : "Confirm & Add"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          if (!confirmModal.id) return;
          if (confirmModal.action === "status") {
            if (confirmModal.kind === "miniapp") {
              const campaign = campaigns.find((item) => item.id === confirmModal.id && item.kind === "miniapp");
              if (campaign) handleMiniappToggleStatus(campaign);
            } else {
              handleToggleStatus(confirmModal.id);
            }
          } else {
            handleRemove(confirmModal.id);
          }
        }}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmBtnText={confirmModal.confirmText}
        confirmBtnVariant={confirmModal.action === "remove" ? "danger" : "primary"}
        closeBtnText="Cancel"
        isLoading={isActionLoading}
      />

      <AnimatePresence>
        {viewingCampaign && (
          <CampaignDetailsScreen
            campaign={viewingCampaign}
            onClose={() => setViewingCampaign(null)}
          />
        )}
      </AnimatePresence>

      {/* Views vs Click picker */}
      <AnimatePresence>
        {showTypeModal && (
          <div className="fixed inset-0 z-[600] flex items-end justify-center sm:items-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTypeModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-200 rounded-full sm:hidden" />

              <div className="flex items-center justify-between px-6 pt-7 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-black uppercase tracking-tight text-slate-900">Campaign Objective</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">How do you want to pay for your ad?</p>
                </div>
                <button
                  onClick={() => setShowTypeModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-2">
                <button
                  onClick={() => { setShowTypeModal(false); router.push("/advertiser/campaigns/new/channel?type=views"); }}
                  className="w-full flex items-center gap-4 px-4 py-5 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                    <Eye size={22} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Views Campaign</p>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Pay per 1,000 channel post views</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                </button>

                <button
                  onClick={() => { setShowTypeModal(false); router.push("/advertiser/campaigns/new/channel?type=clicks"); }}
                  className="w-full flex items-center gap-4 px-4 py-5 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                    <MousePointer2 size={22} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Click Campaign</p>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Pay per button or link click</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                </button>
              </div>

              <div className="px-4 pb-6 pt-1">
                <p className="text-center text-[11px] text-slate-400 font-medium">Views = broad reach · Clicks = direct conversions</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success/Error Toast (Non-blocking) */}
      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />

      {/* Create Campaign Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[600] flex items-end justify-center sm:items-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              {/* Handle */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-200 rounded-full sm:hidden" />

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-7 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-black uppercase tracking-tight text-slate-900">Create Campaign</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Choose how you want to advertise</p>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Options */}
              <div className="p-4 space-y-2">
                {CREATE_OPTIONS.map((opt) => {
                  const isChannel = opt.key === "channel";
                  const handleClick = () => {
                    setShowCreateModal(false);
                    if (isChannel) { setShowTypeModal(true); }
                    else { router.push(opt.href); }
                  };
                  return (
                    <button
                      key={opt.key}
                      onClick={handleClick}
                      className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border border-slate-100 bg-white hover:border-[#0c9de8] hover:bg-blue-50/50 transition-all group text-left"
                    >
                      <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-[#0c9de8] group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                        <opt.icon size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{opt.title}</p>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">{opt.tagline}</p>
                      </div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-[#0c9de8] shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>

              <div className="px-4 pb-6">
                <p className="text-center text-[11px] text-slate-400 font-medium">Channel campaigns are the most common starting point</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
