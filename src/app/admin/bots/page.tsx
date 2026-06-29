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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load bots");
      setBots(Array.isArray(data.bots) ? data.bots : []);
      setTotalPages(data.totalPages || 1);
      setSummary(data.summary || null);
    } catch (err: any) {
      setError(err.message || "Failed to load bots");
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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${
      status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "pending" ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "rejected" || status === "token_invalid" || status === "bot_deleted" || status === "unreachable" ? "border-red-200 bg-red-50 text-red-700"
      : "border-slate-200 bg-slate-100 text-slate-700"
    }`}>
      {String(status || "unknown").replace(/_/g, " ")}
    </span>
  );

  const ActionButtons = ({ bot }: { bot: any }) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button
        onClick={() => openViewModal(bot)}
        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
        title="View Details"
      >
        <Eye size={15} />
      </button>
      {bot.status === "pending" && (
        <>
          <button
            onClick={() => openActionConfirm(bot, "activate", "Activate Bot", "Activate this bot?")}
            disabled={actionLoading === bot.id}
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            title="Approve"
          >
            {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          </button>
          <button
            onClick={() => openActionConfirm(bot, "reject", "Reject Bot", "Reject this bot?", true)}
            disabled={actionLoading === bot.id}
            className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
            title="Reject"
          >
            {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
          </button>
        </>
      )}
      {bot.status === "active" && (
        <button
          onClick={() => openActionConfirm(bot, "pause", "Pause Bot", "Pause this bot?")}
          disabled={actionLoading === bot.id}
          className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-amber-600 transition-colors hover:bg-amber-100 disabled:opacity-50"
          title="Pause"
        >
          {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <Pause size={15} />}
        </button>
      )}
      {["paused", "token_invalid", "bot_deleted", "unreachable"].includes(bot.status) && (
        <button
          onClick={() => openActionConfirm(bot, "activate", "Resume Bot", "Resume this bot?")}
          disabled={actionLoading === bot.id}
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          title="Resume"
        >
          {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        </button>
      )}
      {bot.status === "rejected" && (
        <button
          onClick={() => openActionConfirm(bot, "activate", "Activate Bot", "Activate this rejected bot?")}
          disabled={actionLoading === bot.id}
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          title="Activate"
        >
          {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        </button>
      )}
      {bot.status !== "rejected" && bot.status !== "pending" && (
        <button
          onClick={() => openActionConfirm(bot, "reject", "Reject Bot", "Reject this bot?", true)}
          disabled={actionLoading === bot.id}
          className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
          title="Reject"
        >
          {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
        </button>
      )}
      <button
        onClick={() => openActionConfirm(bot, "delete", "Delete Bot", "Delete this bot from monetization?", true)}
        disabled={actionLoading === bot.id}
        className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
        title="Delete"
      >
        {actionLoading === bot.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      </button>
    </div>
  );

  const renderContinents = (continentsStr: string) => {
    if (!continentsStr) return <span className="font-medium text-slate-900">All</span>;
    try {
      const parsed = JSON.parse(continentsStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {parsed.map((continent: string) => (
              <span key={continent} className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600">
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
    if (!categoriesStr) return <span className="italic text-slate-400">None selected</span>;
    try {
      const parsed = JSON.parse(categoriesStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {parsed.map((cat: string) => (
              <span key={cat} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
                {cat}
              </span>
            ))}
          </div>
        );
      }
    } catch (e) {}
    return <span className="italic text-slate-400">None selected</span>;
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

      {/* Bot Details Modal */}
      {viewModalOpen && selectedBot && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Bot Details</h3>
                <p className="mt-0.5 text-sm text-slate-500">#{selectedBot.id}</p>
              </div>
              <button onClick={() => setViewModalOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-5">
              {/* Publisher Info */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Publisher Profile</h4>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Name</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.first_name} {selectedBot.last_name}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Username</div>
                      <div className="mt-0.5 font-semibold text-slate-900">@{selectedBot.owner_username || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">User ID</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.user_id}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Telegram ID</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.telegram_id}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bot Info */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Bot Information</h4>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Bot Name</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.bot_name || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Username</div>
                      <div className="mt-0.5 font-semibold text-blue-600">@{selectedBot.bot_username || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Status</div>
                      <div className="mt-0.5"><StatusBadge status={selectedBot.status} /></div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Posts / Day</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.posts_per_day}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Traffic Quality</div>
                      <div className="mt-0.5 font-semibold capitalize text-slate-900">{selectedBot.traffic_quality_score || 60} / {qualityLabel(selectedBot.traffic_quality_tier)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Risk Level</div>
                      <div className="mt-0.5 font-semibold capitalize text-slate-900">{qualityLabel(selectedBot.traffic_risk_level)} risk</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Last Successful Post</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.last_successful_broadcast_at ? new Date(selectedBot.last_successful_broadcast_at).toLocaleString() : "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Last Failure</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.last_failure_at ? new Date(selectedBot.last_failure_at).toLocaleString() : "N/A"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs font-medium text-slate-500">Failure Reason</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.paused_reason || selectedBot.failure_reason || "N/A"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs font-medium text-slate-500">Suggested Fix</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedBot.suggested_fix || "N/A"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs font-medium text-slate-500">API Token</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-400">Hidden</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Categories</div>
                      {renderCategories(selectedBot.categories)}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Audience Continents</div>
                      {renderContinents(selectedBot.continents)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bot User Stats */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Bot Users</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                      <Users size={16} />
                      Active Users
                    </div>
                    <span className="text-lg font-black text-emerald-700">{selectedBot.active_count?.toLocaleString() || 0}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                      <ShieldOff size={16} />
                      Blocked
                    </div>
                    <span className="text-lg font-black text-red-700">{selectedBot.blocked_count?.toLocaleString() || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Monetized Bots</h1>
        <p className="mt-0.5 text-sm text-slate-500">Review and manage publisher bot monetization</p>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Monetized Bots", summary?.monetized_bots || 0, "text-slate-900"],
          ["Active Bot Users", summary?.active_bot_users || 0, "text-emerald-700"],
          ["Paused Bots", summary?.paused_bots || 0, "text-amber-700"],
          ["Inactive Bot Users", summary?.inactive_bot_users || 0, "text-red-700"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
            <div className={`mt-2 text-xl font-black ${color}`}>{Number(value).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Main Table Card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">All Bots</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                placeholder="Search bots, owners..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-xs outline-none focus:ring-2 focus:ring-blue-500 sm:w-64"
              />
            </div>
            <div className="overflow-x-auto">
              <div className="flex w-max rounded-lg border border-slate-200/50 bg-slate-100 p-0.5">
                {["all", "pending", "active", "rejected", "paused", "token_invalid", "bot_deleted", "unreachable"].map((f) => (
                  <button
                    key={f}
                    onClick={() => { setPage(1); setStatusFilter(f); }}
                    className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium capitalize transition-all ${statusFilter === f ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}
                  >
                    {f.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">ID & Username</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Bot Name</th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500">Active</th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500">Blocked</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Quality</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Posts/Day</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></td></tr>
              ) : bots.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-slate-500">No bots found.</td></tr>
              ) : (
                bots.map((bot: any) => (
                  <tr key={bot.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                        <Bot size={14} className="flex-shrink-0 text-indigo-500" />
                        @{bot.bot_username || "N/A"}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">#{bot.id} · User {bot.user_id}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="max-w-[150px] truncate font-medium text-slate-900" title={bot.bot_name}>{bot.bot_name || "N/A"}</div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="font-bold text-emerald-600">{(bot.active_count || 0).toLocaleString()}</div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="font-bold text-red-600">{(bot.blocked_count || 0).toLocaleString()}</div>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/admin/traffic-quality/bot/${bot.id}`} className="text-base font-black text-blue-700 hover:text-blue-900">{bot.traffic_quality_score || 60}</Link>
                      <div className="mt-0.5 text-xs capitalize text-slate-500">{qualityLabel(bot.traffic_quality_tier)}</div>
                      <div className="text-xs capitalize text-slate-500">{qualityLabel(bot.traffic_risk_level)} risk</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{bot.posts_per_day}</div>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={bot.status} />
                      {(bot.paused_reason || bot.failure_reason) && (
                        <div className="mt-1.5 max-w-[180px] truncate text-[11px] font-medium text-slate-500" title={bot.paused_reason || bot.failure_reason}>
                          {bot.paused_reason || bot.failure_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <ActionButtons bot={bot} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="space-y-3 p-4 md:hidden">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
          ) : bots.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No bots found.</div>
          ) : (
            bots.map((bot: any) => (
              <div key={bot.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Bot size={14} className="flex-shrink-0 text-indigo-500" />
                      <span className="truncate">{bot.bot_name || "N/A"}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">@{bot.bot_username || "N/A"} · User #{bot.user_id}</div>
                  </div>
                  <StatusBadge status={bot.status} />
                </div>
                {(bot.paused_reason || bot.failure_reason) && (
                  <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs font-medium text-amber-800">
                    {bot.paused_reason || bot.failure_reason}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Active Users</div>
                    <div className="mt-1 font-semibold text-emerald-700">{(bot.active_count || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Blocked</div>
                    <div className="mt-1 font-semibold text-red-700">{(bot.blocked_count || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Posts/Day</div>
                    <div className="mt-1 font-semibold text-slate-900">{bot.posts_per_day || 0}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Updated</div>
                    <div className="mt-1 font-semibold text-slate-900">{bot.updated_at ? new Date(bot.updated_at).toLocaleDateString() : bot.created_at ? new Date(bot.created_at).toLocaleDateString() : "N/A"}</div>
                  </div>
                  <div className="col-span-2 rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Traffic Quality</div>
                    <Link href={`/admin/traffic-quality/bot/${bot.id}`} className="mt-1 block font-semibold text-blue-700 hover:text-blue-900">{bot.traffic_quality_score || 60} · {qualityLabel(bot.traffic_risk_level)} risk</Link>
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <ActionButtons bot={bot} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><ChevronLeft size={15} /></button>
            <button disabled={page === totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
