"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Check, X, Eye } from "lucide-react";
import Modal from "@/components/ui/Modal";

export default function AdminChannelsPage() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<any>(null);

  const fetchChannels = async (p: number, s: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/channels?page=${p}&limit=10&status=${s}`);
      const data = await res.json();
      setChannels(data.channels);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels(page, statusFilter);
  }, [page, statusFilter]);

  const handleAction = async (id: number, action: string) => {
    setActionLoading(id);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      if (!res.ok) throw new Error("Action failed");
      await fetchChannels(page, statusFilter);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const openViewModal = (channel: any) => {
    setSelectedChannel(channel);
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
      // Fallback
    }
    return <span className="font-medium text-slate-900">{continentsStr}</span>;
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>

      {/* View Channel Modal */}
      {viewModalOpen && selectedChannel && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Channel Details (#{selectedChannel.id})</h3>
              <button onClick={() => setViewModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Publisher Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Publisher Profile</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{selectedChannel.first_name} {selectedChannel.last_name}</span></div>
                    <div><span className="text-slate-500">Username:</span> <span className="font-medium text-slate-900">@{selectedChannel.owner_username || "N/A"}</span></div>
                    <div><span className="text-slate-500">User ID:</span> <span className="font-medium text-slate-900">{selectedChannel.user_id}</span></div>
                    <div><span className="text-slate-500">Telegram ID:</span> <span className="font-medium text-slate-900">{selectedChannel.telegram_id}</span></div>
                  </div>
                </div>
              </div>

              {/* Channel Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Channel Information</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div><span className="text-slate-500">Title:</span> <span className="font-medium text-slate-900">{selectedChannel.title || "N/A"}</span></div>
                    <div><span className="text-slate-500">Username/Link:</span> <span className="font-medium text-blue-600">@{selectedChannel.username || "N/A"}</span></div>
                    <div><span className="text-slate-500">Chat ID:</span> <span className="font-medium text-slate-900">{selectedChannel.chat_id || "N/A"}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className="font-medium text-slate-900 capitalize">{selectedChannel.status}</span></div>
                    <div><span className="text-slate-500">Posts / Day:</span> <span className="font-medium text-slate-900">{selectedChannel.posts_per_day}</span></div>
                    <div className="col-span-2">
                      <span className="text-slate-500 block">Audience Continents:</span> 
                      {renderContinents(selectedChannel.audience_continents)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Channels</h2>
          <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200/50">
            {["all", "pending", "active", "rejected", "paused"].map(f => (
              <button
                key={f}
                onClick={() => { setPage(1); setStatusFilter(f); }}
                className={`px-3 py-1.5 text-xs font-medium capitalize rounded transition-all cursor-pointer ${statusFilter === f ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">ID & Username</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Posts/Day</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : channels.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No channels found.</td></tr>
              ) : (
                channels.map((channel: any) => (
                  <tr key={channel.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">@{channel.username || "Private"}</div>
                      <div className="text-xs text-slate-500">ID: #{channel.id} • User: {channel.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 truncate max-w-[200px]" title={channel.title}>{channel.title || "N/A"}</div>
                      <div className="text-xs text-slate-500">Chat ID: {channel.chat_id || "N/A"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{channel.posts_per_day}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${channel.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : channel.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : channel.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                        {channel.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => openViewModal(channel)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          title="View Details"
                        >
                          <Eye size={16} />
                        </button>
                        {channel.status === "pending" && (
                          <>
                            <button 
                              onClick={() => handleAction(channel.id, "approve")}
                              disabled={actionLoading === channel.id}
                              className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Approve"
                            >
                              {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
                            </button>
                            <button 
                              onClick={() => handleAction(channel.id, "reject")}
                              disabled={actionLoading === channel.id}
                              className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Reject"
                            >
                              {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <X size={16} />}
                            </button>
                          </>
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
