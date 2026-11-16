"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Modal from "@/components/ui/Modal";
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Loader2,
  Search,
  X,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  ShieldAlert,
  RotateCw,
  RefreshCw,
} from "lucide-react";
import { useAdminRequestGuard } from "@/hooks/useAdminRequestGuard";
import type { VerificationEvidence, VerificationStatus } from "@/lib/withdrawalVerification";

type ActionType = "approve" | "reject" | "ban_user";

type WithdrawalRow = {
  id: number;
  user_id: number;
  amount: string | number;
  fee?: string | number;
  net_amount?: string | number;
  status: string;
  refunded?: boolean | number;
  refund_evidence_status?: "verified" | "conflicting" | "historical_unverified" | "no_ledger_event";
  paid_out?: boolean | number;
  paid_at?: string | null;
  created_at?: string | null;
  address?: string | null;
  network?: string | null;
  owner_username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  owner_telegram_id?: string | number | null;
  is_banned?: boolean | number;
  channel_count?: string | number;
  total_audience?: string | number;
  channel_earnings_verified?: string | number;
  bot_count?: string | number;
  bot_impressions?: string | number;
  bot_earnings_verified?: string | number;
  referral_count?: string | number;
  referral_earnings_verified?: string | number;
  total_withdrawal_amount?: string | number;
  withdrawal_count?: string | number;
  total_earnings?: string | number;
  miniapp_count?: string | number;
  miniapp_impressions?: string | number;
  miniapp_earnings?: string | number;
  balance_locked?: string | number;
  balance_available?: string | number;
  preclearance?: {
    state: "cleared" | "manual_review_required";
    reasons: string[];
    reason_details?: Array<{ code: string; detail: string }>;
    risk?: { score: number; state: string };
    ledger?: { classification: string; coverage_gap_records: number };
  } | null;
  // Verification Fields
  verification_status?: VerificationStatus;
  verification_task_id?: number | null;
  verification_evidence?: VerificationEvidence | null;
  queue_position?: number | null;
};

