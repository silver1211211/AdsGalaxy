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
  Target,
  BarChart3,
  DollarSign,
  Loader2
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

interface Campaign {
  id: number;
  name: string;
  type: "views" | "clicks";
  status: "pending" | "active" | "paused" | "completed" | "rejected" | "budget_exhausted";
  budget: string;
  cpm: string;
  message_text: string;
  image_url: string | null;
  link: string;
  button_text: string;
  category: string;
  continents: string;
  created_at: string;
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

  const fetchCampaigns = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await apiFetch("/api/advertiser/campaigns");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setCampaigns(data);
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
    <DashboardLayout type="advertiser">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Active Ads</h1>
          <Link
            href="/advertiser/campaigns/new"
            className="w-10 h-10 bg-[#0c9de8] text-white rounded-full flex items-center justify-center hover:bg-blue-600 transition-all active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <Plus size={24} />
          </Link>
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
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-3 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Syncing...</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-20 text-center space-y-6">
            <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center mx-auto text-slate-300">
              <Target size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900 uppercase">No Active Ads</h3>
              <p className="text-slate-400 text-sm max-w-[240px] mx-auto font-medium">
                Create your first advertising campaign to reach thousands of Telegram users.
              </p>
            </div>
            <Link
              href="/advertiser/campaigns/new"
              className="text-[#0c9de8] font-black text-sm uppercase tracking-widest inline-block"
            >
              Launch First Campaign
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="relative bg-white border border-slate-100 rounded-[2rem] p-5 flex items-center gap-4 group hover:border-slate-200 transition-all"
              >
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border-2",
                  campaign.status === "active" ? "bg-emerald-50 border-emerald-100 text-emerald-500" : "bg-slate-50 border-slate-100 text-slate-400"
                )}>
                  {campaign.type === 'views' ? <BarChart3 size={28} /> : <Target size={28} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-slate-900 truncate text-sm uppercase">{campaign.name}</h3>
                    {getStatusIcon(campaign.status)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                    <span className="flex items-center gap-1 font-black text-slate-900"><DollarSign size={10} />{campaign.budget}</span>
                    <span className="w-1 h-1 bg-slate-200 rounded-full" />
                    <span>{campaign.type}</span>
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
                        className="absolute right-0 top-12 w-48 bg-white border border-slate-100 rounded-2xl p-2 z-[100] shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setViewingCampaign(campaign);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all"
                        >
                          <FileText size={16} /> View Details
                        </button>
                        <button
                          onClick={() => {
                            setFundingCampaign(campaign);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-all mt-1"
                        >
                          <DollarSign size={16} /> Add Fund
                        </button>
                        <button
                          disabled={campaign.status === "pending" || campaign.status === "rejected" || campaign.status === "completed" || campaign.status === "budget_exhausted" || processingId === campaign.id}
                          onClick={() => {
                            if (campaign.status === "active") {
                              setConfirmModal({
                                isOpen: true,
                                id: campaign.id,
                                title: "Pause Campaign",
                                message: "Pausing this campaign will delete all active posts from channels. You cannot resume this campaign for 1 hour unless an admin resumes it manually. Do you want to continue?",
                                confirmText: "Pause",
                                action: "status"
                              });
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
                          {processingId === campaign.id ? (
                            <><Loader2 className="animate-spin" size={16} /> Processing...</>
                          ) : campaign.status === "paused" ? (
                            <><Play size={16} /> Resume Ad</>
                          ) : (
                            <><Pause size={16} /> Pause Ad</>
                          )}
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
            handleToggleStatus(confirmModal.id);
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

      {/* Success/Error Toast (Non-blocking) */}
      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />
    </DashboardLayout>
  );
}
