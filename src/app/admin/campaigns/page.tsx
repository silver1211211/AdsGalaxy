"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Check, X, Eye, Search, Pause, Play, Zap } from "lucide-react";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Toast from "@/components/ui/Toast";

type CampaignConfirmActionType = "approve" | "reject" | "pause" | "resume";
type ConfirmAction = {
  id: number;
  kind: string;
  action: CampaignConfirmActionType;
  title: string;
  message: string;
  danger?: boolean;
} | null;

type EmergencyAction = {
  id: number;
  mode: "fill_empty_slots" | "replace_everything";
} | null;

type AdminCampaignRow = {
  id: number;
  campaign_kind: "campaign" | "miniapp";
  user_id: number;
  name: string;
  type: string;
  status: string;
  budget: string | number;
  cpm: string | number;
  link: string;
  message_text?: string;
  image_url?: string;
  button_text?: string;
  parse_mode?: string;
  category?: string;
  continents?: string;
  countries?: string;
  languages?: string;
  vpn_policy?: string;
  device_policy?: string;
  os_policy?: string;
  frequency_cap_per_user?: string | number;
  start_at?: string | null;
  end_at?: string | null;
  daily_budget_limit?: string | number | null;
  first_name?: string;
  last_name?: string;
  username?: string;
  telegram_id?: string | number;
  advertiser_trust_level?: string;
  quality_score?: string | number;
  quality_tier?: string;
  advertiser_total_spend?: string | number;
  advertiser_approved_campaigns?: string | number;
  advertiser_rejected_campaigns?: string | number;
};

function renderTargetingList(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "All";
  if (!value) return "All";
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return parsed.length > 0 ? parsed.join(", ") : "All";
  } catch {
    // Plain strings are displayed directly.
  }
  return String(value) || "All";
}

function renderPolicy(value: unknown) {
  const labels: Record<string, string> = {
    allow_all: "Allow all traffic",
    prefer_non_vpn: "Prefer non-VPN traffic",
    exclude_vpn: "Exclude VPN/proxy traffic",
    all: "All",
    mobile: "Mobile only",
    desktop: "Desktop only",
    android: "Android",
    ios: "iOS",
    desktop_web: "Desktop/Web",
  };
  return labels[String(value || "all")] || "All";
}

