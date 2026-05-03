"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, ChevronLeft, ChevronRight, Search, AlertTriangle, X, ShieldAlert } from "lucide-react";

export default function AdminAuditsPage() {
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [postIdSearch, setPostIdSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Invalidate Modal State
  const [invalidateModalOpen, setInvalidateModalOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);

  const fetchAudits = async (p: number, search: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/audits", window.location.origin);
      url.searchParams.set("page", p.toString());
      url.searchParams.set("limit", "10");
      if (search) url.searchParams.set("post_id", search);

      const res = await fetch(url.toString());
      const data = await res.json();
      setAudits(data.audits || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch audits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudits(page, postIdSearch);
  }, [page, postIdSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setPostIdSearch(searchInput);
  };

  const handleInvalidateSubmit = async () => {
    if (!selectedPostId) return;
    setActionLoading(selectedPostId);
    try {
      const res = await fetch("/api/admin/audits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: selectedPostId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      setInvalidateModalOpen(false);
      await fetchAudits(page, postIdSearch);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
      setSelectedPostId(null);
    }
  };

  const confirmInvalidate = (postId: number) => {
    setSelectedPostId(postId);
    setInvalidateModalOpen(true);
  };

  return (
    <AdminLayout>
      {/* Cloudflare Style Error Modal */}
      {error && (
        <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-lg w-full max-w-md shadow-2xl border border-red-200 overflow-hidden">
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center gap-3">
              <ShieldAlert className="text-red-600" size={24} />
              <h3 className="font-bold text-red-900 text-lg">Action Not Permitted</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-700 text-sm leading-relaxed mb-6">
                {error}
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setError("")}
                  className="px-5 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invalidate Warning Modal */}
      {invalidateModalOpen && selectedPostId && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl border border-slate-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">Invalidate Views</h3>
            </div>

            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              Are you sure you want to invalidate all views for post <strong>#{selectedPostId}</strong>?
              <br /><br />
              All views of this post will be marked as invalid. The locked balance will be deducted from the publisher and the amount will be fully refunded to the advertiser's campaign budget. Both users will receive a notification.
              <br /><br />
              <strong className="text-slate-900">This action cannot be undone.</strong>
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setInvalidateModalOpen(false)}
                className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleInvalidateSubmit}
                disabled={actionLoading !== null}
                className="flex-1 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading === selectedPostId ? "Invalidating..." : "Confirm Invalidation"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-100px)]">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-4 shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">Views Audit</h2>

          <form onSubmit={handleSearch} className="flex items-center relative w-full sm:w-auto">
            <Search className="absolute left-3 text-slate-400" size={16} />
            <input
              type="number"
              placeholder="Search Post ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-4 py-1.5 w-full sm:w-64 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); setPostIdSearch(""); }}
                className="absolute right-3 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </form>
        </div>

        <div className="overflow-y-auto flex-1 p-4 bg-slate-50/50 space-y-6">
          {loading ? (
            <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" size={24} /></div>
          ) : audits.length === 0 ? (
            <div className="text-center p-12 text-slate-500 text-sm">No audits found.</div>
          ) : (
            audits.map((group: any) => {
              const isDisabledActive = group.post_status === 'active';
              const isDisabledUnlocked = group.has_unlocked;
              const isClicks = group.campaign_type === 'clicks';
              const noSettlement = !group.has_settlement;
              const hasInvalidRecord = group.records.some((r: any) => r.status === 'invalid');

              let errorMessage = "";
              if (isClicks) {
                errorMessage = "Invalidation isn’t possible because this is a view audit portal, and the post you’re trying to invalidate is a click-based post. Clicks don’t require auditing, as each click is verified and filtered automatically in real time.";
              } else if (noSettlement) {
                errorMessage = "Invalidation isn’t possible because the campaign hasn’t had any settlement yet. Both the publisher and advertiser are safe—no payment has been made to the publisher, and no amount has been deducted from the advertiser.";
              } else if (isDisabledActive) {
                errorMessage = "Invalidation isn’t possible right now because the post is still active on the channel. Doing so could affect future view auditing—please wait until the post is complete.";
              } else if (isDisabledUnlocked) {
                errorMessage = "The balance has already been released since more than a month has passed. Once funds move out of the locked balance, invalidation is no longer possible.";
              }

              const handleInvalidateClick = () => {
                if (errorMessage) {
                  setError(errorMessage);
                } else {
                  confirmInvalidate(group.post_id);
                }
              };

              // Sort records oldest to newest for time calculation
              const sortedRecords = [...group.records].sort((a, b) => new Date(a.check_time).getTime() - new Date(b.check_time).getTime());

              return (
                <div key={group.post_id} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-slate-900 text-sm">Post #{group.post_id}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${group.post_status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-700'}`}>
                          {group.post_status || 'Unknown'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Campaign: <span className="font-medium text-slate-700">{group.campaign_name || 'N/A'}</span> •
                        Channel: <span className="font-medium text-slate-700">{group.channel_title || 'N/A'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Locked Settlements</div>
                        <div className="text-xs font-medium text-slate-700">Adv: ${group.total_adv_paid.toFixed(2)} • Pub: ${group.total_pub_reward.toFixed(2)}</div>
                      </div>

                      <div>
                        <button
                          onClick={handleInvalidateClick}
                          disabled={hasInvalidRecord}
                          className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${hasInvalidRecord
                            ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                            : errorMessage
                              ? "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                              : "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100"
                            }`}
                        >
                          {hasInvalidRecord ? "Invalidated" : "Invalidate Views"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Table of audits */}
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-white border-b border-slate-100 text-slate-400">
                      <tr>
                        <th className="px-4 py-2 font-medium">Check Time</th>
                        <th className="px-4 py-2 font-medium">Total Views</th>
                        <th className="px-4 py-2 font-medium">Views Jump</th>
                        <th className="px-4 py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {/* Render in reverse (newest first) to match visual expectation, but calculate from sorted */}
                      {[...sortedRecords].reverse().map((record: any, idx: number, arr: any[]) => {
                        const isInitial = idx === arr.length - 1; // Since it's reversed, the last one is the initial
                        const jump = record.total_views - record.last_views_count;

                        let jumpText = "";
                        if (isInitial) {
                          jumpText = `${jump.toLocaleString()} views in initial record`;
                        } else {
                          const previousRecord = arr[idx + 1]; // The previous chronological record
                          const msDiff = new Date(record.check_time).getTime() - new Date(previousRecord.check_time).getTime();
                          const minutes = Math.max(1, Math.round(msDiff / 60000));
                          jumpText = `+${jump.toLocaleString()} views in ${minutes} minutes`;
                        }

                        return (
                          <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2 text-slate-600">
                              {new Date(record.check_time).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 font-medium text-slate-900">
                              {record.total_views.toLocaleString()}
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-blue-600 font-medium">{jumpText}</span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize ${record.status === 'valid' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                {record.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
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