type ActionModal = { type: ActionType; withdrawal: WithdrawalRow } | null;
type EarningsDetail = {
  channels: Array<{ id: number; title: string; earnings: string }>;
  bots: Array<{ id: number; name: string; impressions: number; earnings: string }>;
  miniapps: Array<{ id: number; name: string; impressions: number; earnings: string }>;
  referrals: Array<{ source: string; earnings: string }>;
  limit_per_source: number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compact(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function compactMetric(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}K`;
  return n.toLocaleString();
}

function EarningsSummary({ w }: { w: WithdrawalRow }) {
  const lines = [
    `CH ${compactMetric(w.channel_count)} · Audience sum ${compactMetric(w.total_audience)} · Earn ${money(w.channel_earnings_verified)}`,
    `BOT ${compactMetric(w.bot_count)} · Imp ${compactMetric(w.bot_impressions)} · Earn ${money(w.bot_earnings_verified)}`,
    `APP ${compactMetric(w.miniapp_count)} · Imp ${compactMetric(w.miniapp_impressions)} · Earn ${money(w.miniapp_earnings)}`,
    `REF ${compactMetric(w.referral_count)} · Earn ${money(w.referral_earnings_verified)}`,
  ];
  return <div className="mt-1.5 space-y-0.5 text-[10px] leading-3.5 text-slate-500" title="Lifetime settled earnings; audience is the sum of channel subscriber counts, not unique people">
    {lines.map((line) => <div key={line} className="whitespace-nowrap">{line}</div>)}
  </div>;
}

function financialAuditAssessment(w: WithdrawalRow) {
  if (Boolean(w.paid_out) && w.status !== "success") return "Payment/status conflict — investigate";
  if (w.status === "success") return "Recorded paid — confirm external transfer";
  if (w.status === "rejected") {
    if (w.refund_evidence_status === "verified") return "Refund recorded in balance ledger";
    return "Refund evidence incomplete — review";
  }
  if (w.verification_status === "Financial Discrepancy") return "Balance or earnings mismatch — hold";
  if (w.verification_status === "Manual Review" || w.verification_status === "Insufficient Evidence") return "Evidence review required";
  if (w.verification_status !== "Review Passed") return "Awaiting verification";
  if (Number(w.amount) < 50) return "Historical $10-policy request — owner review";
  return w.preclearance?.state === "cleared" ? "Ready for manual payout review" : "Destination and payment review required";
}

function statusClass(status: string) {
  if (status === "success") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function displayUsername(withdrawal: WithdrawalRow) {
  return withdrawal.owner_username ? `@${withdrawal.owner_username}` : "No Username";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function PayoutState({ withdrawal }: { withdrawal: WithdrawalRow }) {
  const paidOut = Boolean(withdrawal.paid_out) || withdrawal.status === "success";

  return (
    <div className={`mt-1 text-[10px] font-semibold ${paidOut ? "text-emerald-700" : "text-slate-500"}`}>
      {paidOut ? `Paid out${withdrawal.paid_at ? ` - ${formatDate(withdrawal.paid_at)}` : ""}` : "Never paid"}
    </div>
  );
}

function VerificationBadge({
  status,
  queuePos,
}: {
  status: VerificationStatus;
  queuePos?: number | null;
}) {
  switch (status) {
    case "Queued":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
          <RotateCw size={11} className="animate-spin text-blue-600" />
          Queued {queuePos ? `(#${queuePos})` : ""}
        </span>
      );
    case "Checking":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
          <Loader2 size={11} className="animate-spin text-purple-600" />
          Checking...
        </span>
      );
    case "Review Passed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          <CheckCircle size={11} className="text-emerald-600" />
          Review Passed
        </span>
      );
    case "Manual Review":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
          <AlertTriangle size={11} className="text-amber-600" />
          Manual Review
        </span>
      );
    case "Insufficient Evidence":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
          <AlertCircle size={11} className="text-orange-600" />
          Insufficient Evidence
        </span>
      );
    case "Referral Fraud Flagged":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
          <ShieldAlert size={11} /> Referral Fraud Flagged
        </span>
      );
    case "Financial Discrepancy":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
          <ShieldAlert size={11} className="text-red-600" />
          Financial Discrepancy
        </span>
      );
    case "Check Failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
          <X size={11} className="text-rose-600" />
          Check Failed
        </span>
      );
    case "Recheck Required":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
          <RefreshCw size={11} className="text-amber-600" />
          Recheck Required
        </span>
      );
    case "Not Checked":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          Not Checked
        </span>
      );
  }
}

