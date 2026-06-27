"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Check, X, Eye, Search, Pause, Play, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

type ChannelAction = "activate" | "reject" | "pause" | "delete";
type PendingAction = {
  channel: any;
  action: ChannelAction;
  title: string;
  message: string;
  danger?: boolean;
} | null;

export default function AdminChannelsPage() {
  const [channels, setChannels] = useState([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<any>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const fetchChannels = async (p: number, s: string, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/channels?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setChannels(data.channels);
      setSummary(data.summary || null);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchChannels(page, statusFilter, search);
    }, 500);
    return () => clearTimeout(timer);
  }, [page, statusFilter, search]);

  const handleAction = async (id: number, action: string) => {
    setActionLoading(id);
    try {
      const normalizedAction = action === "approve" ? "activate" : action;
      const res = await fetch(`/api/admin/channels/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: normalizedAction })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      await fetchChannels(page, statusFilter, search);
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

  const openActionConfirm = (channel: any, action: ChannelAction, title: string, message: string, danger = false) => {
    setPendingAction({ channel, action, title, message, danger });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const { channel, action } = pendingAction;
    setPendingAction(null);
    await handleAction(channel.id, action);
  };

  const failedStatuses = ["bot_removed", "channel_not_found", "permission_missing"];
  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : status === 'rejected' || failedStatuses.includes(status) ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
      {status.replace(/_/g, " ")}
    </span>
  );

  const ActionButtons = ({ channel }: { channel: any }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
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
            onClick={() => openActionConfirm(channel, "activate", "Activate Channel", "Activate this channel?")}
            disabled={actionLoading === channel.id}
            className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
            title="Approve"
          >
            {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
          </button>
          <button
            onClick={() => openActionConfirm(channel, "reject", "Reject Channel", "Reject this channel?", true)}
            disabled={actionLoading === channel.id}
            className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
            title="Reject"
          >
            {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <X size={16} />}
          </button>
        </>
      )}
      {channel.status === "active" && (
        <button
          onClick={() => openActionConfirm(channel, "pause", "Pause Channel", "Pause this channel?")}
          disabled={actionLoading === channel.id}
          className="p-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-md transition-colors border border-amber-100 cursor-pointer disabled:cursor-not-allowed"
          title="Pause"
        >
          {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <Pause size={16} />}
        </button>
      )}
      {(channel.status === "paused" || failedStatuses.includes(channel.status)) && (
        <button
          onClick={() => openActionConfirm(channel, "activate", "Reactivate Channel", "Reactivate this channel?")}
          disabled={actionLoading === channel.id}
          className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
          title="Reactivate"
        >
          {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <Play size={16} />}
        </button>
      )}
      {channel.status === "rejected" && (
        <button
          onClick={() => openActionConfirm(channel, "activate", "Activate Channel", "Activate this rejected channel?")}
          disabled={actionLoading === channel.id}
          className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
          title="Activate"
        >
          {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
        </button>
      )}
      {channel.status !== "rejected" && channel.status !== "pending" && channel.status !== "deleted" && (
        <button
          onClick={() => openActionConfirm(channel, "reject", "Reject Channel", "Reject this channel?", true)}
          disabled={actionLoading === channel.id}
          className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
          title="Reject"
        >
          {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <X size={16} />}
        </button>
      )}
      <button
        onClick={() => openActionConfirm(channel, "delete", "Delete Channel", "Delete this channel from monetization?", true)}
        disabled={actionLoading === channel.id}
        className="p-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
        title="Delete"
      >
        {actionLoading === channel.id ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16} />}
      </button>
    </div>
  );

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
    } catch (e) {}
    return <span className="font-medium text-slate-900">{continentsStr}</span>;
  };
  
  const renderCategories = (categoriesStr: string) => {
    if (!categoriesStr) return <span className="text-slate-400 italic">None selected</span>;
    try {
      const parsed = JSON.parse(categoriesStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (
          <div className="flex flex-wrap gap-1 mt-1">
            {parsed.map((cat: string) => (
              <span key={cat} className="px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded text-[10px] font-semibold uppercase tracking-wider">
                {cat}
              </span>
            ))}
          </div>
        );
      }
    } catch (e) {}
    return <span className="text-slate-400 italic">None selected</span>;
  };

  const qualityLabel = (value?: string) => String(value || "good").replace(/_/g, " ");

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>
      <ConfirmationModal
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
        title={pendingAction?.title || ""}
        message={pendingAction?.message || ""}
        confirmBtnText="Confirm"
        confirmBtnVariant={pendingAction?.danger ? "danger" : "primary"}
        isLoading={actionLoading !== null}
      />

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
                    <div><span className="text-slate-500">Subscribers:</span> <span className="font-medium text-slate-900">{selectedChannel.subscriber_count?.toLocaleString() || "0"}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className="font-medium text-slate-900 capitalize">{selectedChannel.status}</span></div>
                    <div><span className="text-slate-500">Traffic Quality:</span> <span className="font-medium text-slate-900 capitalize">{selectedChannel.traffic_quality_score || 60} / {qualityLabel(selectedChannel.traffic_quality_tier)}</span></div>
                    <div><span className="text-slate-500">Risk:</span> <span className="font-medium text-slate-900 capitalize">{qualityLabel(selectedChannel.traffic_risk_level)} risk</span></div>
                    <div><span className="text-slate-500">Posts / Day:</span> <span className="font-medium text-slate-900">{selectedChannel.posts_per_day}</span></div>
                    <div className="col-span-1">
                      <span className="text-slate-500 block">Categories:</span> 
                      {renderCategories(selectedChannel.categories)}
                    </div>
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
        {summary && (
          <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-3 lg:grid-cols-4">
            {[
              ["Active Channels", summary.active_channels],
              ["Paused Channels", summary.paused_channels],
              ["Failed Channels", summary.failed_channels],
              ["Deleted Channels", summary.deleted_channels],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                <div className="mt-1 text-lg font-black text-slate-900">{Number(value || 0).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Channels</h2>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder="Search channels, owners..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200/50 w-full sm:w-auto">
              {["all", "pending", "active", "paused", "bot_removed", "channel_not_found", "permission_missing", "rejected"].map(f => (
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
        
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">ID & Username</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Members</th>
                <th className="px-4 py-3 font-medium">Posts/Day</th>
                <th className="px-4 py-3 font-medium">Lifecycle</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : channels.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">No channels found.</td></tr>
              ) : (
                channels.map((channel: any) => (
                  <tr key={channel.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">@{channel.username || "Private"}</div>
                      <div className="text-xs text-slate-500">ID: #{channel.id} - User: {channel.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 truncate max-w-[200px]" title={channel.title}>{channel.title || "N/A"}</div>
                      <div className="text-xs text-slate-500">Chat ID: {channel.chat_id || "N/A"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{channel.subscriber_count?.toLocaleString() || "0"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{channel.posts_per_day}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/traffic-quality/channel/${channel.id}`} className="font-black text-blue-700 hover:text-blue-900">{channel.traffic_quality_score || 60}</Link>
                      <div className="text-xs capitalize text-slate-500">{qualityLabel(channel.traffic_quality_tier)} / {qualityLabel(channel.traffic_risk_level)} risk</div>
                      <div className="mt-1 text-[10px] text-slate-500">Last success: {channel.last_successful_post_at ? new Date(channel.last_successful_post_at).toLocaleString() : "Never"}</div>
                      <div className="text-[10px] text-slate-500">Last failure: {channel.last_failure_at ? new Date(channel.last_failure_at).toLocaleString() : "Never"}</div>
                      {(channel.failure_reason || channel.paused_reason) && (
                        <div className="mt-1 max-w-[220px] truncate text-[10px] font-semibold text-amber-600" title={channel.failure_reason || channel.paused_reason}>
                          {channel.failure_reason || channel.paused_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={channel.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionButtons channel={channel} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></div>
          ) : channels.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No channels found.</div>
          ) : (
            channels.map((channel: any) => (
              <div key={channel.id} className="rounded-lg border border-slate-200 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{channel.title || "N/A"}</div>
                    <div className="text-xs text-slate-500">@{channel.username || "Private"}</div>
                    <div className="text-xs text-slate-400">User #{channel.user_id}</div>
                  </div>
                  <StatusBadge status={channel.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Audience</div><div className="font-semibold text-slate-900">{channel.subscriber_count?.toLocaleString() || "0"}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Posts/Day</div><div className="font-semibold text-slate-900">{channel.posts_per_day || 0}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Quality</div><Link href={`/admin/traffic-quality/channel/${channel.id}`} className="font-semibold text-blue-700 hover:text-blue-900">{channel.traffic_quality_score || 60} / {qualityLabel(channel.traffic_risk_level)}</Link></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Last Success</div><div className="font-semibold text-slate-900">{channel.last_successful_post_at ? new Date(channel.last_successful_post_at).toLocaleDateString() : "Never"}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Last Failure</div><div className="font-semibold text-slate-900">{channel.last_failure_at ? new Date(channel.last_failure_at).toLocaleDateString() : "Never"}</div></div>
                </div>
                {(channel.failure_reason || channel.paused_reason) && (
                  <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
                    {channel.failure_reason || channel.paused_reason}
                    {channel.suggested_fix && <div className="mt-1">{channel.suggested_fix}</div>}
                  </div>
                )}
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Categories</div>
                  {renderCategories(channel.categories)}
                </div>
                <div className="mt-3"><ActionButtons channel={channel} /></div>
              </div>
            ))
          )}
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
