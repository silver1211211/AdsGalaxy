"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import { ArrowLeft, CheckCircle2, Loader2, Pause, Play, RotateCcw, Trash2, Zap } from "lucide-react";

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  return String(value);
}

function renderContinents(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.join(", ") : value;
  } catch {
    return value || "N/A";
  }
}

type EmergencyPushSummary = {
  mode: string;
  eligibleChannels: number;
  attempted: number;
  posted: number;
  failed: number;
  skipped: number;
  deleteSummary?: {
    deleted?: number;
    failed?: number;
  } | null;
  failedChannels: Array<{
    channelId: number;
    reason: string;
  }>;
};

type CampaignDetailsCampaign = {
  id: number;
  user_id: number;
  name: string;
  campaign_title?: string | null;
  message_text?: string | null;
  link?: string | null;
  button_text?: string | null;
  parse_mode?: string | null;
  image_url?: string | null;
  postback_url?: string | null;
  type: string;
  category: string;
  continents: string;
  budget: string | number;
  cpm: string | number;
  cpc?: string | number | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  paused_at?: string | null;
  resume_locked_until?: string | null;
  pause_reason?: string | null;
  budget_exhausted_at?: string | null;
  completed_at?: string | null;
  channel_settlement_finalized_at?: string | null;
  telegram_cleanup_status?: string | null;
  telegram_cleanup_attempted_at?: string | null;
  archived_at?: string | null;
  auto_reactivate?: boolean | number;
  spend?: string | number;
  approved_count?: string | number;
  rejected_count?: string | number;
};

type CampaignMetrics = Record<string, string | number | null | undefined>;

type EditCampaignData = {
  name?: string;
  campaign_title?: string;
  message_text?: string;
  link?: string;
  button_text?: string;
  category?: string;
  cpm?: string | number;
  cpc?: string | number;
};

type PlacementRow = {
  id: number;
  channel_id: number;
  channel_username?: string | null;
  message_id?: string | number | null;
  status: string;
  views?: number | null;
  clicks?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
  delete_attempts?: number | null;
  delete_failed_reason?: string | null;
  cleanup_attempted_at?: string | null;
  cleanup_status?: string | null;
  cleanup_completed_at?: string | null;
  cleanup_error?: string | null;
  cleanup_retry_count?: number | null;
};

type CampaignDetailsData = {
  campaign: CampaignDetailsCampaign;
  metrics?: CampaignMetrics;
  placements?: PlacementRow[];
};

type ConfirmAction =
  | "pause_only"
  | "pause"
  | "pause_finalize"
  | "resume"
  | "delete"
  | "retry_cleanup"
  | "force_refresh_stats"
  | "force_settlement"
  | "refresh_and_settle";
type PendingConfirm = {
  action: ConfirmAction;
  title: string;
  message: string;
  danger?: boolean;
} | null;

type PendingEmergency = "fill_empty_slots" | "replace_everything" | null;

type CampaignActionResult = {
  status?: string;
  warning?: string;
  refresh?: {
    postsChecked?: number;
    postsUpdated?: number;
    failedFetches?: number;
    skippedPosts?: number;
    errors?: Array<{ post_id: number; error: string }>;
  } | null;
  settlement?: {
    postsSettled?: number;
    settledPosts?: number;
    failedPosts?: number;
    totalUnitsSettled?: number;
    amountDebited?: number;
    advertiserDebited?: number;
    publisherCredited?: number;
    platformRevenue?: number;
    reserve?: number;
    outstandingPosts?: number;
    failedDetails?: Array<{ postId: number; reason: string }>;
  } | null;
  deletion?: {
    deleted?: number;
    failed?: number;
    retry?: number;
    details?: Array<{
      id: number;
      status: string;
      cleanup_status?: string;
      error_code?: string;
      retryable?: boolean;
      reason?: string;
      telegram_response?: string;
    }>;
  } | null;
} | null;

type SettlementSummary = Record<string, string | number | null | unknown[]>;
type DeliveryStatus = Record<string, string | number | boolean | null | string[]>;
type CleanupErrorRow = Record<string, string | number | boolean | null>;

