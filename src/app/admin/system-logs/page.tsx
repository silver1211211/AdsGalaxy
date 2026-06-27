"use client";

import React, { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, FileText, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const logTypes = [
  ["all", "All Types"],
  ["channel_posting", "Channel Posting"],
  ["bot_broadcast_hourly", "Bot Broadcast Hourly"],
  ["channel_health", "Channel Health"],
  ["bot_health", "Bot Health"],
  ["system_error", "System Error"],
];

const statuses = [
  ["all", "All Statuses"],
  ["success", "Success"],
  ["partial_failure", "Partial Failure"],
  ["failed", "Failed"],
];

function statusStyle(status: string) {
  if (status === "success") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "failed") return "bg-red-50 text-red-700 border-red-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function statusIcon(status: string) {
  if (status === "success") return CheckCircle2;
  if (status === "failed") return AlertCircle;
  return Clock;
}

function pretty(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function JsonBlock({ value }: { value: any }) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return <p className="text-xs font-semibold text-slate-400">None recorded.</p>;
  }

  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AdminSystemLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("");
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/system-logs", window.location.origin);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("limit", "20");
      if (search) url.searchParams.set("search", search);
      if (type !== "all") url.searchParams.set("type", type);
      if (status !== "all") url.searchParams.set("status", status);
      if (date) url.searchParams.set("date", date);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch system logs");
      setLogs(data.logs || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (error) {
      console.error(error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, search, type, status, date]);

  const totals = useMemo(() => {
    return logs.reduce((acc, log) => {
      acc.attempted += Number(log.attempted_count || 0);
      acc.success += Number(log.success_count || 0);
      acc.failed += Number(log.failed_count || 0);
      return acc;
    }, { attempted: 0, success: 0, failed: 0 });
  }, [logs]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  return (
    <AdminLayout>
      {selectedLog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-black text-slate-900">{selectedLog.title}</h3>
                <p className="text-xs font-semibold text-slate-500">{pretty(selectedLog.log_type)} · {new Date(selectedLog.created_at).toLocaleString()}</p>
              </div>
              <button onClick={() => setSelectedLog(null)} className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5 text-sm">
              <div className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold", statusStyle(selectedLog.status))}>
                {React.createElement(statusIcon(selectedLog.status), { size: 14 })}
                {pretty(selectedLog.status)}
              </div>

              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Summary</p>
                <p className="text-sm font-semibold text-slate-700">{selectedLog.summary || "No summary provided."}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["Attempted", selectedLog.attempted_count],
                  ["Success", selectedLog.success_count],
                  ["Failed", selectedLog.failed_count],
                  ["Skipped", selectedLog.skipped_count],
                  ["Auto-paused", selectedLog.auto_paused_count],
                  ["Inactive Users", selectedLog.inactive_users_count],
                  ["Paused Bots", selectedLog.paused_bots_count],
                  ["Failed Bots", selectedLog.failed_bots_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{Number(value || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Failure Reasons</p>
                  <JsonBlock value={selectedLog.failure_reasons} />
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Affected Entities</p>
                  <JsonBlock value={selectedLog.affected_entities} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Metadata</p>
                <JsonBlock value={selectedLog.metadata} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><FileText size={24} /> System Logs</h1>
            <p className="text-sm font-medium text-slate-500">Channel posting, broadcast summaries, health events, and system issues.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="font-bold uppercase text-slate-400">Attempted</p>
              <p className="text-lg font-black text-slate-900">{totals.attempted.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="font-bold uppercase text-emerald-600">Success</p>
              <p className="text-lg font-black text-emerald-800">{totals.success.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
              <p className="font-bold uppercase text-red-600">Failed</p>
              <p className="text-lg font-black text-red-800">{totals.failed.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
            <form onSubmit={submitSearch} className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search logs"
                className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-semibold outline-none focus:border-blue-500"
              />
            </form>
            <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
              {logTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
              {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700" />
          </div>

          <div className="min-h-[480px] overflow-auto">
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="animate-spin text-blue-600" size={24} />
              </div>
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-xs font-semibold text-slate-400">No system logs found.</div>
            ) : (
              <table className="w-full whitespace-nowrap text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 font-black uppercase tracking-wider text-slate-500">Log</th>
                    <th className="px-4 py-3 font-black uppercase tracking-wider text-slate-500">Type</th>
                    <th className="px-4 py-3 font-black uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-4 py-3 font-black uppercase tracking-wider text-slate-500">Counts</th>
                    <th className="px-4 py-3 text-right font-black uppercase tracking-wider text-slate-500">Time</th>
                    <th className="px-4 py-3 text-right font-black uppercase tracking-wider text-slate-500">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => {
                    const Icon = statusIcon(log.status);
                    return (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="max-w-[320px] px-4 py-3">
                          <p className="truncate font-bold text-slate-900">{log.title}</p>
                          <p className="truncate text-[11px] font-medium text-slate-500">{log.summary}</p>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-600">{pretty(log.log_type)}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 font-bold", statusStyle(log.status))}>
                            <Icon size={12} />
                            {pretty(log.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="font-bold text-slate-900">{Number(log.attempted_count || 0).toLocaleString()}</span> attempted · <span className="text-emerald-700">{Number(log.success_count || 0).toLocaleString()}</span> ok · <span className="text-red-700">{Number(log.failed_count || 0).toLocaleString()}</span> failed
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-semibold text-slate-700">{new Date(log.created_at).toLocaleDateString()}</p>
                          <p className="text-[10px] font-medium text-slate-400">{new Date(log.created_at).toLocaleTimeString()}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setSelectedLog(log)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-bold text-slate-600 hover:bg-slate-50">
                            <Eye size={13} />
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Showing {logs.length} of {total.toLocaleString()} logs</span>
            <div className="flex gap-1">
              <button disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded border border-slate-200 bg-white p-1 text-slate-500 disabled:opacity-50">
                <ChevronLeft size={15} />
              </button>
              <button disabled={page === totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded border border-slate-200 bg-white p-1 text-slate-500 disabled:opacity-50">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
