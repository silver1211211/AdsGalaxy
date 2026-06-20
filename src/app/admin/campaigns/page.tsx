"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Check, X, Eye, Search, Pause, Play, Trash2, Zap } from "lucide-react";
import Modal from "@/components/ui/Modal";

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");
  
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);

  const fetchCampaigns = async (p: number, s: string, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}`);
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
      fetchCampaigns(page, statusFilter, search);
    }, 500);
    return () => clearTimeout(timer);
  }, [page, statusFilter, search]);

  const handleAction = async (id: number, action: string) => {
    setActionLoading(id);
    try {
      const res = await fetch("/api/admin/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      if (!res.ok) throw new Error("Action failed");
      await fetchCampaigns(page, statusFilter, search);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleManagementAction = async (id: number, action: "pause" | "resume" | "delete") => {
    const message = action === "delete"
      ? "Delete this campaign? Active Telegram posts will be deleted and the campaign will be marked deleted."
      : `${action === "pause" ? "Pause" : "Resume"} this campaign?`;

    if (!window.confirm(message)) return;

    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      await fetchCampaigns(page, statusFilter, search);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmergencyPush = async (id: number, mode: "fill_empty_slots" | "replace_everything") => {
    const label = mode === "fill_empty_slots" ? "Fill Empty Slots" : "Replace Everything";
    let confirmation = "";

    if (mode === "fill_empty_slots") {
      if (!window.confirm("Emergency push this campaign to eligible empty channel slots now?")) return;
    } else {
      confirmation = window.prompt("This deletes currently active ads before pushing this campaign. Type CONFIRM to continue.") || "";
      if (confirmation !== "CONFIRM") return;
    }

    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/emergency-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirmation })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${label} failed`);
      window.alert(`${label} complete. Posted: ${data.posted || 0}, Failed: ${data.failed || 0}, Skipped: ${data.skipped || 0}`);
      await fetchCampaigns(page, statusFilter, search);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };
  
  const openViewModal = (campaign: any) => {
    setSelectedCampaign(campaign);
    setViewModalOpen(true);
  };

  const renderContinents = (continentsStr: string) => {
    if (!continentsStr) return <span className="font-medium text-slate-900">All</span>;
    try {
      const parsed = JSON.parse(continentsStr);
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
    } catch (e) {
      // Fallback if not JSON
    }
    return <span className="font-medium text-slate-900">{continentsStr}</span>;
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>

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
                    <div className="col-span-2">
                      <span className="text-slate-500 block">Continents:</span> 
                      {renderContinents(selectedCampaign.continents)}
                    </div>
                    <div className="col-span-2"><span className="text-slate-500">Category:</span> <span className="font-medium text-slate-900">{selectedCampaign.category || "All"}</span></div>
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
                campaigns.map((campaign: any) => (
                  <tr key={campaign.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{campaign.name}</div>
                      <div className="text-xs text-slate-500">ID: #{campaign.id} • User: {campaign.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 capitalize">{campaign.type}</div>
                      <div className="text-xs text-slate-500">Budget: ${campaign.budget} • CPM: ${campaign.cpm}</div>
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
                        <Link
                          href={`/admin/campaigns/${campaign.id}`}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          title="View Details"
                        >
                          <Eye size={16} />
                        </Link>
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
                              onClick={() => handleAction(campaign.id, "approve")}
                              disabled={actionLoading === campaign.id}
                              className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Approve"
                            >
                              {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
                            </button>
                            <button 
                              onClick={() => handleAction(campaign.id, "reject")}
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
                            <button
                              onClick={() => handleEmergencyPush(campaign.id, "fill_empty_slots")}
                              disabled={actionLoading === campaign.id}
                              className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors border border-blue-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Emergency Push: Fill Empty Slots"
                            >
                              {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16} />}
                            </button>
                            <button
                              onClick={() => handleEmergencyPush(campaign.id, "replace_everything")}
                              disabled={actionLoading === campaign.id}
                              className="px-2 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed text-[10px] font-bold"
                              title="Emergency Push: Replace Everything"
                            >
                              Replace
                            </button>
                            <button
                              onClick={() => handleManagementAction(campaign.id, "pause")}
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
                            onClick={() => handleManagementAction(campaign.id, "resume")}
                            disabled={actionLoading === campaign.id}
                            className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
                            title="Resume"
                          >
                            {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Play size={16} />}
                          </button>
                        )}
                        {campaign.status !== "deleted" && (
                          <button
                            onClick={() => handleManagementAction(campaign.id, "delete")}
                            disabled={actionLoading === campaign.id}
                            className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
                            title="Delete"
                          >
                            {actionLoading === campaign.id ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16} />}
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
