"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Modal from "@/components/ui/Modal";
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Edit2, ExternalLink, Loader2, Search, ShieldOff } from "lucide-react";

type UserRow = {
  id: number;
  telegram_id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
  balance_locked: string | number;
  balance_available: string | number;
  ad_balance: string | number;
  created_at?: string;
  status?: "active" | "banned" | string;
  is_banned?: boolean | number;
  banned_at?: string | null;
  ban_reason?: string | null;
  advertiser_trust_level?: string;
  publisher_trust_score?: string | number;
  publisher_risk_score?: string | number;
  advertiser_trust_note?: string | null;
  advertiser_total_campaigns?: string | number;
  advertiser_approved_campaigns?: string | number;
  advertiser_rejected_campaigns?: string | number;
  advertiser_total_spend?: string | number;
};

type UserAction = {
  type: "ban" | "unban";
  user: UserRow;
} | null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayUsername(user: UserRow) {
  return user.username ? `@${user.username}` : "No Username";
}

function userTelegramUrl(user: UserRow) {
  const cleaned = String(user.username || "").trim().replace(/^@/, "");
  return cleaned ? `https://t.me/${cleaned}` : "";
}

function displayName(user: UserRow) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || `User #${user.id}`;
}

function isUserBanned(user: UserRow) {
  return user.status === "banned" || Boolean(user.is_banned);
}

