"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Check, X, Eye, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");
  
  // Reject Modal State
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [refund, setRefund] = useState(true);

  // View Modal State
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any>(null);

  const fetchWithdrawals = async (p: number, s: string, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/withdrawals?page=${p}&limit=10&status=${s}&search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setWithdrawals(data.withdrawals);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchWithdrawals(page, statusFilter, search);
    }, 500);
    return () => clearTimeout(timer);
  }, [page, statusFilter, search]);

  const handleApprove = async (id: number) => {
    setActionLoading(id);
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "approve" })
      });
      if (!res.ok) throw new Error("Action failed");
      await fetchWithdrawals(page, statusFilter, search);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectingId) return;
    setActionLoading(rejectingId);
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rejectingId, action: "reject", reason: rejectReason, refund })
      });
      if (!res.ok) throw new Error("Action failed");
      
      setRejectModalOpen(false);
      setRejectReason("");
      setRefund(true);
      await fetchWithdrawals(page, statusFilter, search);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
      setRejectingId(null);
    }
  };

  const openViewModal = (withdrawal: any) => {
    setSelectedWithdrawal(withdrawal);
    setViewModalOpen(true);
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>

      {/* Reject Modal */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Withdrawal</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
                <textarea 
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500"
                  rows={3}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Enter rejection reason..."
                />
              </div>
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  id="refund" 
                  checked={refund} 
                  onChange={e => setRefund(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="refund" className="text-sm font-medium text-slate-700 cursor-pointer">Refund to user balance</label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setRejectModalOpen(false)}
                className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleRejectSubmit}
                disabled={actionLoading !== null}
                className="flex-1 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Withdrawal Modal */}
      {viewModalOpen && selectedWithdrawal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Withdrawal Details (#{selectedWithdrawal.id})</h3>
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
                    <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{selectedWithdrawal.first_name} {selectedWithdrawal.last_name}</span></div>
                    <div><span className="text-slate-500">Username:</span> <span className="font-medium text-slate-900">@{selectedWithdrawal.owner_username || "N/A"}</span></div>
                    <div><span className="text-slate-500">User ID:</span> <span className="font-medium text-slate-900">{selectedWithdrawal.user_id}</span></div>
                    <div><span className="text-slate-500">Telegram ID:</span> <span className="font-medium text-slate-900">{selectedWithdrawal.telegram_id}</span></div>
                  </div>
                </div>
              </div>

              {/* Withdrawal Info */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Transaction Information</h4>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div><span className="text-slate-500">Amount:</span> <span className="font-medium text-slate-900">${selectedWithdrawal.amount}</span></div>
                    <div><span className="text-slate-500">Network:</span> <span className="font-medium text-slate-900">{selectedWithdrawal.network}</span></div>
                    <div className="col-span-2">
                      <span className="text-slate-500 block mb-1">Destination Address:</span>
                      <div className="bg-white p-2 border border-slate-200 rounded font-mono break-all">{selectedWithdrawal.address}</div>
                    </div>
                    <div><span className="text-slate-500">Status:</span> <span className={`font-medium capitalize ${selectedWithdrawal.status === 'success' ? 'text-emerald-600' : selectedWithdrawal.status === 'pending' ? 'text-amber-600' : 'text-red-600'}`}>{selectedWithdrawal.status}</span></div>
                    
                    {selectedWithdrawal.status === 'rejected' && (
                      <>
                        <div><span className="text-slate-500">Refunded:</span> <span className="font-medium text-slate-900">{selectedWithdrawal.refunded ? 'Yes' : 'No'}</span></div>
                        <div className="col-span-2">
                          <span className="text-slate-500 block mb-1">Reject Reason:</span>
                          <div className="bg-white p-2 border border-slate-200 rounded">{selectedWithdrawal.reject_reason || "No reason provided."}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Withdrawals</h2>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder="Search withdrawals, users..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200/50 w-full sm:w-auto">
              {["all", "pending", "success", "rejected"].map(f => (
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
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">ID & User</th>
                <th className="px-4 py-3 font-medium">Amount & Network</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : withdrawals.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No withdrawals found.</td></tr>
              ) : (
                withdrawals.map((withdrawal: any) => (
                  <tr key={withdrawal.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">ID: #{withdrawal.id}</div>
                      <div className="text-xs text-slate-500">User ID: {withdrawal.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">${withdrawal.amount}</div>
                      <div className="text-xs text-slate-500">{withdrawal.network}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-700 truncate max-w-[200px]" title={withdrawal.address}>{withdrawal.address}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${withdrawal.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : withdrawal.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                          {withdrawal.status}
                        </span>
                        {withdrawal.status === 'rejected' && (
                          <span className="text-[10px] text-slate-500">
                            Refunded: {withdrawal.refunded ? 'Yes' : 'No'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => openViewModal(withdrawal)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          title="View Details"
                        >
                          <Eye size={16} />
                        </button>
                        {withdrawal.status === "pending" && (
                          <>
                            <button 
                              onClick={() => handleApprove(withdrawal.id)}
                              disabled={actionLoading === withdrawal.id}
                              className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Approve & Mark Paid"
                            >
                              {actionLoading === withdrawal.id ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />}
                            </button>
                            <button 
                              onClick={() => { setRejectingId(withdrawal.id); setRejectModalOpen(true); }}
                              disabled={actionLoading === withdrawal.id}
                              className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors border border-red-100 cursor-pointer disabled:cursor-not-allowed"
                              title="Reject"
                            >
                              <X size={16} />
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