export default function AdminCampaignDetailsPage() {
  const params = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<EmergencyPushSummary | null>(null);
  const [data, setData] = useState<CampaignDetailsData | null>(null);
  const [settlementSummary, setSettlementSummary] = useState<SettlementSummary | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus | null>(null);
  const [cleanupErrors, setCleanupErrors] = useState<CleanupErrorRow[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [pendingEmergency, setPendingEmergency] = useState<PendingEmergency>(null);
  const [actionResult, setActionResult] = useState<CampaignActionResult>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<EditCampaignData>({});
  const [editLoading, setEditLoading] = useState(false);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${params.id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load campaign");
      setData(body as CampaignDetailsData);
      const [settlementRes, deliveryRes, cleanupRes] = await Promise.all([
        fetch(`/api/admin/campaigns/${params.id}/settlement-summary`),
        fetch(`/api/admin/campaigns/${params.id}/delivery-status`),
        fetch(`/api/admin/campaigns/${params.id}/cleanup-errors`),
      ]);
      if (settlementRes.ok) {
        const settlementBody = await settlementRes.json();
        setSettlementSummary(settlementBody.summary || null);
      }
      if (deliveryRes.ok) {
        const deliveryBody = await deliveryRes.json();
        setDeliveryStatus(deliveryBody.status || null);
      }
      if (cleanupRes.ok) {
        const cleanupBody = await cleanupRes.json();
        setCleanupErrors(cleanupBody.errors || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void Promise.resolve().then(fetchDetails);
  }, [fetchDetails]);

  const runAction = async (action: ConfirmAction) => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/admin/campaigns/${params.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Action failed");
      setActionResult(body as CampaignActionResult);
      await fetchDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading("");
    }
  };

  const runEmergencyPush = async (mode: "fill_empty_slots" | "replace_everything") => {
    const label = mode === "fill_empty_slots" ? "Fill Empty Slots" : "Replace Everything";
    const actionKey = mode === "fill_empty_slots" ? "emergency-fill" : "emergency-replace";
    const confirmation = mode === "replace_everything" ? typedConfirmation : undefined;

    setActionLoading(actionKey);
    try {
      const res = await fetch(`/api/admin/campaigns/${params.id}/emergency-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirmation }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `${label} failed`);
      setSummary(body as EmergencyPushSummary);
      await fetchDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setActionLoading("");
    }
  };

  const campaign = data?.campaign;
  const metrics = data?.metrics || {};
  const placements = data?.placements || [];

  const openActionConfirm = (action: ConfirmAction) => {
    const labels: Record<ConfirmAction, string> = {
      pause_only: "Pause Campaign",
      pause: "Pause + Finalize",
      pause_finalize: "Pause + Finalize",
      resume: "Resume Campaign",
      delete: "Delete Campaign",
      retry_cleanup: "Retry Failed Cleanup",
      force_refresh_stats: "Force Refresh Statistics",
      force_settlement: "Force Settlement",
      refresh_and_settle: "Refresh + Settle",
    };
    const messages: Record<ConfirmAction, string> = {
      pause_only: "Pause this campaign? Future deliveries stop immediately. No settlement, Telegram stats refresh, or post cleanup will run.",
      pause: "Pause and finalize this campaign? Future deliveries stop immediately, Telegram stats refresh once, outstanding deltas settle, and Telegram cleanup is attempted after settlement.",
      pause_finalize: "Pause and finalize this campaign? Future deliveries stop immediately, Telegram stats refresh once, outstanding deltas settle, and Telegram cleanup is attempted after settlement.",
      resume: "Resume this campaign? Delivery can continue. No settlement or cleanup will run.",
      delete: "Delete this campaign? It will be paused, finalized, archived, then marked deleted. Settlement must complete before deletion.",
      retry_cleanup: "Retry failed Telegram cleanup for this campaign? No settlement or financial changes will run.",
      force_refresh_stats: "Refresh Telegram statistics for this campaign? This updates stored totals only and does not run settlement.",
      force_settlement: "Settle current database deltas for this campaign? This does not fetch Telegram statistics.",
      refresh_and_settle: "Refresh Telegram statistics, then settle current deltas? Partial refresh failures will be shown in the result.",
    };
    setPendingConfirm({
      action,
      title: labels[action],
      message: messages[action],
      danger: action === "delete",
    });
  };

  const confirmAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm.action;
    setPendingConfirm(null);
    await runAction(action);
  };

  const openEmergencyConfirm = (mode: "fill_empty_slots" | "replace_everything") => {
    setTypedConfirmation("");
    setPendingEmergency(mode);
  };

  const confirmEmergency = async () => {
    if (!pendingEmergency) return;
    const mode = pendingEmergency;
    setPendingEmergency(null);
    await runEmergencyPush(mode);
    setTypedConfirmation("");
  };

  const openEditModal = () => {
    if (!campaign) return;
    setEditData({
      name: campaign.name || "",
      campaign_title: campaign.campaign_title || "",
      message_text: campaign.message_text || "",
      link: campaign.link || "",
      button_text: campaign.button_text || "",
      category: campaign.category || "",
      cpm: campaign.cpm || "",
      ...(campaign.cpc !== undefined ? { cpc: campaign.cpc || "" } : {}),
    });
    setEditMode(true);
  };

  const submitEdit = async () => {
    setEditLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Edit failed");
      setError("");
      setEditMode(false);
      await fetchDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>
      <Modal
        isOpen={!!actionResult}
        onClose={() => setActionResult(null)}
        type={actionResult?.warning ? "warning" : "success"}
        title={actionResult?.warning ? "Campaign Updated With Cleanup Details" : "Campaign Updated"}
      >
        {actionResult && (
          <div className="space-y-2">
            <p>Status: {formatValue(actionResult.status)}</p>
            {actionResult.warning && <p>{actionResult.warning}</p>}
            {actionResult.refresh && (
              <p>
                Refreshed {actionResult.refresh.postsChecked || 0} post(s); {actionResult.refresh.postsUpdated || 0} updated; {actionResult.refresh.failedFetches || 0} failed; {actionResult.refresh.skippedPosts || 0} skipped.
              </p>
            )}
            {actionResult.deletion && (
              <p>
                Deleted {actionResult.deletion.deleted || 0} post(s); {actionResult.deletion.failed || 0} failed; {actionResult.deletion.retry || 0} retry.
              </p>
            )}
            {actionResult.settlement && (
              <p>
                Settled {actionResult.settlement.postsSettled || actionResult.settlement.settledPosts || 0} post(s), debited ${actionResult.settlement.amountDebited || actionResult.settlement.advertiserDebited || 0}, credited ${actionResult.settlement.publisherCredited || 0}.
              </p>
            )}
            {(actionResult.refresh?.errors || []).slice(0, 6).map((item) => (
              <p key={item.post_id} className="break-words">Post #{item.post_id}: {item.error}</p>
            ))}
            {(actionResult.deletion?.details || []).filter((item) => item.status !== "deleted").slice(0, 8).map((item) => (
              <p key={item.id} className="break-words">
                Post #{item.id}: {item.error_code ? `${item.error_code}: ` : ""}{item.reason || item.telegram_response || item.cleanup_status || item.status}
              </p>
            ))}
          </div>
        )}
      </Modal>
      <ConfirmationModal
        isOpen={!!pendingConfirm}
        onClose={() => setPendingConfirm(null)}
        onConfirm={confirmAction}
        title={pendingConfirm?.title || ""}
        message={pendingConfirm?.message || ""}
        confirmBtnText="Confirm"
        confirmBtnVariant={pendingConfirm?.danger ? "danger" : "primary"}
        isLoading={!!actionLoading}
      />
      <ConfirmationModal
        isOpen={!!pendingEmergency}
        onClose={() => { setPendingEmergency(null); setTypedConfirmation(""); }}
        onConfirm={confirmEmergency}
        title={pendingEmergency === "replace_everything" ? "Emergency Push: Replace Everything" : "Emergency Push: Fill Empty Slots"}
        message={pendingEmergency === "replace_everything"
          ? "Danger: This will delete all currently active ads from Telegram channels, then immediately push this campaign to eligible channels. This may affect all advertisers. Type CONFIRM to continue."
          : "You are about to immediately push this campaign to all eligible empty channels. Normal posting schedules will be bypassed for this emergency action only. Continue?"}
        confirmBtnText={pendingEmergency === "replace_everything" ? "Replace Everything" : "Push Now"}
        confirmBtnVariant={pendingEmergency === "replace_everything" ? "danger" : "primary"}
        isLoading={!!actionLoading}
        typedConfirmation={pendingEmergency === "replace_everything" ? {
          phrase: "CONFIRM",
          value: typedConfirmation,
          onChange: setTypedConfirmation,
        } : undefined}
      />
      <Modal isOpen={!!summary} onClose={() => setSummary(null)} type="success" title="Emergency Push Summary">
        {summary && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Mode", summary.mode],
                ["Eligible", summary.eligibleChannels],
                ["Attempted", summary.attempted],
                ["Posted", summary.posted],
                ["Failed", summary.failed],
                ["Skipped", summary.skipped],
              ].map(([label, value]) => (
                <div key={label} className="bg-slate-50 p-2 rounded-md border border-slate-200">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
                  <p className="font-medium text-slate-900 break-words">{formatValue(value)}</p>
                </div>
              ))}
            </div>
            {summary.deleteSummary && (
              <p className="text-xs text-slate-500">
                Deleted {summary.deleteSummary.deleted || 0} active posts; {summary.deleteSummary.failed || 0} deletion failures.
              </p>
            )}
            {summary.failedChannels?.length > 0 && (
              <p className="text-xs text-slate-500">
                Failed/skipped channels: {summary.failedChannels.slice(0, 8).map((item) => `#${item.channelId}: ${item.reason}`).join(", ")}
                {summary.failedChannels.length > 8 ? " ..." : ""}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={editMode} onClose={() => setEditMode(false)} title="Edit Campaign Details">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Campaign Name</label>
            <input
              type="text"
              maxLength={255}
              value={String(editData.name || "")}
              onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Campaign Title</label>
            <input
              type="text"
              maxLength={255}
              value={String(editData.campaign_title || "")}
              onChange={(e) => setEditData({ ...editData, campaign_title: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Message Text</label>
            <textarea
              maxLength={4096}
              value={String(editData.message_text || "")}
              onChange={(e) => setEditData({ ...editData, message_text: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm h-24"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Link/URL</label>
            <input
              type="text"
              maxLength={512}
              value={String(editData.link || "")}
              onChange={(e) => setEditData({ ...editData, link: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Button Text</label>
            <input
              type="text"
              maxLength={64}
              value={String(editData.button_text || "")}
              onChange={(e) => setEditData({ ...editData, button_text: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Category</label>
            <input
              type="text"
              maxLength={64}
              value={String(editData.category || "")}
              onChange={(e) => setEditData({ ...editData, category: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">CPM ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editData.cpm || ""}
                onChange={(e) => setEditData({ ...editData, cpm: e.target.value ? parseFloat(e.target.value) : "" })}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
              />
            </div>
            {campaign?.cpc !== undefined && (
              <div>
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">CPC ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editData.cpc || ""}
                  onChange={(e) => setEditData({ ...editData, cpc: e.target.value ? parseFloat(e.target.value) : "" })}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
                />
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-slate-200">
            <button
              onClick={submitEdit}
              disabled={editLoading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {editLoading ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={() => setEditMode(false)}
              disabled={editLoading}
              className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4 w-full max-w-full min-w-0 overflow-x-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
          <Link href="/admin/campaigns" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-600 whitespace-nowrap">
            <ArrowLeft size={16} /> Back to Campaigns
          </Link>

          {campaign && (
            <div className="flex w-full max-w-full flex-wrap items-center gap-2 overflow-x-auto pb-1 sm:w-auto">
              <button onClick={openEditModal} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                Edit Details
              </button>
              {campaign.status === "active" && (
                <>
                  <button onClick={() => openEmergencyConfirm("fill_empty_slots")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "emergency-fill" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Emergency Push: Fill Empty Slots
                  </button>
                  <button onClick={() => openEmergencyConfirm("replace_everything")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-red-50 text-red-700 border border-red-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "emergency-replace" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Emergency Push: Replace Everything
                  </button>
                </>
              )}
              {campaign.status === "active" && (
                <button onClick={() => openActionConfirm("pause_only")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                  {actionLoading === "pause_only" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pause
                </button>
              )}
              {campaign.status !== "deleted" && (
                <button onClick={() => openActionConfirm("pause_finalize")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                  {actionLoading === "pause_finalize" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Pause + Finalize
                </button>
              )}
              {campaign.status !== "deleted" && (
                <>
                  <button onClick={() => openActionConfirm("force_refresh_stats")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-cyan-50 text-cyan-700 border border-cyan-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "force_refresh_stats" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Force Refresh Statistics
                  </button>
                  <button onClick={() => openActionConfirm("force_settlement")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "force_settlement" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Force Settlement
                  </button>
                  <button onClick={() => openActionConfirm("refresh_and_settle")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-violet-50 text-violet-700 border border-violet-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "refresh_and_settle" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Refresh + Settle
                  </button>
                </>
              )}
              {campaign.status === "paused" && (
                <>
                  <button onClick={() => openActionConfirm("resume")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "resume" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Resume
                  </button>
                  <button onClick={() => openActionConfirm("retry_cleanup")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "retry_cleanup" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry Failed Cleanup
                  </button>
                </>
              )}
              {campaign.status !== "deleted" && (
                <button onClick={() => openActionConfirm("delete")} disabled={!!actionLoading} className="shrink-0 px-3 py-1.5 bg-red-50 text-red-700 border border-red-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                  {actionLoading === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center bg-white rounded-lg border border-slate-200">
            <Loader2 className="animate-spin text-blue-600 mx-auto" size={20} />
          </div>
        ) : campaign ? (
          <>
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Campaign Details (#{campaign.id})</h2>
                <span className="px-2 py-0.5 rounded text-xs font-medium capitalize bg-slate-100 text-slate-700 border border-slate-200">{campaign.status}</span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                {[
                  ["Advertiser User ID", campaign.user_id],
                  ["Name", campaign.name],
                  ["Type", campaign.type === "broadcast" ? "BOT" : "CHANNEL"],
                  ["Category", campaign.category],
                  ["Continents", renderContinents(campaign.continents)],
                  ["Budget Remaining", `$${campaign.budget}`],
                  ["Lifetime Spend", `$${campaign.spend || 0}`],
                  [campaign.type === "clicks" ? "CPC" : "CPM", `$${campaign.type === "clicks" ? (campaign.cpc || campaign.cpm) : campaign.cpm}`],
                  ["Impressions", metrics.total_views || 0],
                  ["Clicks", metrics.total_clicks || 0],
                  ["Approved Count", campaign.approved_count || 0],
                  ["Rejected Count", campaign.rejected_count || 0],
                  ["Created", campaign.created_at],
                  ["Updated", campaign.updated_at],
                  ["Paused At", campaign.paused_at],
                  ["Resume Locked Until", campaign.resume_locked_until],
                  ["Pause Reason", campaign.pause_reason],
                  ["Budget Exhausted At", campaign.budget_exhausted_at],
                  ["Completed At", campaign.completed_at],
                  ["Final Settlement", campaign.channel_settlement_finalized_at],
                  ["Cleanup Status", campaign.telegram_cleanup_status],
                  ["Cleanup Attempted", campaign.telegram_cleanup_attempted_at],
                  ["Archived At", campaign.archived_at],
                  ["Auto Reactivate", campaign.auto_reactivate ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-50 p-3 rounded-md border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
                    <p className="font-medium text-slate-900 break-words">{formatValue(value)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Placement Statistics</h2>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                {[
                  ["Total Posts", metrics.total_posts],
                  ["Active Posts", metrics.active_posts],
                  ["Cleanup Pending", metrics.cleanup_pending_posts],
                  ["Cleanup Success", metrics.cleanup_status_success_posts],
                  ["Cleanup Retry", metrics.cleanup_status_retry_posts],
                  ["Cleanup Failed", metrics.cleanup_status_failed_posts],
                  ["Settlement Pending", metrics.settlement_pending_posts],
                  ["Replaced", metrics.replaced_posts],
                  ["Already Missing", metrics.already_missing_posts],
                  ["Deleted Posts", metrics.deleted_posts],
                  ["Delete Failed", metrics.delete_failed_posts],
                  ["Total Views", metrics.total_views],
                  ["Total Clicks", metrics.total_clicks],
                  ["CTR", `${(Number(metrics.ctr || 0) * 100).toFixed(2)}%`],
                  ["Channels Posted", metrics.channels_posted_to],
                  ["Last Posted", metrics.last_posted_at],
                  ["Last View Update", metrics.last_view_update],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-50 p-3 rounded-md border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
                    <p className="font-medium text-slate-900 break-words">{formatValue(value)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">Settlement Summary</h2>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Total Posts", settlementSummary?.totalPosts],
                    ["Unsettled Views", settlementSummary?.unsettledViews],
                    ["Unsettled Clicks", settlementSummary?.unsettledClicks],
                    ["Spend", `$${settlementSummary?.totalSpend || 0}`],
                    ["Publisher", `$${settlementSummary?.publisherEarnings || 0}`],
                    ["Platform", `$${settlementSummary?.platformRevenue || 0}`],
                    ["Reserve", `$${settlementSummary?.reserve || 0}`],
                    ["Last Settlement", settlementSummary?.lastSettlementTime],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="bg-slate-50 p-3 rounded-md border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{String(label)}</p>
                      <p className="font-medium text-slate-900 break-words">{formatValue(value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">Delivery Status</h2>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Would Run", deliveryStatus?.wouldProcessAdsPickCampaign ? "Yes" : "No"],
                    ["Budget", `$${deliveryStatus?.budget || 0}`],
                    ["Daily Remaining", deliveryStatus?.dailyBudgetRemaining === null ? "No limit" : `$${deliveryStatus?.dailyBudgetRemaining || 0}`],
                    ["Eligible Channels", deliveryStatus?.eligibleChannels],
                    ["Failures", deliveryStatus?.deliveryFailures],
                    ["Last Attempt", deliveryStatus?.lastDeliveryAttempt],
                    ["Last Success", deliveryStatus?.lastSuccessfulDelivery],
                    ["Skipped", Array.isArray(deliveryStatus?.skippedReasons) ? deliveryStatus?.skippedReasons.join(", ") || "None" : "None"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="bg-slate-50 p-3 rounded-md border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{String(label)}</p>
                      <p className="font-medium text-slate-900 break-words">{formatValue(value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">Cleanup Errors</h2>
                </div>
                <div className="p-4 space-y-2 text-sm">
                  {cleanupErrors.length === 0 ? (
                    <p className="text-slate-500">No cleanup errors.</p>
                  ) : cleanupErrors.slice(0, 6).map((item) => (
                    <div key={String(item.postId)} className="bg-slate-50 p-3 rounded-md border border-slate-200">
                      <p className="font-medium text-slate-900">Post #{formatValue(item.postId)} / Channel #{formatValue(item.channelId)}</p>
                      <p className="text-xs text-slate-500 break-words">{formatValue(item.error)}</p>
                      <p className="text-xs text-slate-500">Attempts: {formatValue(item.attempts)} | Retry: {item.retryAvailable ? "Yes" : "No"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Placements</h2>
              </div>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-full sm:min-w-[1000px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      {["Post ID", "Channel", "Message", "Status", "Cleanup", "Views", "Clicks", "Created", "Deleted", "Cleanup Attempt", "Cleanup Done", "Retries", "Cleanup Error"].map((heading) => (
                        <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {placements.length === 0 ? (
                      <tr><td colSpan={13} className="p-8 text-center text-slate-500">No placements found.</td></tr>
                    ) : placements.map((post) => (
                      <tr key={post.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">#{post.id}</td>
                        <td className="px-4 py-3">#{post.channel_id} @{post.channel_username || "N/A"}</td>
                        <td className="px-4 py-3">{formatValue(post.message_id)}</td>
                        <td className="px-4 py-3 capitalize">{post.status}</td>
                        <td className="px-4 py-3 capitalize">{formatValue(post.cleanup_status)}</td>
                        <td className="px-4 py-3">{post.views || 0}</td>
                        <td className="px-4 py-3">{post.clicks || 0}</td>
                        <td className="px-4 py-3">{formatValue(post.created_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.deleted_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.cleanup_attempted_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.cleanup_completed_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.cleanup_retry_count ?? post.delete_attempts)}</td>
                        <td className="px-4 py-3 max-w-[260px] truncate" title={post.cleanup_error || post.delete_failed_reason || ""}>{formatValue(post.cleanup_error || post.delete_failed_reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