function renderDateRestriction(value: unknown) {
  if (!value) return "No restriction";
  return new Date(String(value)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AdminCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [trustFilter, setTrustFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [emergencyAction, setEmergencyAction] = useState<EmergencyAction>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);
  
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<AdminCampaignRow | null>(null);

  const fetchCampaigns = async (p: number, s: string, q: string, trust = trustFilter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}&trust=${encodeURIComponent(trust)}`);
      const data = await res.json();
      setCampaigns(data.campaigns);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCampaigns(page, statusFilter, search, trustFilter);
    }, 500);
    return () => clearTimeout(timer);
  }, [page, statusFilter, trustFilter, search]);

  const handleAction = async (id: number, action: string, kind = "campaign") => {
    setActionLoading(id);
    try {
      const endpoint = kind === "miniapp" ? "/api/admin/miniapp-rewarded-campaigns" : "/api/admin/campaigns";
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      await fetchCampaigns(page, statusFilter, search, trustFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleManagementAction = async (id: number, action: "pause" | "resume", kind = "campaign") => {
    setActionLoading(id);
    try {
      if (kind === "miniapp") {
        const res = await fetch("/api/admin/miniapp-rewarded-campaigns", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Action failed");
      } else {
        const res = await fetch(`/api/admin/campaigns/${id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Action failed");
      }
      await fetchCampaigns(page, statusFilter, search, trustFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmergencyPush = async (id: number, mode: "fill_empty_slots" | "replace_everything", confirmation = "") => {
    const label = mode === "fill_empty_slots" ? "Fill Empty Slots" : "Replace Everything";

    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/emergency-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirmation })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${label} failed`);
      setToast({
        type: "success",
        title: `${label} complete`,
        message: `Posted: ${data.posted || 0}, Failed: ${data.failed || 0}, Skipped: ${data.skipped || 0}`,
      });
      await fetchCampaigns(page, statusFilter, search, trustFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setActionLoading(null);
    }
  };
  
  const openViewModal = (campaign: AdminCampaignRow) => {
    setSelectedCampaign(campaign);
    setViewModalOpen(true);
  };

  const openConfirmAction = (id: number, kind: string, action: CampaignConfirmActionType, title: string, message: string, danger = false) => {
    setConfirmAction({ id, kind, action, title, message, danger });
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const { id, kind, action } = confirmAction;
    setConfirmAction(null);
    if (action === "approve" || action === "reject") {
      await handleAction(id, action, kind);
    } else {
      await handleManagementAction(id, action as "pause" | "resume", kind);
    }
  };

  const openEmergencyConfirm = (id: number, mode: "fill_empty_slots" | "replace_everything") => {
    setTypedConfirmation("");
    setEmergencyAction({ id, mode });
  };

  const runEmergencyConfirm = async () => {
    if (!emergencyAction) return;
    const { id, mode } = emergencyAction;
    const confirmation = mode === "replace_everything" ? typedConfirmation : "";
    setEmergencyAction(null);
    setTypedConfirmation("");
    await handleEmergencyPush(id, mode, confirmation);
  };

  const renderContinents = (continentsStr: unknown) => {
    if (!continentsStr) return <span className="font-medium text-slate-900">All</span>;
    const continentsText = String(continentsStr);
    try {
      const parsed = JSON.parse(continentsText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (
          <div className="flex flex-wrap gap-1 mt-1">
            {parsed.map((continent: string) => (
              <span key={continent} className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded text-[10px] font-semibold uppercase tracking-wider">
                {continent.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        );
      }
    } catch {
      // Fallback if not JSON
    }
    return <span className="font-medium text-slate-900">{continentsText}</span>;
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>
      <Toast
        isOpen={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || "success"}
        title={toast?.title || ""}
        message={toast?.message || ""}
      />
      <ConfirmationModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={runConfirmedAction}
        title={confirmAction?.title || ""}
        message={confirmAction?.message || ""}
        confirmBtnText="Confirm"
        confirmBtnVariant={confirmAction?.danger ? "danger" : "primary"}
        isLoading={actionLoading !== null}
      />
      <ConfirmationModal
        isOpen={!!emergencyAction}
        onClose={() => { setEmergencyAction(null); setTypedConfirmation(""); }}
        onConfirm={runEmergencyConfirm}
        title={emergencyAction?.mode === "replace_everything" ? "Emergency Push: Replace Everything" : "Emergency Push: Fill Empty Slots"}
        message={emergencyAction?.mode === "replace_everything"
          ? "This deletes currently active ads before pushing this campaign. Type CONFIRM to continue."
          : "Emergency push this campaign to eligible empty channel slots now?"}
        confirmBtnText={emergencyAction?.mode === "replace_everything" ? "Replace Everything" : "Push Now"}
        confirmBtnVariant={emergencyAction?.mode === "replace_everything" ? "danger" : "primary"}
        isLoading={actionLoading !== null}
        typedConfirmation={emergencyAction?.mode === "replace_everything" ? {
          phrase: "CONFIRM",
          value: typedConfirmation,
          onChange: setTypedConfirmation,
        } : undefined}
      />

      {/* View Campaign Modal */}
      {viewModalOpen && selectedCampaign && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Campaign Details (#{selectedCampaign.id})</h3>
              <button onClick={() => setViewModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Creator Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Creator Profile</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{selectedCampaign.first_name} {selectedCampaign.last_name}</span></div>
                    <div><span className="text-slate-500">Username:</span> <span className="font-medium text-slate-900">@{selectedCampaign.username || "N/A"}</span></div>
                    <div><span className="text-slate-500">User ID:</span> <span className="font-medium text-slate-900">{selectedCampaign.user_id}</span></div>
                    <div><span className="text-slate-500">Telegram ID:</span> <span className="font-medium text-slate-900">{selectedCampaign.telegram_id}</span></div>
                  </div>
                </div>
              </div>

              {/* Campaign Content */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Ad Content</h4>
                <div className="bg-slate-50 p-4 rounded-md border border-slate-200 text-sm space-y-4">
                  {selectedCampaign.image_url && (
                    <div>
                      <span className="text-slate-500 block mb-1">Image:</span>
                      <img src={selectedCampaign.image_url} alt="Campaign" className="max-w-full h-auto max-h-48 rounded-md border border-slate-200 object-cover" />
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500 block mb-1">Message ({selectedCampaign.parse_mode}):</span>
                    <div className="bg-white p-3 rounded border border-slate-200 whitespace-pre-wrap font-mono text-xs max-h-60 overflow-y-auto">{selectedCampaign.message_text}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">Link URL:</span> <a href={selectedCampaign.link} target="_blank" className="font-medium text-blue-600 hover:underline block truncate" title={selectedCampaign.link}>{selectedCampaign.link}</a></div>
                    <div><span className="text-slate-500">Button Text:</span> <span className="font-medium text-slate-900">{selectedCampaign.button_text || "N/A"}</span></div>
                  </div>
                </div>
              </div>

              {/* Settings */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Configuration</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div><span className="text-slate-500">Type:</span> <span className="font-medium text-slate-900 capitalize">{selectedCampaign.type}</span></div>
                    <div><span className="text-slate-500">Budget:</span> <span className="font-medium text-slate-900">${selectedCampaign.budget}</span></div>
                    <div><span className="text-slate-500">CPM:</span> <span className="font-medium text-slate-900">${selectedCampaign.cpm}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className="font-medium text-slate-900 capitalize">{selectedCampaign.status}</span></div>
                    <div><span className="text-slate-500">Trust:</span> <span className="font-medium text-slate-900 capitalize">{selectedCampaign.advertiser_trust_level || "new"}</span></div>
                    <div><span className="text-slate-500">Quality:</span> <span className="font-medium text-slate-900 capitalize">{selectedCampaign.quality_score || 50} / {selectedCampaign.quality_tier || "average"}</span></div>
                    <div><span className="text-slate-500">Spend:</span> <span className="font-medium text-slate-900">${selectedCampaign.advertiser_total_spend || 0}</span></div>
                    <div><span className="text-slate-500">Approved:</span> <span className="font-medium text-slate-900">{selectedCampaign.advertiser_approved_campaigns || 0}</span></div>
                    <div><span className="text-slate-500">Rejected:</span> <span className="font-medium text-slate-900">{selectedCampaign.advertiser_rejected_campaigns || 0}</span></div>
                    <div className="col-span-2">
                      <span className="text-slate-500 block">Continents:</span> 
                      {renderContinents(selectedCampaign.continents)}
                    </div>
                    <div className="col-span-2"><span className="text-slate-500">Category:</span> <span className="font-medium text-slate-900">{selectedCampaign.category || "All"}</span></div>
                    <div className="col-span-2 border-t border-slate-200 pt-3">
                      <span className="text-slate-500 block mb-2">Full Targeting Configuration:</span>
                      <div className="grid grid-cols-2 gap-2 rounded-md bg-white p-3 text-xs">
                        <div><span className="text-slate-500">Countries:</span> <span className="font-medium text-slate-900">{renderTargetingList(selectedCampaign.countries)}</span></div>
                        <div><span className="text-slate-500">Languages:</span> <span className="font-medium text-slate-900">{renderTargetingList(selectedCampaign.languages)}</span></div>
                        <div><span className="text-slate-500">VPN:</span> <span className="font-medium text-slate-900">{renderPolicy(selectedCampaign.vpn_policy)}</span></div>
                        <div><span className="text-slate-500">Device:</span> <span className="font-medium text-slate-900">{renderPolicy(selectedCampaign.device_policy)}</span></div>
                        <div><span className="text-slate-500">Platform:</span> <span className="font-medium text-slate-900">{renderPolicy(selectedCampaign.os_policy)}</span></div>
                        <div><span className="text-slate-500">Frequency Cap:</span> <span className="font-medium text-slate-900">{selectedCampaign.frequency_cap_per_user || "No cap"}</span></div>
                        <div><span className="text-slate-500">Start:</span> <span className="font-medium text-slate-900">{renderDateRestriction(selectedCampaign.start_at)}</span></div>
                        <div><span className="text-slate-500">End:</span> <span className="font-medium text-slate-900">{renderDateRestriction(selectedCampaign.end_at)}</span></div>
                        <div className="col-span-2"><span className="text-slate-500">Daily Budget:</span> <span className="font-medium text-slate-900">{selectedCampaign.daily_budget_limit ? `$${selectedCampaign.daily_budget_limit}` : "No cap"}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Campaigns</h2>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder="Search campaigns, owners..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200/50 w-full sm:w-auto">
              {["all", "pending", "active", "rejected", "paused"].map(f => (
                <button
                  key={f}
                  onClick={() => { setPage(1); setStatusFilter(f); }}
                  className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium capitalize rounded transition-all cursor-pointer ${statusFilter === f ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <select
              value={trustFilter}
              onChange={(event) => { setPage(1); setTrustFilter(event.target.value); }}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 sm:w-auto"
            >
              <option value="all">All Trust</option>
              <option value="new">New</option>
              <option value="normal">Normal</option>
              <option value="trusted">Trusted</option>
              <option value="premium">Premium</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">ID & Name</th>
                <th className="px-4 py-3 font-medium">Type & Budget</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : campaigns.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No campaigns found.</td></tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr key={`${campaign.campaign_kind}-${campaign.id}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${campaign.campaign_kind === 'miniapp' ? 'bg-purple-50 text-purple-600 border border-purple-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {campaign.campaign_kind === 'miniapp' ? 'Mini App' : 'Channel/Bot'}
                        </span>
                        <span className="font-medium text-slate-900">{campaign.name}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">ID: #{campaign.id} - User: {campaign.user_id}</div>
                      <div className="text-xs text-slate-500 capitalize">Trust: {campaign.advertiser_trust_level || "new"} - Quality: {campaign.quality_score || 50}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 capitalize">{campaign.type}</div>
                      <div className="text-xs text-slate-500">Budget: ${campaign.budget} - CPM: ${campaign.cpm}</div>
                    </td>
                    <td className="px-4 py-3">
                      <a href={campaign.link} target="_blank" className="text-blue-600 hover:underline block truncate max-w-[150px]">{campaign.link}</a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${campaign.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : campaign.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : campaign.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {campaign.campaign_kind === 'campaign' && (
                          <Link
                            href={`/admin/campaigns/${campaign.id}`}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </Link>
                        )}
                        <button
                          onClick={() => openViewModal(campaign)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          title="Quick View"
                        >
                          <Eye size={16} />
                        </button>
                        {campaign.status === "pending" && (
                          <>
                            <button
                              onClick={() => openConfirmAction(campaign.id, campaign.campaign_kind, "approve", "Approve Campaign", "Approve this campaign?")}
                              disabled={actionLoading === campaign.id}
                              className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Approve"
                            >
                              {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
                            </button>
                            <button
                              onClick={() => openConfirmAction(campaign.id, campaign.campaign_kind, "reject", "Reject Campaign", "Reject this campaign?", true)}
                              disabled={actionLoading === campaign.id}
                              className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Reject"
                            >
                              {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <X size={16} />}
                            </button>
                          </>
                        )}
                        {campaign.status === "active" && (
                          <>
                            {campaign.campaign_kind === 'campaign' && (
                              <>
                                <button
                                  onClick={() => openEmergencyConfirm(campaign.id, "fill_empty_slots")}
                                  disabled={actionLoading === campaign.id}
                                  className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors border border-blue-100 cursor-pointer disabled:cursor-not-allowed"
                                  title="Emergency Push: Fill Empty Slots"
                                >
                                  {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16} />}
                                </button>
                                <button
                                  onClick={() => openEmergencyConfirm(campaign.id, "replace_everything")}
                                  disabled={actionLoading === campaign.id}
                                  className="px-2 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed text-[10px] font-bold"
                                  title="Emergency Push: Replace Everything"
                                >
                                  Replace
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => openConfirmAction(campaign.id, campaign.campaign_kind, "pause", "Pause Campaign", "Pause this campaign?")}
                              disabled={actionLoading === campaign.id}
                              className="p-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-md transition-colors border border-amber-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Pause"
                            >
                              {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Pause size={16} />}
                            </button>
                          </>
                        )}
                        {campaign.status === "paused" && (
                          <button
                            onClick={() => openConfirmAction(campaign.id, campaign.campaign_kind, "resume", "Resume Campaign", "Resume this campaign?")}
                            disabled={actionLoading === campaign.id}
                            className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
                            title="Resume"
                          >
                            {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Play size={16} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><ChevronLeft size={16} /></button>
            <button disabled={page === totalPages || loading} onClick={() => setPage(p => p + 1)} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
