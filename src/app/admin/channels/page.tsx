"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy channel list payload is not yet schema-generated */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { ChevronLeft, ChevronRight, Check, X, Eye, Search, Pause, Play, Trash2, ExternalLink, BadgeCheck, Tv, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonCard, SkeletonTableRows } from "@/components/ui/Skeleton";
import ChannelControlCenter from "@/components/admin/ChannelControlCenter";
import { publicChannelUrl } from "@/lib/telegramChannelInput";

type ChannelAction = "activate" | "reject" | "pause" | "delete";
type PendingAction = {
  channel: any;
  action: ChannelAction;
  title: string;
  message: string;
  danger?: boolean;
} | null;

const AVATAR_TONES = [
  "bg-blue-50 text-blue-600",
  "bg-indigo-50 text-indigo-600",
  "bg-emerald-50 text-emerald-600",
  "bg-amber-50 text-amber-600",
  "bg-rose-50 text-rose-600",
  "bg-cyan-50 text-cyan-600",
];

function avatarTone(seed: number) {
  return AVATAR_TONES[Math.abs(seed) % AVATAR_TONES.length];
}

function formatMetric(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function formatMoneyMetric(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : String(value);
}

function ChannelAvatar({ channel }: { channel: any }) {
  const initial = String(channel.title || channel.username || "?").trim().charAt(0).toUpperCase() || "#";
  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${avatarTone(Number(channel.id) || 0)}`}>
      {initial || <Tv size={18} />}
    </div>
  );
}

function VerifiedBadge({ channel }: { channel: any }) {
  if (!channel.is_verified) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700" title="Verified channel">
      <BadgeCheck size={11} />
      Verified
    </span>
  );
}

const FAILED_STATUSES = ["bot_removed", "channel_not_found", "permission_missing"];

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${
      status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "pending" ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "rejected" || FAILED_STATUSES.includes(status) ? "border-red-200 bg-red-50 text-red-700"
      : "border-slate-200 bg-slate-100 text-slate-700"
    }`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ChannelIdentifier({ channel, mobile = false }: { channel: any; mobile?: boolean }) {
  if (channel.channel_type === "private") {
    return channel.private_invite_link_url ? (
      <a
        href={channel.private_invite_link_url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${mobile ? "text-xs" : "max-w-[220px] text-sm"} inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:text-blue-900 hover:underline`}
        title={channel.private_invite_link_url}
      >
        <span className="truncate">{channel.private_invite_link_url}</span>
        <ExternalLink size={13} className="shrink-0" />
      </a>
    ) : (
      <span className={`${mobile ? "text-xs" : "text-sm"} font-semibold text-slate-500`}>Private link unavailable</span>
    );
  }

  const href = publicChannelUrl(channel.username);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${mobile ? "text-xs" : "text-sm"} inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-900 hover:underline`}>
      @{channel.username}<ExternalLink size={12} />
    </a>
  ) : <span className={`${mobile ? "text-xs" : "text-sm"} font-semibold text-slate-500`}>N/A</span>;
}

interface ActionButtonsProps {
  channel: any;
  actionLoading: number | null;
  onView: (channel: any) => void;
  onAction: (channel: any, action: ChannelAction, title: string, message: string, danger?: boolean) => void;
}

function ActionButtons({ channel, actionLoading, onView, onAction }: ActionButtonsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button
        onClick={() => onView(channel)}
        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
        title="View Details"
      >
        <Eye size={15} />
      </button>
      {channel.status === "pending" && (
        <>
          <button
            onClick={() => onAction(channel, "activate", "Activate Channel", "Activate this channel?")}
            disabled={actionLoading === channel.id}
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            title="Approve"
          >
            {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          </button>
          <button
            onClick={() => onAction(channel, "reject", "Reject Channel", "Reject this channel?", true)}
            disabled={actionLoading === channel.id}
            className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
            title="Reject"
          >
            {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
          </button>
        </>
      )}
      {channel.status === "active" && (
        <button
          onClick={() => onAction(channel, "pause", "Pause Channel", "Pause this channel?")}
          disabled={actionLoading === channel.id}
          className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-amber-600 transition-colors hover:bg-amber-100 disabled:opacity-50"
          title="Pause"
        >
          {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <Pause size={15} />}
        </button>
      )}
      {(channel.status === "paused" || FAILED_STATUSES.includes(channel.status)) && (
        <button
          onClick={() => onAction(channel, "activate", "Reactivate Channel", "Reactivate this channel?")}
          disabled={actionLoading === channel.id}
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          title="Reactivate"
        >
          {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        </button>
      )}
      {channel.status === "rejected" && (
        <button
          onClick={() => onAction(channel, "activate", "Activate Channel", "Activate this rejected channel?")}
          disabled={actionLoading === channel.id}
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          title="Activate"
        >
          {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        </button>
      )}
      {channel.status !== "rejected" && channel.status !== "pending" && channel.status !== "deleted" && (
        <button
          onClick={() => onAction(channel, "reject", "Reject Channel", "Reject this channel?", true)}
          disabled={actionLoading === channel.id}
          className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
          title="Reject"
        >
          {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
        </button>
      )}
      <button
        onClick={() => onAction(channel, "delete", "Delete Channel", "Delete this channel from monetization?", true)}
        disabled={actionLoading === channel.id}
        className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
        title="Delete"
      >
        {actionLoading === channel.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      </button>
    </div>
  );
}

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
      if (selectedChannel?.id === id) setViewModalOpen(false);
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

  const renderContinents = (continentsStr: string) => {
    if (!continentsStr) return <span className="font-semibold text-slate-900">All</span>;
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
    } catch {}
    return <span className="font-semibold text-slate-900">{continentsStr}</span>;
  };

  const renderCategories = (categoriesStr: string) => {
    if (!categoriesStr) return <span className="italic text-slate-400">None selected</span>;
    try {
      const parsed = JSON.parse(categoriesStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {parsed.map((cat: string) => (
              <span key={cat} className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                {cat}
              </span>
            ))}
          </div>
        );
      }
    } catch {}
    return <span className="italic text-slate-400">None selected</span>;
  };

  const qualityLabel = (value?: string) => String(value || "good").replace(/_/g, " ");
  const trackingLabel = (value?: string) => String(value || "not_required").replace(/_/g, " ");

  const isFiltering = search.trim().length > 0 || statusFilter !== "all";

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

      {/* Channel Review Modal */}
      {viewModalOpen && selectedChannel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-5">
              <ChannelAvatar channel={selectedChannel} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-black text-slate-900">{selectedChannel.title || "Untitled Channel"}</h3>
                  <VerifiedBadge channel={selectedChannel} />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>#{selectedChannel.id}</span>
                  <StatusBadge status={selectedChannel.status} />
                </div>
              </div>
              <button onClick={() => setViewModalOpen(false)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-6">
              <ChannelControlCenter
                channelId={Number(selectedChannel.id)}
                onChanged={() => fetchChannels(page, statusFilter, search)}
              />
              {(selectedChannel.failure_reason || selectedChannel.paused_reason) && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                  {selectedChannel.failure_reason || selectedChannel.paused_reason}
                  {selectedChannel.suggested_fix && <div className="mt-1 font-medium text-amber-700">{selectedChannel.suggested_fix}</div>}
                </div>
              )}

              {/* Performance */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Performance</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Campaigns</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{formatMetric(selectedChannel.campaign_count)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Today&apos;s Views</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{formatMetric(selectedChannel.today_views)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total Views</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{formatMetric(selectedChannel.total_views)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Earnings</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{formatMoneyMetric(selectedChannel.earnings_generated)}</div>
                  </div>
                </div>
              </div>

              {/* Publisher Info */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Publisher Profile</h4>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Name</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.first_name} {selectedChannel.last_name}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Username</div>
                      <div className="mt-0.5 font-semibold text-slate-900">@{selectedChannel.owner_username || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">User ID</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.user_id}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Telegram ID</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.telegram_id}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Channel Info */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Channel Information</h4>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Username / Link</div>
                      {selectedChannel.channel_type !== "private" && publicChannelUrl(selectedChannel.username) ? (
                        <a href={publicChannelUrl(selectedChannel.username)!} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                          @{selectedChannel.username}<ExternalLink size={13} />
                        </a>
                      ) : (
                        <div className="mt-0.5 font-semibold text-slate-500">{selectedChannel.channel_type === "private" ? "Private channel" : "N/A"}</div>
                      )}
                    </div>
                    {selectedChannel.channel_type === "private" && (
                      <div className="col-span-2">
                        <div className="text-xs font-medium text-slate-500">Private Moderation URL</div>
                        {selectedChannel.private_invite_link_url ? (
                          <a
                            href={selectedChannel.private_invite_link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex max-w-full items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                          >
                            <span className="truncate">{selectedChannel.private_invite_link_url}</span>
                            <ExternalLink size={14} className="shrink-0" />
                          </a>
                        ) : (
                          <div className="mt-0.5 text-xs font-semibold text-slate-500">No stored private URL</div>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-slate-500">Chat ID</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.chat_id || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Subscribers</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.subscriber_count?.toLocaleString() || "0"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Posts / Day</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.posts_per_day}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Traffic Quality</div>
                      <div className="mt-0.5 font-semibold capitalize text-slate-900">{selectedChannel.traffic_quality_score || 60} / {qualityLabel(selectedChannel.traffic_quality_tier)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Risk Level</div>
                      <div className="mt-0.5 font-semibold capitalize text-slate-900">{qualityLabel(selectedChannel.traffic_risk_level)} risk</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Categories</div>
                      {renderCategories(selectedChannel.categories)}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Audience Continents</div>
                      {renderContinents(selectedChannel.audience_continents)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Activity & Tracking */}
              <div>
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Activity &amp; Tracking</h4>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <div className="text-xs font-medium text-slate-500">Last Successful Post</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.last_successful_post_at ? new Date(selectedChannel.last_successful_post_at).toLocaleString() : "Never"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Last Failure</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedChannel.last_failure_at ? new Date(selectedChannel.last_failure_at).toLocaleString() : "Never"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Tracking Account</div>
                      <div className="mt-0.5 font-semibold capitalize text-slate-900">
                        {selectedChannel.tracking_account ? `Account ${selectedChannel.tracking_account}` : "None"} / {trackingLabel(selectedChannel.tracking_account_status)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Tracking Member</div>
                      <div className="mt-0.5 font-semibold capitalize text-slate-900">{trackingLabel(selectedChannel.tracking_account_member_status || "unknown")}</div>
                    </div>
                    {selectedChannel.tracking_account_failure_reason && (
                      <div className="col-span-2">
                        <div className="text-xs font-medium text-slate-500">Tracking Failure Reason</div>
                        <div className="mt-0.5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          {selectedChannel.tracking_account_failure_reason}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Review actions */}
            <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
              {selectedChannel.status === "pending" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => openActionConfirm(selectedChannel, "reject", "Reject Channel", "Reject this channel?", true)}
                    disabled={actionLoading === selectedChannel.id}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <X size={16} />
                    Reject
                  </button>
                  <button
                    onClick={() => openActionConfirm(selectedChannel, "activate", "Activate Channel", "Activate this channel?")}
                    disabled={actionLoading === selectedChannel.id}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check size={16} />
                    Approve
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <ActionButtons channel={selectedChannel} actionLoading={actionLoading} onView={openViewModal} onAction={openActionConfirm} />
                  <button
                    onClick={() => setViewModalOpen(false)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Channels</h1>
        <p className="mt-0.5 text-sm text-slate-500">Review and manage publisher channel monetization</p>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Active Channels", summary.active_channels, "text-emerald-700"],
            ["Paused Channels", summary.paused_channels, "text-amber-700"],
            ["Failed Channels", summary.failed_channels, "text-red-700"],
            ["Deleted Channels", summary.deleted_channels, "text-slate-500"],
          ].map(([label, value, color]) => (
            <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
              <div className={`mt-2 text-xl font-black ${color}`}>{Number(value || 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main Table Card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">All Channels</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                placeholder="Search channels, owners..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-xs outline-none focus:ring-2 focus:ring-blue-500 sm:w-64"
              />
            </div>
            <div className="overflow-x-auto">
              <div className="flex w-max rounded-lg border border-slate-200/50 bg-slate-100 p-0.5">
                {["all", "pending", "active", "paused", "bot_removed", "channel_not_found", "permission_missing", "rejected"].map((f) => (
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
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Channel</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Owner</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Subscribers</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Campaigns</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Views (Today / Total)</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Earnings</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Quality</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <SkeletonTableRows columns={9} rows={6} />
              ) : channels.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10">
                    <EmptyState
                      icon={isFiltering ? Search : Tv}
                      title={isFiltering ? "No channels match your filters" : "No channels yet"}
                      message={isFiltering ? "Try a different search term or status filter." : "Publisher channels will appear here once submitted."}
                    />
                  </td>
                </tr>
              ) : (
                channels.map((channel: any) => (
                  <tr key={channel.id} className="align-top transition-colors hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <ChannelAvatar channel={channel} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="max-w-[160px] truncate font-semibold text-slate-900" title={channel.title}>{channel.title || "N/A"}</span>
                            <VerifiedBadge channel={channel} />
                          </div>
                          <div className="mt-0.5"><ChannelIdentifier channel={channel} /></div>
                          <div className="mt-0.5 text-xs text-slate-400">#{channel.id} · User {channel.user_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="max-w-[140px] truncate font-semibold text-slate-900">{[channel.first_name, channel.last_name].filter(Boolean).join(" ") || "N/A"}</div>
                      <div className="text-xs text-slate-500">@{channel.owner_username || "N/A"}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{channel.subscriber_count?.toLocaleString() || "0"}</div>
                      <div className="text-xs text-slate-500">{channel.posts_per_day} posts/day</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{formatMetric(channel.campaign_count)}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{formatMetric(channel.today_views)} <span className="font-normal text-slate-400">today</span></div>
                      <div className="text-xs text-slate-500">{formatMetric(channel.total_views)} total</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{formatMoneyMetric(channel.earnings_generated)}</div>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/admin/traffic-quality/channel/${channel.id}`} className="text-base font-black text-blue-700 hover:text-blue-900">{channel.traffic_quality_score || 60}</Link>
                      <div className="text-xs capitalize text-slate-500">{qualityLabel(channel.traffic_risk_level)} risk</div>
                      {(channel.failure_reason || channel.paused_reason) && (
                        <div className="mt-1 max-w-[160px] truncate text-[10px] font-semibold text-amber-600" title={channel.failure_reason || channel.paused_reason}>
                          {channel.failure_reason || channel.paused_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={channel.status} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <ActionButtons channel={channel} actionLoading={actionLoading} onView={openViewModal} onAction={openActionConfirm} />
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
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : channels.length === 0 ? (
            <EmptyState
              icon={isFiltering ? Search : Tv}
              title={isFiltering ? "No channels match your filters" : "No channels yet"}
              message={isFiltering ? "Try a different search term or status filter." : "Publisher channels will appear here once submitted."}
            />
          ) : (
            channels.map((channel: any) => (
              <div key={channel.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <ChannelAvatar channel={channel} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold text-slate-900">{channel.title || "N/A"}</span>
                        <VerifiedBadge channel={channel} />
                      </div>
                      <div className="mt-1 min-w-0"><ChannelIdentifier channel={channel} mobile /></div>
                      <div className="mt-0.5 text-xs text-slate-500">Owner: {[channel.first_name, channel.last_name].filter(Boolean).join(" ") || "N/A"} · #{channel.id}</div>
                    </div>
                  </div>
                  <StatusBadge status={channel.status} />
                </div>
                {(channel.failure_reason || channel.paused_reason) && (
                  <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
                    {channel.failure_reason || channel.paused_reason}
                    {channel.suggested_fix && <div className="mt-1 font-normal">{channel.suggested_fix}</div>}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Subscribers</div>
                    <div className="mt-1 font-semibold text-slate-900">{channel.subscriber_count?.toLocaleString() || "0"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Campaigns</div>
                    <div className="mt-1 font-semibold text-slate-900">{formatMetric(channel.campaign_count)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Views (Today / Total)</div>
                    <div className="mt-1 font-semibold text-slate-900">{formatMetric(channel.today_views)} / {formatMetric(channel.total_views)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Earnings</div>
                    <div className="mt-1 font-semibold text-slate-900">{formatMoneyMetric(channel.earnings_generated)}</div>
                  </div>
                  <div className="col-span-2 rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Traffic Quality</div>
                    <Link href={`/admin/traffic-quality/channel/${channel.id}`} className="mt-1 block font-semibold text-blue-700 hover:text-blue-900">{channel.traffic_quality_score || 60} · {qualityLabel(channel.traffic_risk_level)} risk</Link>
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <ActionButtons channel={channel} actionLoading={actionLoading} onView={openViewModal} onAction={openActionConfirm} />
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
