"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Check, X, Eye, Bot, Search, Users, ShieldOff, Pause, Play, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

type BotAction = "activate" | "reject" | "pause" | "delete";
type PendingAction = {
  bot: any;
  action: BotAction;
  title: string;
  message: string;
  danger?: boolean;
} | null;

export default function AdminBotsPage() {
  const [bots, setBots] = useState([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState<any>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const fetchBots = async (p: number, s: string, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bots?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setBots(data.bots);
      setTotalPages(data.totalPages);
      setSummary(data.summary || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBots(page, statusFilter, search);
    }, 500);
    return () => clearTimeout(timer);
  }, [page, statusFilter, search]);

  const handleAction = async (id: number, action: string) => {
    setActionLoading(id);
    try {
      const normalizedAction = action === "approve" ? "activate" : action;
      const res = await fetch(`/api/admin/bots/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: normalizedAction })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      await fetchBots(page, statusFilter, search);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const openViewModal = (bot: any) => {
    setSelectedBot(bot);
    setViewModalOpen(true);
  };

  const openActionConfirm = (bot: any, action: BotAction, title: string, message: string, danger = false) => {
    setPendingAction({ bot, action, title, message, danger });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const { bot, action } = pendingAction;
    setPendingAction(null);
    await handleAction(bot.id, action);
  };

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : status === 'rejected' || status === 'token_invalid' || status === 'bot_deleted' || status === 'unreachable' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
      {String(status || "unknown").replace(/_/g, " ")}
    </span>
  );

  const ActionButtons = ({ bot }: { bot: any }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        onClick={() => openViewModal(bot)}
        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
        title="View Details"
      >
        <Eye size={16} />
      </button>
      {bot.status === "pending" && (
        <>
          <button
            onClick={() => openActionConfirm(bot, "activate", "Activate Bot", "Activate this bot?")}
            disabled={actionLoading === bot.id}
            className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
            title="Approve"
          >
            {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
          </button>
          <button
            onClick={() => openActionConfirm(bot, "reject", "Reject Bot", "Reject this bot?", true)}
            disabled={actionLoading === bot.id}
            className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
            title="Reject"
          >
            {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <X size={16} />}
          </button>
        </>
      )}
      {bot.status === "active" && (
        <button
          onClick={() => openActionConfirm(bot, "pause", "Pause Bot", "Pause this bot?")}
          disabled={actionLoading === bot.id}
          className="p-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-md transition-colors border border-amber-100 cursor-pointer disabled:cursor-not-allowed"
          title="Pause"
        >
          {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <Pause size={16} />}
        </button>
      )}
      {["paused", "token_invalid", "bot_deleted", "unreachable"].includes(bot.status) && (
        <button
          onClick={() => openActionConfirm(bot, "activate", "Resume Bot", "Resume this bot?")}
          disabled={actionLoading === bot.id}
          className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
          title="Resume"
        >
          {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <Play size={16} />}
        </button>
      )}
      {bot.status === "rejected" && (
        <button
          onClick={() => openActionConfirm(bot, "activate", "Activate Bot", "Activate this rejected bot?")}
          disabled={actionLoading === bot.id}
          className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
          title="Activate"
        >
          {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
        </button>
      )}
      {bot.status !== "rejected" && bot.status !== "pending" && (
        <button
          onClick={() => openActionConfirm(bot, "reject", "Reject Bot", "Reject this bot?", true)}
          disabled={actionLoading === bot.id}
          className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
          title="Reject"
        >
          {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <X size={16} />}
        </button>
      )}
      <button
        onClick={() => openActionConfirm(bot, "delete", "Delete Bot", "Delete this bot from monetization?", true)}
        disabled={actionLoading === bot.id}
        className="p-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
        title="Delete"
      >
        {actionLoading === bot.id ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16} />}
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
              <span key={cat} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded text-[10px] font-semibold uppercase tracking-wider">
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

      {/* View Bot Modal */}
      {viewModalOpen && selectedBot && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Bot Details (#{selectedBot.id})</h3>
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
                    <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{selectedBot.first_name} {selectedBot.last_name}</span></div>
                    <div><span className="text-slate-500">Username:</span> <span className="font-medium text-slate-900">@{selectedBot.owner_username || "N/A"}</span></div>
                    <div><span className="text-slate-500">User ID:</span> <span className="font-medium text-slate-900">{selectedBot.user_id}</span></div>
                    <div><span className="text-slate-500">Telegram ID:</span> <span className="font-medium text-slate-900">{selectedBot.telegram_id}</span></div>
                  </div>
                </div>
              </div>

              {/* Bot Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Bot Information</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div><span className="text-slate-500">Bot Name:</span> <span className="font-medium text-slate-900">{selectedBot.bot_name || "N/A"}</span></div>
                    <div><span className="text-slate-500">Username:</span> <span className="font-medium text-blue-600">@{selectedBot.bot_username || "N/A"}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">API Token:</span> <span className="font-mono text-[10px] break-all">Hidden</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className="font-medium text-slate-900 capitalize">{selectedBot.status}</span></div>
                    <div><span className="text-slate-500">Last Successful Post:</span> <span className="font-medium text-slate-900">{selectedBot.last_successful_broadcast_at ? new Date(selectedBot.last_successful_broadcast_at).toLocaleString() : "N/A"}</span></div>
                    <div><span className="text-slate-500">Last Failure:</span> <span className="font-medium text-slate-900">{selectedBot.last_failure_at ? new Date(selectedBot.last_failure_at).toLocaleString() : "N/A"}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Failure Reason:</span> <span className="font-medium text-slate-900">{selectedBot.paused_reason || selectedBot.failure_reason || "N/A"}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Suggested Fix:</span> <span className="font-medium text-slate-900">{selectedBot.suggested_fix || "N/A"}</span></div>
                    <div><span className="text-slate-500">Traffic Quality:</span> <span className="font-medium text-slate-900 capitalize">{selectedBot.traffic_quality_score || 60} / {qualityLabel(selectedBot.traffic_quality_tier)}</span></div>
                    <div><span className="text-slate-500">Risk:</span> <span className="font-medium text-slate-900 capitalize">{qualityLabel(selectedBot.traffic_risk_level)} risk</span></div>
                    <div><span className="text-slate-500">Posts / Day:</span> <span className="font-medium text-slate-900">{selectedBot.posts_per_day}</span></div>
                    <div className="col-span-1">
                      <span className="text-slate-500 block">Categories:</span> 
                      {renderCategories(selectedBot.categories)}
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-500 block">Audience Continents:</span> 
                      {renderContinents(selectedBot.continents)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bot Users Stats */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Bot Users Stats</h4>
                <div className="grid grid-cols-2 gap-4 text-sm font-medium">
                  <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-600">
                      <Users size={16} />
                      <span>Active</span>
                    </div>
                    <span className="text-emerald-700">{selectedBot.active_count?.toLocaleString() || 0}</span>
                  </div>
                  <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-red-600">
                      <ShieldOff size={16} />
                      <span>Blocked</span>
                    </div>
                    <span className="text-red-700">{selectedBot.blocked_count?.toLocaleString() || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
        {[
          ["Monetized Bots", summary?.monetized_bots || 0],
          ["Active Bot Users", summary?.active_bot_users || 0],
          ["Paused Bots", summary?.paused_bots || 0],
          ["Inactive Bot Users", summary?.inactive_bot_users || 0],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
            <div className="mt-1 text-xl font-black text-slate-900">{Number(value).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Monetized Bots</h2>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder="Search bots, owners..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200/50 w-full sm:w-auto">
              {["all", "pending", "active", "rejected", "paused", "token_invalid", "bot_deleted", "unreachable"].map(f => (
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
                <th className="px-4 py-3 font-medium">Bot Name</th>
                <th className="px-4 py-3 font-medium text-center">Active</th>
                <th className="px-4 py-3 font-medium text-center">Blocked</th>
                <th className="px-4 py-3 font-medium">Quality</th>
                <th className="px-4 py-3 font-medium">Posts/Day</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : bots.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">No bots found.</td></tr>
              ) : (
                bots.map((bot: any) => (
                  <tr key={bot.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 flex items-center gap-2">
                        <Bot size={14} className="text-indigo-500" />
                        @{bot.bot_username || "N/A"}
                      </div>
                      <div className="text-xs text-slate-500">ID: #{bot.id} - User: {bot.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 truncate max-w-[150px]" title={bot.bot_name}>{bot.bot_name || "N/A"}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="font-bold text-emerald-600">{(bot.active_count || 0).toLocaleString()}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="font-bold text-red-600">{(bot.blocked_count || 0).toLocaleString()}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/traffic-quality/bot/${bot.id}`} className="font-black text-blue-700 hover:text-blue-900">{bot.traffic_quality_score || 60}</Link>
                      <div className="text-xs capitalize text-slate-500">{qualityLabel(bot.traffic_quality_tier)} / {qualityLabel(bot.traffic_risk_level)} risk</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{bot.posts_per_day}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={bot.status} />
                      {(bot.paused_reason || bot.failure_reason) && (
                        <div className="mt-1 max-w-[180px] truncate text-[11px] font-medium text-slate-500" title={bot.paused_reason || bot.failure_reason}>
                          {bot.paused_reason || bot.failure_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionButtons bot={bot} />
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
          ) : bots.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No bots found.</div>
          ) : (
            bots.map((bot: any) => (
              <div key={bot.id} className="rounded-lg border border-slate-200 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Bot size={14} className="text-indigo-500" />
                      <span className="truncate">{bot.bot_name || "N/A"}</span>
                    </div>
                    <div className="text-xs text-slate-500">@{bot.bot_username || "N/A"}</div>
                    <div className="text-xs text-slate-400">User #{bot.user_id}</div>
                  </div>
                  <StatusBadge status={bot.status} />
                </div>
                {(bot.paused_reason || bot.failure_reason) && (
                  <div className="mt-2 text-xs font-medium text-slate-500">
                    {bot.paused_reason || bot.failure_reason}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Active</div><div className="font-semibold text-emerald-700">{(bot.active_count || 0).toLocaleString()}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Blocked</div><div className="font-semibold text-red-700">{(bot.blocked_count || 0).toLocaleString()}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Posts/Day</div><div className="font-semibold text-slate-900">{bot.posts_per_day || 0}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Updated</div><div className="font-semibold text-slate-900">{bot.updated_at ? new Date(bot.updated_at).toLocaleDateString() : bot.created_at ? new Date(bot.created_at).toLocaleDateString() : "N/A"}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Quality</div><Link href={`/admin/traffic-quality/bot/${bot.id}`} className="font-semibold text-blue-700 hover:text-blue-900">{bot.traffic_quality_score || 60} / {qualityLabel(bot.traffic_risk_level)}</Link></div>
                </div>
                <div className="mt-3"><ActionButtons bot={bot} /></div>
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