function StatusBadge({ user }: { user: UserRow }) {
  const banned = isUserBanned(user);
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize ${
      banned ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
    }`}>
      {banned ? "Banned" : "Active"}
    </span>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [trustFilter, setTrustFilter] = useState("all");
  const [error, setError] = useState("");

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [balanceData, setBalanceData] = useState({ locked: "", available: "", ad: "" });
  const [isUpdating, setIsUpdating] = useState(false);
  const [userAction, setUserAction] = useState<UserAction>(null);
  const [banReason, setBanReason] = useState("");

  const fetchUsers = async (p: number, q: string, trust = trustFilter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?page=${p}&limit=10&search=${encodeURIComponent(q)}&trust=${encodeURIComponent(trust)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to fetch users");
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to fetch users"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchUsers(page, searchQuery, trustFilter);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [page, searchQuery, trustFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(1);
  };

  const openEditModal = (user: UserRow) => {
    setEditingUser(user);
    setBalanceData({
      locked: String(user.balance_locked ?? ""),
      available: String(user.balance_available ?? ""),
      ad: String(user.ad_balance ?? ""),
    });
    setEditModalOpen(true);
  };

  const handleUpdateBalance = async () => {
    if (!editingUser) return;
    setIsUpdating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingUser.id,
          balance_locked: balanceData.locked,
          balance_available: balanceData.available,
          ad_balance: balanceData.ad,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      setEditModalOpen(false);
      await fetchUsers(page, searchQuery);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to update user"));
    } finally {
      setIsUpdating(false);
    }
  };

  const openUserAction = (type: "ban" | "unban", user: UserRow) => {
    setUserAction({ type, user });
    setBanReason("");
  };

  const runUserAction = async () => {
    if (!userAction) return;
    setIsUpdating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userAction.user.id,
          action: userAction.type,
          reason: banReason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update user status");
      setUserAction(null);
      await fetchUsers(page, searchQuery);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to update user status"));
    } finally {
      setIsUpdating(false);
    }
  };

  const setAdvertiserTrust = async (user: UserRow, level: string) => {
    setIsUpdating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          action: "set_advertiser_trust",
          trust_level: level,
          reason: `Admin set advertiser trust to ${level}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update advertiser trust");
      await fetchUsers(page, searchQuery, trustFilter);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to update advertiser trust"));
    } finally {
      setIsUpdating(false);
    }
  };

  const ActionButtons = ({ user }: { user: UserRow }) => {
    const banned = isUserBanned(user);
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => openEditModal(user)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          title="Edit balances"
        >
          <Edit2 size={14} /> Edit
        </button>
        {banned ? (
          <button
            onClick={() => openUserAction("unban", user)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <CheckCircle2 size={14} /> Unban User
          </button>
        ) : (
          <button
            onClick={() => openUserAction("ban", user)}
            className="inline-flex items-center gap-1 rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            <Ban size={14} /> Ban User
          </button>
        )}
        <select
          value={user.advertiser_trust_level || "new"}
          onChange={(event) => setAdvertiserTrust(user, event.target.value)}
          disabled={isUpdating}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50"
          title="Advertiser Trust Level"
        >
          <option value="new">New</option>
          <option value="normal">Normal</option>
          <option value="trusted">Trusted</option>
          <option value="premium">Premium</option>
          <option value="restricted">Restricted</option>
        </select>
      </div>
    );
  };

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>

      <ConfirmationModal
        isOpen={!!userAction}
        onClose={() => setUserAction(null)}
        onConfirm={runUserAction}
        title={userAction?.type === "ban" ? "Ban User" : "Unban User"}
        message={userAction ? `${displayUsername(userAction.user)} (${displayName(userAction.user)}) will ${userAction.type === "ban" ? "lose access to all Mini App authenticated pages." : "regain normal Mini App access."}` : ""}
        confirmBtnText={userAction?.type === "ban" ? "Ban User" : "Unban User"}
        confirmBtnVariant={userAction?.type === "ban" ? "danger" : "primary"}
        isLoading={isUpdating}
      >
        {userAction?.type === "ban" && (
          <div className="space-y-2">
            <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Ban reason</label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-blue-500"
              placeholder="Optional admin note..."
            />
          </div>
        )}
      </ConfirmationModal>

      {editModalOpen && editingUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-slate-900">Edit Balances</h3>
            <p className="mb-4 text-xs text-slate-500">{displayUsername(editingUser)} - User #{editingUser.id}</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Locked Balance</label>
                <input type="number" step="0.01" value={balanceData.locked} onChange={(e) => setBalanceData({ ...balanceData, locked: e.target.value })} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Available Balance</label>
                <input type="number" step="0.01" value={balanceData.available} onChange={(e) => setBalanceData({ ...balanceData, available: e.target.value })} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Ad Balance</label>
                <input type="number" step="0.01" value={balanceData.ad} onChange={(e) => setBalanceData({ ...balanceData, ad: e.target.value })} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setEditModalOpen(false)} className="flex-1 rounded-md border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleUpdateBalance} disabled={isUpdating} className="flex-1 rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {isUpdating ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Users Directory</h2>
            <p className="text-xs text-slate-500">Manage balances, account status, and trust.</p>
          </div>
          <form onSubmit={handleSearch} className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search username, TG ID, name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </form>
          <select
            value={trustFilter}
            onChange={(event) => { setTrustFilter(event.target.value); setPage(1); }}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            <option value="all">All Trust Levels</option>
            <option value="new">New</option>
            <option value="normal">Normal</option>
            <option value="trusted">Trusted</option>
            <option value="premium">Premium</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Profile</th>
                <th className="px-4 py-3 text-right font-medium">Locked</th>
                <th className="px-4 py-3 text-right font-medium">Available</th>
                <th className="px-4 py-3 text-right font-medium">Ad Balance</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Advertiser Trust</th>
                <th className="px-4 py-3 font-medium">Publisher Trust</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={9} className="p-8 text-center text-slate-500">No users found.</td></tr>
              ) : users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">
                      {userTelegramUrl(user) ? (
                        <a
                          href={userTelegramUrl(user)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 hover:underline"
                        >
                          {displayUsername(user)}<ExternalLink size={11} />
                        </a>
                      ) : (
                        displayUsername(user)
                      )}
                    </div>
                    <div className="text-xs text-slate-500">User #{user.id} - TG {user.telegram_id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{displayName(user)}</div>
                    <div className="text-xs text-slate-500">{user.created_at ? new Date(user.created_at).toLocaleDateString() : "Joined date N/A"}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(user.balance_locked)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(user.balance_available)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(user.ad_balance)}</td>
                  <td className="px-4 py-3"><StatusBadge user={user} /></td>
                  <td className="px-4 py-3">
                    <div className="font-semibold capitalize text-slate-900">{(user.advertiser_trust_level || "new").replace(/_/g, " ")}</div>
                    <div className="text-xs text-slate-500">Spend {money(user.advertiser_total_spend)} · {user.advertiser_approved_campaigns || 0}/{user.advertiser_total_campaigns || 0} approved</div>
                    <div className="text-xs text-red-500">{user.advertiser_rejected_campaigns || 0} rejected</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{Number(user.publisher_trust_score ?? 60).toFixed(1)}</div>
                    <div className="text-xs text-slate-500">Risk {Number(user.publisher_risk_score ?? 0).toFixed(1)}</div>
                  </td>
                  <td className="px-4 py-3 text-right"><ActionButtons user={user} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No users found.</div>
          ) : users.map((user) => (
            <div key={user.id} className="rounded-lg border border-slate-200 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-900">
                    {userTelegramUrl(user) ? (
                      <a
                        href={userTelegramUrl(user)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        {displayUsername(user)}<ExternalLink size={11} />
                      </a>
                    ) : (
                      displayUsername(user)
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{displayName(user)}</div>
                  <div className="text-xs text-slate-400">User #{user.id} - TG {user.telegram_id}</div>
                </div>
                <StatusBadge user={user} />
              </div>
              {isUserBanned(user) && user.ban_reason && (
                <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-2 text-xs text-red-700">
                  <ShieldOff className="mr-1 inline" size={13} /> {user.ban_reason}
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Locked</div><div className="font-semibold text-slate-900">{money(user.balance_locked)}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Available</div><div className="font-semibold text-slate-900">{money(user.balance_available)}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Ads</div><div className="font-semibold text-slate-900">{money(user.ad_balance)}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Publisher trust</div><div className="font-semibold text-slate-900">{Number(user.publisher_trust_score ?? 60).toFixed(1)}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Advertiser trust</div><div className="font-semibold capitalize text-slate-900">{user.advertiser_trust_level || "new"}</div></div>
              </div>
              <div className="mt-3"><ActionButtons user={user} /></div>
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
