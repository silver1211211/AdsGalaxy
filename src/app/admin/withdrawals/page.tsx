"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Modal from "@/components/ui/Modal";
import { Ban, Check, ChevronLeft, ChevronRight, Copy, Eye, Loader2, Search, X } from "lucide-react";

type ActionType = "approve" | "reject" | "ban_user";
type WithdrawalRow = {
  id: number;
  user_id: number;
  amount: string | number;
  fee?: string | number;
  net_amount?: string | number;
  status: string;
  refunded?: boolean | number;
  paid_out?: boolean | number;
  paid_at?: string | null;
  address?: string | null;
  network?: string | null;
  owner_username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  owner_telegram_id?: string | number | null;
  is_banned?: boolean | number;
  channel_count?: string | number;
  total_audience?: string | number;
  total_withdrawal_amount?: string | number;
  withdrawal_count?: string | number;
  total_earnings?: string | number;
  miniapp_count?: string | number;
  miniapp_impressions?: string | number;
  miniapp_earnings?: string | number;
  balance_locked?: string | number;
  balance_available?: string | number;
};
type ActionModal = { type: ActionType; withdrawal: WithdrawalRow } | null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compact(value: unknown) {
  return Number(value || 0).toLocaleString();
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

function FraudMetrics({ withdrawal, dense = false }: { withdrawal: WithdrawalRow; dense?: boolean }) {
  const items = [
    ["Total Earnings", money(withdrawal.total_earnings)],
    ["Locked", money(withdrawal.balance_locked)],
    ["Available", money(withdrawal.balance_available)],
    ["Withdrawn", money(withdrawal.total_withdrawal_amount)],
    ["Requests", compact(withdrawal.withdrawal_count)],
    ["Channels", compact(withdrawal.channel_count)],
    ["Audience", compact(withdrawal.total_audience)],
    ["Mini Apps", compact(withdrawal.miniapp_count)],
    ["Mini App Impressions", compact(withdrawal.miniapp_impressions)],
    ["Mini App Earnings", money(withdrawal.miniapp_earnings)],
  ];

  return (
    <div className={`grid ${dense ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-4"} gap-2`}>
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
          <div className="text-xs font-semibold text-slate-900">{value}</div>
        </div>
      ))}
    </div>
  );
}

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(true);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRow | null>(null);

  const fetchWithdrawals = async (p: number, s: string, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/withdrawals?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to fetch withdrawals");
      setWithdrawals(data.withdrawals || []);
      setTotalPages(data.totalPages || 1);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to fetch withdrawals"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchWithdrawals(page, statusFilter, search);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [page, statusFilter, search]);

  const openAction = (type: ActionType, withdrawal: WithdrawalRow) => {
    setActionModal({ type, withdrawal });
    setReason("");
    setRefund(type === "reject" && withdrawal.status !== "success" && !withdrawal.refunded);
  };

  const closeAction = () => {
    setActionModal(null);
    setReason("");
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
        body: JSON.stringify({ id: withdrawal.id, action: type, reason, refund }),
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
    <div className="flex min-w-0 items-center gap-2">
      <code className="max-w-[220px] truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-700" title={withdrawal.address || "No address"}>
        {withdrawal.address || "No address"}
      </code>
      <button
        onClick={() => copyAddress(withdrawal)}
        disabled={!withdrawal.address}
        className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        title="Copy full address"
      >
        <Copy size={14} />
      </button>
      {copiedId === withdrawal.id && <span className="text-[10px] font-semibold text-emerald-600">Copied</span>}
    </div>
  );

  const ActionButtons = ({ withdrawal }: { withdrawal: WithdrawalRow }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button onClick={() => { setSelectedWithdrawal(withdrawal); setViewModalOpen(true); }} className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="View details">
        <Eye size={16} />
      </button>
      <button onClick={() => openAction("approve", withdrawal)} disabled={actionLoading === withdrawal.id} className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
        {actionLoading === withdrawal.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
      </button>
      <button onClick={() => openAction("reject", withdrawal)} disabled={actionLoading === withdrawal.id} className="inline-flex items-center gap-1 rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
        {actionLoading === withdrawal.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Reject
      </button>
      <button onClick={() => openAction("ban_user", withdrawal)} disabled={actionLoading === withdrawal.id || Boolean(withdrawal.is_banned)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-900 px-2 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
        <Ban size={14} /> {withdrawal.is_banned ? "Banned" : "Ban User"}
      </button>
    </div>
  );

  const actionTitle = actionModal?.type === "approve" ? "Approve Withdrawal" : actionModal?.type === "reject" ? "Reject Withdrawal" : "Ban User";
  const actionMessage = actionModal ? `${displayUsername(actionModal.withdrawal)} - ${money(actionModal.withdrawal.amount)} - Withdrawal #${actionModal.withdrawal.id}` : "";

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>

      <ConfirmationModal
        isOpen={!!actionModal}
        onClose={closeAction}
        onConfirm={runAction}
        title={actionTitle}
        message={actionMessage}
        confirmBtnText={actionModal?.type === "approve" ? "Approve" : actionModal?.type === "reject" ? "Reject" : "Ban User"}
        confirmBtnVariant={actionModal?.type === "approve" ? "primary" : "danger"}
        isLoading={actionLoading !== null}
      >
        {actionModal?.type !== "approve" && (
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              {actionModal?.type === "ban_user" ? "Ban reason" : "Reject reason"}
            </label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-blue-500" placeholder="Write a short admin note..." />
          </div>
        )}

        {actionModal?.type === "reject" && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} disabled={actionModal.withdrawal.status === "success" || Boolean(actionModal.withdrawal.refunded)} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
              Refund locked funds to available balance
            </label>
            <p className="mt-2 text-xs text-slate-500">
              Approved withdrawals are treated as paid corrections and are not auto-refunded. Already refunded withdrawals cannot be refunded twice.
            </p>
          </div>
        )}

        {actionModal?.type === "approve" && actionModal.withdrawal.refunded && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            This withdrawal was refunded before. Approving it will deduct the amount from available balance once before marking it paid.
          </p>
        )}
      </ConfirmationModal>

      {viewModalOpen && selectedWithdrawal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-bold text-slate-900">Withdrawal #{selectedWithdrawal.id}</h3>
              <button onClick={() => setViewModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="space-y-5 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">User</div>
                  <div className="mt-1 font-semibold text-slate-900">{displayUsername(selectedWithdrawal)}</div>
                  <div className="text-xs text-slate-500">User #{selectedWithdrawal.user_id} - TG {selectedWithdrawal.owner_telegram_id || "N/A"}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Status</div>
                  <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(selectedWithdrawal.status)}`}>{selectedWithdrawal.status}</span>
                  <div className="mt-1 text-xs text-slate-500">Refunded: {selectedWithdrawal.refunded ? "Yes" : "No"}</div>
                  <PayoutState withdrawal={selectedWithdrawal} />
                </div>
              </div>
              {/* Fee breakdown */}
              {(() => {
                const fee = Number(selectedWithdrawal.fee || 0);
                const net = fee > 0 ? Number(selectedWithdrawal.net_amount || 0) : Number(selectedWithdrawal.amount || 0);
                return (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                    <div className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-2">Payment to Send</div>
                    <div className="flex justify-between text-xs font-semibold text-slate-600">
                      <span>Requested</span><span>{money(selectedWithdrawal.amount)}</span>
                    </div>
                    {fee > 0 && (
                      <div className="flex justify-between text-xs font-semibold text-amber-600">
                        <span>Network fee ({selectedWithdrawal.network})</span><span>-{money(fee)}</span>
                      </div>
                    )}
                    <div className="border-t border-emerald-200 pt-1 flex justify-between text-sm font-black text-emerald-700">
                      <span>Send to user</span><span>{money(net)}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Full address</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-slate-50 p-2 text-xs text-slate-700">{selectedWithdrawal.address || "No address"}</code>
                  <button onClick={() => copyAddress(selectedWithdrawal)} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:text-blue-600"><Copy size={16} /></button>
                </div>
              </div>
              <FraudMetrics withdrawal={selectedWithdrawal} />
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Withdrawals Fraud Review</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search username, address, ID..." className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-10 pr-4 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex rounded-md border border-slate-200/50 bg-slate-100 p-0.5">
              {["all", "pending", "success", "rejected"].map((filter) => (
                <button key={filter} onClick={() => { setPage(1); setStatusFilter(filter); }} className={`flex-1 rounded px-3 py-1.5 text-xs font-medium capitalize ${statusFilter === filter ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}>
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Amount & Network</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Fraud Review</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></td></tr>
              ) : withdrawals.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">No withdrawals found.</td></tr>
              ) : withdrawals.map((withdrawal) => (
                <tr key={withdrawal.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{displayUsername(withdrawal)}</div>
                    <div className="text-xs text-slate-500">Withdrawal #{withdrawal.id} - User #{withdrawal.user_id}</div>
                    {Boolean(withdrawal.is_banned) && <div className="mt-1 text-xs font-semibold text-red-600">User banned</div>}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const fee = Number(withdrawal.fee || 0);
                      const net = fee > 0 ? Number(withdrawal.net_amount || 0) : Number(withdrawal.amount || 0);
                      return (
                        <>
                          <div className="font-bold text-emerald-700 text-base">{money(net)}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase">To process</div>
                          {fee > 0 && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              Requested {money(withdrawal.amount)} · fee -{money(fee)}
                            </div>
                          )}
                          <div className="text-xs text-slate-500 mt-0.5">{withdrawal.network || "Network N/A"}</div>
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3"><AddressCell withdrawal={withdrawal} /></td>
                  <td className="px-4 py-3"><FraudMetrics withdrawal={withdrawal} /></td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(withdrawal.status)}`}>{withdrawal.status}</span>
                    <div className="mt-1 text-[10px] text-slate-500">Refunded: {withdrawal.refunded ? "Yes" : "No"}</div>
                    <PayoutState withdrawal={withdrawal} />
                  </td>
                  <td className="px-4 py-3 text-right"><ActionButtons withdrawal={withdrawal} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></div>
          ) : withdrawals.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No withdrawals found.</div>
          ) : withdrawals.map((withdrawal) => (
            <div key={withdrawal.id} className="rounded-lg border border-slate-200 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{displayUsername(withdrawal)}</div>
                  <div className="text-xs text-slate-500">Withdrawal #{withdrawal.id} - User #{withdrawal.user_id}</div>
                </div>
                <span className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(withdrawal.status)}`}>{withdrawal.status}</span>
              </div>
              <PayoutState withdrawal={withdrawal} />
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">To Process</div>
                  <div className="font-bold text-emerald-700">
                    {money(Number(withdrawal.fee || 0) > 0 ? withdrawal.net_amount : withdrawal.amount)}
                  </div>
                  {Number(withdrawal.fee || 0) > 0 && (
                    <div className="text-[10px] text-slate-400">Req. {money(withdrawal.amount)} · fee -{money(withdrawal.fee)}</div>
                  )}
                </div>
                <div><div className="text-[10px] font-bold uppercase text-slate-400">Network</div><div className="font-semibold">{withdrawal.network || "N/A"}</div></div>
              </div>
              <div className="mt-3"><AddressCell withdrawal={withdrawal} /></div>
              <div className="mt-3"><FraudMetrics withdrawal={withdrawal} dense /></div>
              <div className="mt-3"><ActionButtons withdrawal={withdrawal} /></div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><ChevronLeft size={16} /></button>
            <button disabled={page === totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