export default function AdminWithdrawalsPage() {
  const beginListRequest = useAdminRequestGuard();
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [reason, setReason] = useState("");
  const [historicalPolicyReviewed, setHistoricalPolicyReviewed] = useState(false);
  const [refund, setRefund] = useState(true);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRow | null>(null);
  const [preclearanceLoading, setPreclearanceLoading] = useState<number | null>(null);
  const [earningsDetail, setEarningsDetail] = useState<EarningsDetail | null>(null);
  const [earningsDetailError, setEarningsDetailError] = useState("");
  const [refundDryRun, setRefundDryRun] = useState<{ state: string; restored: string; missing: string | null; reason: string } | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!detailsModalOpen || !selectedWithdrawal) return;
    const controller = new AbortController();
    setEarningsDetail(null);
    setEarningsDetailError("");
    setRefundDryRun(null);
    fetch(`/api/admin/withdrawals?refund_dry_run_id=${selectedWithdrawal.id}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) setRefundDryRun((await response.json()).refund_dry_run);
      })
      .catch(() => {});
    fetch(`/api/admin/withdrawals?earnings_detail_user_id=${selectedWithdrawal.user_id}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Earnings detail unavailable");
        setEarningsDetail(body);
      })
      .catch((error) => { if (!controller.signal.aborted) setEarningsDetailError(errorMessage(error, "Earnings detail unavailable")); });
    return () => controller.abort();
  }, [detailsModalOpen, selectedWithdrawal?.user_id]);

  const fetchWithdrawals = useCallback(
    async (p: number, s: string, q: string) => {
      const controller = beginListRequest();
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/withdrawals?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to fetch withdrawals");
        setWithdrawals(data.withdrawals || []);
        setTotalPages(data.totalPages || 1);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err, "Failed to fetch withdrawals"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [beginListRequest]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchWithdrawals(page, statusFilter, search);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [page, statusFilter, search, fetchWithdrawals]);

  // Polling for active checks
  useEffect(() => {
    const activeTasks = withdrawals.filter(
      (w) => w.verification_status === "Queued" || w.verification_status === "Checking"
    );

    if (activeTasks.length > 0) {
      pollingRef.current = setInterval(async () => {
        for (const w of activeTasks) {
          try {
            const res = await fetch("/api/admin/withdrawals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "get_verification_status", withdrawal_id: w.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success && data.status) {
              setWithdrawals((current) =>
                current.map((item) =>
                  item.id === w.id
                    ? {
                        ...item,
                        verification_status: data.status,
                        queue_position: data.queue_position,
                        verification_evidence: data.evidence,
                      }
                    : item
                )
              );
              setSelectedWithdrawal((curr) =>
                curr && curr.id === w.id
                  ? {
                      ...curr,
                      verification_status: data.status,
                      queue_position: data.queue_position,
                      verification_evidence: data.evidence,
                    }
                  : curr
              );
            }
          } catch {
            // ignore polling network glitch
          }
        }
      }, 2500);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [withdrawals]);

  // Enqueue Check
  const handleCheck = async (withdrawalId: number) => {
    setCheckingIds((prev) => new Set(prev).add(withdrawalId));
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue_check", withdrawal_id: withdrawalId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to enqueue verification");

      setWithdrawals((current) =>
        current.map((w) =>
          w.id === withdrawalId
            ? {
                ...w,
                verification_status: data.status || "Queued",
                queue_position: data.queue_position,
                verification_evidence: data.evidence ?? w.verification_evidence,
              }
            : w
        )
      );
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to enqueue check"));
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(withdrawalId);
        return next;
      });
    }
  };

  const loadPreclearance = async (withdrawal: WithdrawalRow) => {
    if (withdrawal.preclearance) return withdrawal;
    setPreclearanceLoading(withdrawal.id);
    try {
      const res = await fetch(`/api/admin/withdrawals?preclearance_id=${withdrawal.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load safety assessment");
      const updated = { ...withdrawal, preclearance: data.preclearance };
      setWithdrawals((items) => (items.map((item) => (item.id === withdrawal.id ? updated : item))));
      return updated;
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to load safety assessment"));
      return null;
    } finally {
      setPreclearanceLoading(null);
    }
  };

  const openAction = async (type: ActionType, withdrawal: WithdrawalRow) => {
    let reviewed = withdrawal;
    if (type === "approve") {
      try {
        const loaded = await loadPreclearance(withdrawal);
        if (loaded) reviewed = loaded;
      } catch {
        // non-blocking
      }
    }
    setActionModal({ type, withdrawal: reviewed });
    setReason("");
    setHistoricalPolicyReviewed(true);
    setRefund(type === "reject" && withdrawal.status !== "success" && !withdrawal.refunded);
  };

  const closeAction = () => {
    setActionModal(null);
    setReason("");
    setHistoricalPolicyReviewed(false);
    setRefund(true);
  };

  const runAction = async () => {
    if (!actionModal) return;
    const { type, withdrawal } = actionModal;
    setActionLoading(withdrawal.id);
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: withdrawal.id,
          action: type,
          reason: reason.trim() || (type === "approve" ? "Approved by administrator" : ""),
          refund,
          historical_policy_reviewed: true
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      closeAction();
      await fetchWithdrawals(page, statusFilter, search);
    } catch (err: unknown) {
      setError(errorMessage(err, "Action failed"));
    } finally {
      setActionLoading(null);
    }
  };

  const copyAddress = async (withdrawal: WithdrawalRow) => {
    const address = withdrawal.address || "";
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = address;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    setCopiedId(withdrawal.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const AddressCell = ({ withdrawal }: { withdrawal: WithdrawalRow }) => (
    <div className="flex min-w-0 items-center gap-1.5">
      <code
        className="max-w-[180px] truncate rounded bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-700"
        title={withdrawal.address || "No address"}
      >
        {withdrawal.address || "No address"}
      </code>
      <button
        onClick={() => copyAddress(withdrawal)}
        disabled={!withdrawal.address}
        className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-blue-600 disabled:opacity-40"
        title="Copy address"
      >
        <Copy size={12} />
      </button>
      {copiedId === withdrawal.id && (
        <span className="text-[10px] font-semibold text-emerald-600">Copied</span>
      )}
    </div>
  );

  const ActionButtons = ({ withdrawal }: { withdrawal: WithdrawalRow }) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button
        onClick={() => void openAction("approve", withdrawal)}
        disabled={actionLoading === withdrawal.id || preclearanceLoading === withdrawal.id}
        title="Review and approve withdrawal"
        className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        {actionLoading === withdrawal.id || preclearanceLoading === withdrawal.id ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Check size={12} />
        )}{" "}
        Approve
      </button>
      <button
        onClick={() => void openAction("reject", withdrawal)}
        disabled={actionLoading === withdrawal.id}
        className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {actionLoading === withdrawal.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Reject
      </button>
      <button
        onClick={() => void openAction("ban_user", withdrawal)}
        disabled={actionLoading === withdrawal.id || Boolean(withdrawal.is_banned)}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        <Ban size={12} /> {withdrawal.is_banned ? "Banned" : "Ban"}
      </button>
    </div>
  );

  const actionTitle =
    actionModal?.type === "approve"
      ? "Approve Withdrawal"
      : actionModal?.type === "reject"
      ? "Reject Withdrawal"
      : "Ban User";
  const actionMessage = actionModal
    ? `${displayUsername(actionModal.withdrawal)} - ${money(actionModal.withdrawal.amount)} - Withdrawal #${actionModal.withdrawal.id}`
    : "";

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">
        {error}
      </Modal>

      <ConfirmationModal
        isOpen={!!actionModal}
        onClose={closeAction}
        onConfirm={runAction}
        title={actionTitle}
        message={actionMessage}
        confirmBtnText={
          actionModal?.type === "approve" ? "Approve" : actionModal?.type === "reject" ? "Reject" : "Ban User"
        }
        confirmBtnVariant={actionModal?.type === "approve" ? "primary" : "danger"}
        isLoading={actionLoading !== null}
      >
        {actionModal?.type !== "approve" && (
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              {actionModal?.type === "ban_user" ? "Ban reason" : "Reject reason"}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-blue-500"
              placeholder="Reason for this action..."
            />
          </div>
        )}

        {actionModal?.type === "approve" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
              <div className="font-semibold text-emerald-800 mb-1">Confirm Withdrawal Approval</div>
              <div>
                Approving will mark this withdrawal as paid and update user balances.
                {Number(actionModal.withdrawal.amount) < 50 && (
                  <span className="block mt-1 font-medium text-amber-700">
                    Note: This withdrawal ({money(actionModal.withdrawal.amount)}) is below the standard 50 USDT minimum. Approving confirms admin override.
                  </span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">
                Admin Note <span className="font-normal text-slate-400 lowercase">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-blue-500"
                placeholder="Optional note for admin audit log..."
              />
            </div>
          </div>
        )}

        {actionModal?.type === "reject" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={refund}
                onChange={(e) => setRefund(e.target.checked)}
                disabled={actionModal.withdrawal.status === "success" || Boolean(actionModal.withdrawal.refunded)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Refund locked funds to available balance
            </label>
          </div>
        )}
      </ConfirmationModal>

      {/* Verification Evidence & Details Modal */}
      {detailsModalOpen && selectedWithdrawal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Withdrawal Verification Details — #{selectedWithdrawal.id}
                </h3>
                <div className="text-xs text-slate-500">
                  {displayUsername(selectedWithdrawal)} (User #{selectedWithdrawal.user_id})
                </div>
              </div>
              <button
                onClick={() => setDetailsModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-5 text-sm">
              {/* Status Header */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase text-slate-500">Current Status:</span>
                  <VerificationBadge
                    status={selectedWithdrawal.verification_status || "Not Checked"}
                    queuePos={selectedWithdrawal.queue_position}
                  />
                </div>
                {selectedWithdrawal.verification_evidence?.checked_at && (
                  <span className="text-xs text-slate-400 font-mono">
                    {formatDate(selectedWithdrawal.verification_evidence.checked_at)}
                  </span>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="mb-1 font-bold uppercase tracking-wider text-slate-500">Lifetime verified source summary</div>
                <EarningsSummary w={selectedWithdrawal} />
                <p className="mt-2 text-slate-500">Audience is summed channel subscriber counts. Exact source amounts are below.</p>
                {refundDryRun && selectedWithdrawal.status === "rejected" &&
                  <p className="mt-2 rounded bg-amber-50 p-2 text-amber-900">
                    Refund review: {refundDryRun.reason} Restored: {refundDryRun.restored}; outstanding: {refundDryRun.missing ?? "unverified"}.
                    This is a dry run; no balance was changed.
                  </p>}
                {earningsDetailError && <p className="mt-2 text-amber-700">{earningsDetailError}</p>}
                {!earningsDetail && !earningsDetailError && <p className="mt-2 text-slate-500">Loading source detail…</p>}
                {earningsDetail && <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div><strong>Channels</strong>{earningsDetail.channels.map((item) => <p key={item.id}>{item.title || `#${item.id}`}: ${item.earnings}</p>)}</div>
                  <div><strong>Bots</strong>{earningsDetail.bots.map((item) => <p key={item.id}>{item.name || `#${item.id}`}: {item.impressions} impressions · ${item.earnings}</p>)}</div>
                  <div><strong>Mini Apps</strong>{earningsDetail.miniapps.map((item) => <p key={item.id}>{item.name || `#${item.id}`}: {item.impressions} impressions · ${item.earnings}</p>)}</div>
                  <div><strong>Referrals</strong>{earningsDetail.referrals.map((item) => <p key={item.source}>{item.source}: ${item.earnings}</p>)}</div>
                  <p className="text-slate-400 sm:col-span-2">Up to {earningsDetail.limit_per_source} source records per category are shown.</p>
                </div>}
              </div>

              {selectedWithdrawal.verification_evidence ? (
                <>
                  {/* 1. Balance Adequacy */}
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      1. Balance Verification
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500 font-medium">Requested</div>
                        <div className="mt-0.5 font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.amount}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500 font-medium">Available Bal</div>
                        <div className="mt-0.5 font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.balances.available}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500 font-medium">Locked Bal</div>
                        <div className="mt-0.5 font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.balances.locked}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs font-semibold">
                      Sufficient Balance:{" "}
                      <span
                        className={
                          selectedWithdrawal.verification_evidence.balances.is_sufficient
                            ? "text-emerald-600"
                            : "text-red-600"
                        }
                      >
                        {selectedWithdrawal.verification_evidence.balances.is_sufficient ? "Yes (Passed)" : "No (Deficit Detected)"}
                      </span>
                    </div>
                  </div>

                  {/* 2. Earnings Reconciliation */}
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      2. Component Earnings Reconciliation
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Channels</div>
                        <div className="font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.earnings_reconciliation.channel_earnings}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Mini Apps</div>
                        <div className="font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.earnings_reconciliation.miniapp_earnings}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Legacy Ref Payouts</div>
                        <div className="font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.earnings_reconciliation.legacy_referral_earnings}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">10% Commissions</div>
                        <div className="font-bold text-slate-900">
                          ${selectedWithdrawal.verification_evidence.earnings_reconciliation.commission_referral_earnings}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Channel join reward</div>
                        <div className="font-bold text-slate-900">${selectedWithdrawal.verification_evidence.earnings_reconciliation.join_reward_earnings ?? "0.00000000"}</div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Other paid promotions</div>
                        <div className="font-bold text-slate-900">${selectedWithdrawal.verification_evidence.earnings_reconciliation.promotion_earnings ?? "0.00000000"}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                      <span className="font-medium text-slate-600">
                        Source-ledger lifetime earnings: {selectedWithdrawal.verification_evidence.earnings_reconciliation.total_earnings}
                      </span>
                      <span
                        className={`font-bold ${
                          selectedWithdrawal.verification_evidence.earnings_reconciliation.discrepancy_detected
                            ? "text-red-600"
                            : selectedWithdrawal.verification_evidence.earnings_reconciliation.earnings_difference === "0.00000000"
                              ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        {selectedWithdrawal.verification_evidence.earnings_reconciliation.discrepancy_detected
                          ? "Verified ledger discrepancy"
                          : selectedWithdrawal.verification_evidence.earnings_reconciliation.earnings_difference && selectedWithdrawal.verification_evidence.earnings_reconciliation.earnings_difference !== "0.00000000"
                            ? "Historical difference needs review"
                            : "Claimed funds match recorded source earnings"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
                    <div className="mb-2 font-bold uppercase tracking-wider text-slate-500">Lifetime funds comparison</div>
                    <p>Paid withdrawals: <strong>{selectedWithdrawal.verification_evidence.earnings_reconciliation.total_withdrawn}</strong></p>
                    <p>Pending withdrawals within locked balance: <strong>{selectedWithdrawal.verification_evidence.earnings_reconciliation.pending_withdrawals ?? "Unverified"}</strong></p>
                    <p>Available + locked + paid: <strong>{selectedWithdrawal.verification_evidence.earnings_reconciliation.claimed_lifetime_total ?? "Unverified"}</strong></p>
                    <p>Difference from source earnings: <strong>{selectedWithdrawal.verification_evidence.earnings_reconciliation.earnings_difference ?? "Unverified"}</strong></p>
                    {selectedWithdrawal.verification_evidence.earnings_reconciliation.historical_join_reward_candidate && selectedWithdrawal.verification_evidence.earnings_reconciliation.historical_join_reward_candidate !== "0.00000000" && <>
                      <p>Possible older channel-join credit without a ledger row: <strong>{selectedWithdrawal.verification_evidence.earnings_reconciliation.historical_join_reward_candidate}</strong> (not verified or added to earnings)</p>
                      <p>Difference after that candidate: <strong>{selectedWithdrawal.verification_evidence.earnings_reconciliation.difference_after_join_candidate}</strong></p>
                    </>}
                  </div>
                  {selectedWithdrawal.verification_evidence.balance_event_reconciliation && (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                        Ordinary Balance Event Reconciliation
                      </div>
                      <p className="mb-2 text-xs text-slate-700">
                        State: <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.state.replaceAll("_", " ")}</strong>
                        {" · "}Events checked: {selectedWithdrawal.verification_evidence.balance_event_reconciliation.eventCount}
                        {" · "}Unattributed events: {selectedWithdrawal.verification_evidence.balance_event_reconciliation.sourceGaps}
                        {" · "}Read time: {selectedWithdrawal.verification_evidence.balance_event_reconciliation.durationMs} ms
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded bg-slate-50 p-2">
                          <span className="block text-slate-500">Expected available</span>
                          <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.expectedAvailable ?? "Unverified"}</strong>
                        </div>
                        <div className="rounded bg-slate-50 p-2">
                          <span className="block text-slate-500">Stored available</span>
                          <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.actualAvailable}</strong>
                        </div>
                        <div className="rounded bg-slate-50 p-2">
                          <span className="block text-slate-500">Available difference</span>
                          <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.differenceAvailable ?? "Unverified"}</strong>
                        </div>
                        <div className="rounded bg-slate-50 p-2">
                          <span className="block text-slate-500">Expected restricted</span>
                          <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.expectedLocked ?? "Unverified"}</strong>
                        </div>
                        <div className="rounded bg-slate-50 p-2">
                          <span className="block text-slate-500">Stored restricted</span>
                          <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.actualLocked}</strong>
                        </div>
                        <div className="rounded bg-slate-50 p-2">
                          <span className="block text-slate-500">Restricted difference</span>
                          <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.differenceLocked ?? "Unverified"}</strong>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-700">
                        Latest recorded balance: available <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.latestRecordedAvailable ?? "No event"}</strong>,
                        locked <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.latestRecordedLocked ?? "No event"}</strong>.
                        Differences from current balance: available <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.differenceLatestAvailable ?? "Unverified"}</strong>,
                        locked <strong>{selectedWithdrawal.verification_evidence.balance_event_reconciliation.differenceLatestLocked ?? "Unverified"}</strong>.
                      </p>
                      <p className="mt-2 text-xs text-amber-800">
                        Pending withdrawal reservations: {selectedWithdrawal.verification_evidence.balance_event_reconciliation.pendingWithdrawalLiability}.
                        Missing opening history cannot establish lifetime integrity. Protected integrity is not provisioned.
                      </p>
                    </div>
                  )}


                  {/* 3. Historical Referral Quality Rule */}
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      3. Historical Referral Quality (1% for legacy referral earnings)
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Direct Referrals</div>
                        <div className="font-bold text-slate-900">
                          {selectedWithdrawal.verification_evidence.referral_quality.total_direct_referrals}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Distinct referred users who monetized</div>
                        <div className="font-bold text-slate-900">
                          {selectedWithdrawal.verification_evidence.referral_quality.qualifying_referrals}
                        </div>
                      </div>
                      <div className="rounded bg-slate-50 p-2">
                        <div className="text-slate-500">Rule Threshold</div>
                        <div className="font-bold text-slate-900">
                          {selectedWithdrawal.verification_evidence.referral_quality.rule_applied
                            ? `>= ${selectedWithdrawal.verification_evidence.referral_quality.required_count} (1%)`
                            : "Not applicable"}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      {selectedWithdrawal.verification_evidence.referral_quality.reason}
                    </p>
                    {selectedWithdrawal.verification_evidence.upstream_referrer && <div className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-700">
                      <p><strong>Referred by user #{selectedWithdrawal.verification_evidence.upstream_referrer.user_id}</strong> · Incoming referral: {selectedWithdrawal.verification_evidence.upstream_referrer.incoming_referral_status} · Abuse flag: {selectedWithdrawal.verification_evidence.upstream_referrer.incoming_referral_abuse}</p>
                      <p>That referrer linked {selectedWithdrawal.verification_evidence.upstream_referrer.total_direct_referrals} distinct users; {selectedWithdrawal.verification_evidence.upstream_referrer.monetized_referrals} earned monetization revenue.</p>
                      <p>Historical 1% rule: {selectedWithdrawal.verification_evidence.upstream_referrer.rule_applied
                        ? `${selectedWithdrawal.verification_evidence.upstream_referrer.rule_passed ? "met" : "flagged"} (minimum ${selectedWithdrawal.verification_evidence.upstream_referrer.required_count} monetized users)`
                        : "not applicable to that referrer"}. This does not validate this withdrawal's own earnings.</p>
                    </div>}
                  </div>

                  {/* Issues and Suggested Action */}
                  {selectedWithdrawal.verification_evidence.issues?.some((issue) => issue.severity !== "info") && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-amber-800 mb-1">
                        Detected Findings:
                      </div>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
                        {selectedWithdrawal.verification_evidence.issues.filter((issue) => issue.severity !== "info").map((iss, i) => (
                          <li key={i}>{iss.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-900">
                    <span className="font-bold uppercase tracking-wide text-blue-800 block mb-0.5">
                      Suggested Admin Action:
                    </span>
                    {selectedWithdrawal.verification_evidence.suggested_action}
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-slate-500">
                  <p>No verification evidence recorded for this withdrawal yet.</p>
                  <button
                    onClick={() => handleCheck(selectedWithdrawal.id)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                  >
                    Run Verification Check Now
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
              <span className="text-[11px] text-slate-400">
                Manual decision required. System never executes automated payments.
              </span>
              <button
                onClick={() => setDetailsModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Interface */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Withdrawals Fraud Verification</h2>
            <p className="text-xs text-slate-500">
              Evidence-based fraud verification queue with strict manual administrator authorization.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search user, ID, address..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
              {["all", "pending", "success", "rejected"].map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    setPage(1);
                    setStatusFilter(filter);
                  }}
                  className={`rounded px-3 py-1 text-xs font-medium capitalize transition ${
                    statusFilter === filter
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-slate-600 hover:bg-slate-200/50"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Clean, Streamlined Desktop Table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Amount & Network</th>
                <th className="px-4 py-3">Payment Status</th>
                <th className="px-4 py-3">Fraud Verification</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <Loader2 className="mx-auto animate-spin text-blue-600" size={24} />
                  </td>
                </tr>
              ) : withdrawals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500 text-xs">
                    No withdrawals found.
                  </td>
                </tr>
              ) : (
                withdrawals.map((w) => {
                  const fee = Number(w.fee || 0);
                  const net = fee > 0 ? Number(w.net_amount || 0) : Number(w.amount || 0);
                  const isChecking = checkingIds.has(w.id) || w.verification_status === "Checking";
                  const hasEvidence = Boolean(w.verification_evidence);

                  return (
                    <tr key={w.id} className="align-middle hover:bg-slate-50/80 transition">
                      {/* 1. User */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">{displayUsername(w)}</div>
                        <div className="text-xs text-slate-500">
                          #{w.id} · User #{w.user_id}
                          {w.owner_telegram_id ? ` · TG ${w.owner_telegram_id}` : ""}
                        </div>
                        <EarningsSummary w={w} />
                        {Boolean(w.is_banned) && (
                          <span className="mt-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                            Banned
                          </span>
                        )}
                      </td>

                      {/* 2. Amount & Network */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-emerald-700 text-base">{money(net)}</div>
                        <div className="text-[11px] text-slate-500">
                          {w.network || "USDT-TON"}
                          {fee > 0 ? ` (Req. ${money(w.amount)}, Fee -${money(fee)})` : ""}
                        </div>
                        <div className="mt-1">
                          <AddressCell withdrawal={w} />
                        </div>
                      </td>

                      {/* 3. Payment Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(
                            w.status
                          )}`}
                        >
                          {w.status}
                        </span>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Refund: {w.refund_evidence_status === "verified" ? "Ledger verified"
                            : w.refund_evidence_status === "conflicting" ? "Ledger conflict — review"
                            : w.refund_evidence_status === "historical_unverified" ? "Marked returned; older evidence missing"
                            : w.refunded ? "Marked returned; unverified" : "No refund event"}
                        </div>
                        <PayoutState withdrawal={w} />
                      </td>

                      {/* 4. Fraud Verification */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1.5 items-start">
                          <VerificationBadge
                            status={w.verification_status || "Not Checked"}
                            queuePos={w.queue_position}
                          />
                          <span className="max-w-48 text-[10px] leading-tight text-slate-600">{financialAuditAssessment(w)}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCheck(w.id)}
                              disabled={isChecking}
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
                            >
                              {isChecking ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RotateCw size={11} />
                              )}
                              {w.verification_status && w.verification_status !== "Not Checked"
                                ? "Recheck"
                                : "Check"}
                            </button>
                            {(hasEvidence || w.verification_status !== "Not Checked") && (
                              <button
                                onClick={() => {
                                  setSelectedWithdrawal(w);
                                  setDetailsModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-blue-600 transition"
                              >
                                <Eye size={12} />
                                View Details
                              </button>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 5. Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <ActionButtons withdrawal={w} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto animate-spin text-blue-600" size={24} />
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No withdrawals found.</div>
          ) : (
            withdrawals.map((w) => {
              const fee = Number(w.fee || 0);
              const net = fee > 0 ? Number(w.net_amount || 0) : Number(w.amount || 0);
              const isChecking = checkingIds.has(w.id) || w.verification_status === "Checking";

              return (
                <div key={w.id} className="rounded-lg border border-slate-200 p-3 shadow-sm bg-white">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-slate-900">{displayUsername(w)}</div>
                      <div className="text-xs text-slate-500">#{w.id} · User #{w.user_id}</div>
                      <EarningsSummary w={w} />
                    </div>
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(
                        w.status
                      )}`}
                    >
                      {w.status}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-slate-400">Net To Send</div>
                      <div className="font-bold text-emerald-700 text-sm">{money(net)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Network</div>
                      <div className="text-xs font-semibold text-slate-800">{w.network || "USDT-TON"}</div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <AddressCell withdrawal={w} />
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 p-2 border border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <VerificationBadge
                        status={w.verification_status || "Not Checked"}
                        queuePos={w.queue_position}
                      />
                      <span className="text-[10px] text-slate-600">{financialAuditAssessment(w)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCheck(w.id)}
                        disabled={isChecking}
                        className="rounded border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-blue-700"
                      >
                        {isChecking ? "Checking..." : "Check"}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedWithdrawal(w);
                          setDetailsModalOpen(true);
                        }}
                        className="rounded border border-slate-200 bg-white p-1 text-slate-600"
                      >
                        <Eye size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <ActionButtons withdrawal={w} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          <div>
            Page <span className="font-semibold text-slate-900">{page}</span> of{" "}
            <span className="font-semibold text-slate-900">{totalPages}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
