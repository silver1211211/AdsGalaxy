"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import { ArrowLeft, Loader2, Pause, Play, Trash2, Zap } from "lucide-react";

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
  type: string;
  category: string;
  continents: string;
  budget: string | number;
  cpm: string | number;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  paused_at?: string | null;
  resume_locked_until?: string | null;
  pause_reason?: string | null;
  budget_exhausted_at?: string | null;
  completed_at?: string | null;
  auto_reactivate?: boolean | number;
  spend?: string | number;
  approved_count?: string | number;
  rejected_count?: string | number;
};

type CampaignMetrics = Record<string, string | number | null | undefined>;

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
};

type CampaignDetailsData = {
  campaign: CampaignDetailsCampaign;
  metrics?: CampaignMetrics;
  placements?: PlacementRow[];
};

type ConfirmAction = "pause" | "resume" | "delete";
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
  deletion?: {
    deleted?: number;
    failed?: number;
    details?: Array<{
      id: number;
      status: string;
      reason?: string;
      telegram_response?: string;
    }>;
  } | null;
} | null;

export default function AdminCampaignDetailsPage() {
  const params = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<EmergencyPushSummary | null>(null);
  const [data, setData] = useState<CampaignDetailsData | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [pendingEmergency, setPendingEmergency] = useState<PendingEmergency>(null);
  const [actionResult, setActionResult] = useState<CampaignActionResult>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${params.id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load campaign");
      setData(body as CampaignDetailsData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [params.id]);

  const runAction = async (action: "pause" | "resume" | "delete") => {
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
    setPendingConfirm({
      action,
      title: action === "delete" ? "Delete Campaign" : `${action === "pause" ? "Pause" : "Resume"} Campaign`,
      message: action === "delete"
        ? "Delete this campaign? Active Telegram posts will be deleted and the campaign will be marked deleted."
        : `${action === "pause" ? "Pause" : "Resume"} this campaign?`,
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
            {actionResult.deletion && (
              <p>
                Deleted {actionResult.deletion.deleted || 0} post(s); {actionResult.deletion.failed || 0} cleanup failure(s).
              </p>
            )}
            {(actionResult.deletion?.details || []).filter((item) => item.status !== "deleted").slice(0, 8).map((item) => (
              <p key={item.id} className="break-words">
                Post #{item.id}: {item.reason || item.telegram_response || item.status}
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

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/admin/campaigns" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-600">
            <ArrowLeft size={16} /> Back to Campaigns
          </Link>

          {campaign && (
            <div className="flex items-center gap-2">
              {campaign.status === "active" && (
                <>
                  <button onClick={() => openEmergencyConfirm("fill_empty_slots")} disabled={!!actionLoading} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "emergency-fill" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Emergency Push: Fill Empty Slots
                  </button>
                  <button onClick={() => openEmergencyConfirm("replace_everything")} disabled={!!actionLoading} className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                    {actionLoading === "emergency-replace" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Emergency Push: Replace Everything
                  </button>
                </>
              )}
              {campaign.status === "active" && (
                <button onClick={() => openActionConfirm("pause")} disabled={!!actionLoading} className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                  {actionLoading === "pause" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pause
                </button>
              )}
              {campaign.status === "paused" && (
                <button onClick={() => openActionConfirm("resume")} disabled={!!actionLoading} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
                  {actionLoading === "resume" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Resume
                </button>
              )}
              {campaign.status !== "deleted" && (
                <button onClick={() => openActionConfirm("delete")} disabled={!!actionLoading} className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-100 rounded-md text-xs font-medium inline-flex items-center gap-1">
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
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                {[
                  ["Advertiser User ID", campaign.user_id],
                  ["Name", campaign.name],
                  ["Type", campaign.type === "broadcast" ? "BOT" : "CHANNEL"],
                  ["Category", campaign.category],
                  ["Continents", renderContinents(campaign.continents)],
                  ["Budget Remaining", `$${campaign.budget}`],
                  ["Lifetime Spend", `$${campaign.spend || 0}`],
                  ["CPM", `$${campaign.cpm}`],
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
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[
                  ["Total Posts", metrics.total_posts],
                  ["Active Posts", metrics.active_posts],
                  ["Cleanup Pending", metrics.cleanup_pending_posts],
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

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Placements</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[1000px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      {["Post ID", "Channel", "Message", "Status", "Views", "Clicks", "Created", "Deleted", "Cleanup Attempt", "Attempts", "Failure Reason"].map((heading) => (
                        <th key={heading} className="px-4 py-3 font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {placements.length === 0 ? (
                      <tr><td colSpan={11} className="p-8 text-center text-slate-500">No placements found.</td></tr>
                    ) : placements.map((post) => (
                      <tr key={post.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">#{post.id}</td>
                        <td className="px-4 py-3">#{post.channel_id} @{post.channel_username || "N/A"}</td>
                        <td className="px-4 py-3">{formatValue(post.message_id)}</td>
                        <td className="px-4 py-3 capitalize">{post.status}</td>
                        <td className="px-4 py-3">{post.views || 0}</td>
                        <td className="px-4 py-3">{post.clicks || 0}</td>
                        <td className="px-4 py-3">{formatValue(post.created_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.deleted_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.cleanup_attempted_at)}</td>
                        <td className="px-4 py-3">{formatValue(post.delete_attempts)}</td>
                        <td className="px-4 py-3 max-w-[220px] truncate" title={post.delete_failed_reason || ""}>{formatValue(post.delete_failed_reason)}</td>
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
