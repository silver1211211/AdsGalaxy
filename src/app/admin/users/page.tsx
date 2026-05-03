"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Edit2 } from "lucide-react";
import Modal from "@/components/ui/Modal";

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [balanceData, setBalanceData] = useState({ locked: "", available: "", ad: "" });
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchUsers = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?page=${p}&limit=10`);
      const data = await res.json();
      setUsers(data.users);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(page);
  }, [page]);

  const openEditModal = (user: any) => {
    setEditingUser(user);
    setBalanceData({
      locked: user.balance_locked,
      available: user.balance_available,
      ad: user.ad_balance
    });
    setEditModalOpen(true);
  };

  const handleUpdateBalance = async () => {
    setIsUpdating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingUser.id,
          balance_locked: balanceData.locked,
          balance_available: balanceData.available,
          ad_balance: balanceData.ad
        })
      });
      if (res.ok) {
        setEditModalOpen(false);
        fetchUsers(page);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <AdminLayout>
      {/* Edit Balance Modal */}
      {editModalOpen && editingUser && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Balances (User #{editingUser.id})</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Locked Balance</label>
                <input type="number" step="0.01" value={balanceData.locked} onChange={e => setBalanceData({...balanceData, locked: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Available Balance</label>
                <input type="number" step="0.01" value={balanceData.available} onChange={e => setBalanceData({...balanceData, available: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ad Balance</label>
                <input type="number" step="0.01" value={balanceData.ad} onChange={e => setBalanceData({...balanceData, ad: e.target.value})} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditModalOpen(false)} className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={handleUpdateBalance} disabled={isUpdating} className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {isUpdating ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Users Directory</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">User ID</th>
                <th className="px-4 py-3 font-medium">Profile</th>
                <th className="px-4 py-3 font-medium text-right">Locked</th>
                <th className="px-4 py-3 font-medium text-right">Available</th>
                <th className="px-4 py-3 font-medium text-right">Ad Balance</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={20} /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">No users found.</td></tr>
              ) : (
                users.map((user: any) => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {user.id}
                      <span className="block text-xs text-slate-400 font-normal">TG: {user.telegram_id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{user.first_name} {user.last_name}</div>
                      <div className="text-xs text-slate-500">@{user.username || "N/A"}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">${user.balance_locked}</td>
                    <td className="px-4 py-3 text-right text-slate-700">${user.balance_available}</td>
                    <td className="px-4 py-3 text-right text-slate-700">${user.ad_balance}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openEditModal(user)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Edit Balances">
                        <Edit2 size={16} />
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
            <button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50"><ChevronLeft size={16} /></button>
            <button disabled={page === totalPages || loading} onClick={() => setPage(p => p + 1)} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
