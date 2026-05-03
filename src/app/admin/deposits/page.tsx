"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Eye, X } from "lucide-react";
import Modal from "@/components/ui/Modal";

export default function AdminDepositsPage() {
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");

  // View Modal State
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedDeposit, setSelectedDeposit] = useState<any>(null);

  const fetchDeposits = async (p: number, s: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/deposits?page=${p}&limit=10&status=${s}`);
      const data = await res.json();
      setDeposits(data.deposits);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch deposits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeposits(page, statusFilter);
  }, [page, statusFilter]);

  const openViewModal = (deposit: any) => {
    setSelectedDeposit(deposit);
    setViewModalOpen(true);
  };

  const getStatusStyle = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'paid' || s === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'waiting' || s === 'pending') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>

      {/* View Deposit Modal */}
      {viewModalOpen && selectedDeposit && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Deposit Details (#{selectedDeposit.id})</h3>
              <button onClick={() => setViewModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* User Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">User Profile</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{selectedDeposit.first_name} {selectedDeposit.last_name}</span></div>
                    <div><span className="text-slate-500">Username:</span> <span className="font-medium text-slate-900">@{selectedDeposit.owner_username || "N/A"}</span></div>
                    <div><span className="text-slate-500">User ID:</span> <span className="font-medium text-slate-900">{selectedDeposit.user_id}</span></div>
                    <div><span className="text-slate-500">Telegram ID:</span> <span className="font-medium text-slate-900">{selectedDeposit.telegram_id}</span></div>
                  </div>
                </div>
              </div>

              {/* Deposit Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Transaction Information</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div><span className="text-slate-500">Amount:</span> <span className="font-medium text-slate-900">${selectedDeposit.amount}</span></div>
                    <div><span className="text-slate-500">Pay Amount:</span> <span className="font-medium text-slate-900">{selectedDeposit.pay_amount} {selectedDeposit.pay_currency}</span></div>
                    <div><span className="text-slate-500">Track ID:</span> <span className="font-medium text-slate-900">{selectedDeposit.track_id || "N/A"}</span></div>
                    <div><span className="text-slate-500">Order ID:</span> <span className="font-medium text-slate-900">{selectedDeposit.order_id || "N/A"}</span></div>
                    <div><span className="text-slate-500">Network:</span> <span className="font-medium text-slate-900">{selectedDeposit.network || "N/A"}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className={`font-medium capitalize ${getStatusStyle(selectedDeposit.status).replace('bg-', 'text-').replace('50', '600').split(' ')[1]}`}>{selectedDeposit.status}</span></div>

                    {selectedDeposit.txn_id && (
                      <div className="col-span-2">
                        <span className="text-slate-500 block mb-1">Transaction ID (TXN):</span>
                        <div className="bg-white p-2 border border-slate-200 rounded font-mono break-all">{selectedDeposit.txn_id}</div>
                      </div>
                    )}

                    {selectedDeposit.address && (
                      <div className="col-span-2">
                        <span className="text-slate-500 block mb-1">Payment Address:</span>
                        <div className="bg-white p-2 border border-slate-200 rounded font-mono break-all">{selectedDeposit.address}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Deposits</h2>
          <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200/50">
            {["all", "pending", "paid", "cancelled"].map(f => (
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
                <th className="px-4 py-3 font-medium">ID & User</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : deposits.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No deposits found.</td></tr>
              ) : (
                deposits.map((deposit: any) => (
                  <tr key={deposit.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">ID: #{deposit.id}</div>
                      <div className="text-xs text-slate-500">User ID: {deposit.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">${deposit.amount}</div>
                      <div className="text-xs text-slate-500">{deposit.pay_amount} {deposit.pay_currency}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-700">Track ID: {deposit.track_id || "N/A"}</div>
                      <div className="text-xs text-slate-500">{deposit.network || "N/A"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize border ${getStatusStyle(deposit.status)}`}>
                        {deposit.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openViewModal(deposit)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer inline-flex items-center"
                        title="View Details"
                      >
                        <Eye size={16} />
                      </button>
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
