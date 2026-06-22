"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Toast from "@/components/ui/Toast";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { MiniAppSubmissionValidationError, validateMiniAppSubmission } from "@/lib/miniappSubmissionValidation";
import { cn } from "@/lib/utils";
import { useHeader } from "@/context/HeaderContext";
import { BarChart3, CheckCircle2, Clock, Edit3, HelpCircle, Loader2, MoreVertical, PauseCircle, Plus, Smartphone, Trash2, X, XCircle } from "lucide-react";

type MiniApp = {
  id: number;
  miniapp_name: string;
  miniapp_username: string;
  bot_id: string;
  webapp_url: string;
  miniapp_url: string;
  status: "pending" | "approved" | "monetized" | "paused" | "rejected";
  created_at?: string;
  updated_at?: string;
  mediation_request_count?: string | number;
  confirmed_impression_count?: string | number;
  total_requests?: string | number;
  total_impressions?: string | number;
  last_activity_at?: string | null;
  no_fill_count?: string | number;
  fill_rate?: string | number;
  active_network_count?: string | number;
};

type MiniAppForm = {
  miniapp_name: string;
  miniapp_username: string;
  bot_id: string;
  webapp_url: string;
  miniapp_url: string;
};

type MiniAppReport = {
  range: { startDate: string; endDate: string; dateSearch: string };
  summary: Record<string, number>;
  daily: Array<Record<string, number | string>>;
  countries: Array<{ country: string; impressions: number }>;
};

const emptyForm: MiniAppForm = {
  miniapp_name: "",
  miniapp_username: "",
  bot_id: "",
  webapp_url: "",
  miniapp_url: "",
};

function statusIcon(status: MiniApp["status"]) {
  if (status === "monetized") return <CheckCircle2 className="text-emerald-500" size={14} />;
  if (status === "approved") return <CheckCircle2 className="text-blue-500" size={14} />;
  if (status === "paused") return <PauseCircle className="text-slate-400" size={14} />;
  if (status === "rejected") return <XCircle className="text-red-500" size={14} />;
  return <Clock className="text-amber-500" size={14} />;
}

function statusClass(status: MiniApp["status"]) {
  if (status === "monetized") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "approved") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "paused") return "bg-slate-100 text-slate-600 border-slate-200";
  if (status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function statusLabel(status: MiniApp["status"]) {
  if (status === "pending") return "Pending Review";
  if (status === "monetized") return "Monetized";
  if (status === "approved") return "Approved";
  if (status === "paused") return "Paused";
  return "Rejected";
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No activity";
  return new Date(value).toLocaleString();
}

export default function PublisherMiniAppsPage() {
  const { setTitle } = useHeader();
  const [miniapps, setMiniapps] = useState<MiniApp[]>([]);
  const [hasBetaAccess, setHasBetaAccess] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MiniApp | null>(null);
  const [form, setForm] = useState<MiniAppForm>(emptyForm);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MiniApp | null>(null);
  const [reportTarget, setReportTarget] = useState<MiniApp | null>(null);
  const [report, setReport] = useState<MiniAppReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportStart, setReportStart] = useState("");
  const [reportEnd, setReportEnd] = useState("");
  const [reportDateSearch, setReportDateSearch] = useState("");
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);

  const fetchMiniApps = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await apiFetch("/api/publisher/miniapps");
      const data = await res.json();
      if (res.status === 403) {
        setHasBetaAccess(false);
        setMiniapps([]);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to fetch Mini Apps");
      setHasBetaAccess(true);
      setMiniapps(data || []);
    } catch (error: any) {
      setNotification({ type: "error", title: "Load Failed", message: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setTitle("Mini Apps (Beta)");
    fetchMiniApps();
  }, [setTitle]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (miniapp: MiniApp) => {
    setEditing(miniapp);
    setForm({
      miniapp_name: miniapp.miniapp_name,
      miniapp_username: miniapp.miniapp_username,
      bot_id: miniapp.bot_id,
      webapp_url: miniapp.webapp_url,
      miniapp_url: miniapp.miniapp_url,
    });
    setMenuOpenId(null);
    setFormOpen(true);
  };

  const saveMiniApp = async () => {
    setIsSaving(true);
    try {
      validateMiniAppSubmission(form);
      const res = await apiFetch(editing ? `/api/publisher/miniapps/${editing.id}` : "/api/publisher/miniapps", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save Mini App");
      setFormOpen(false);
      await fetchMiniApps(true);
      setNotification({ type: "success", title: editing ? "Mini App Updated" : "Mini App Submitted", message: "Your Mini App is pending admin review." });
    } catch (error: any) {
      setNotification({
        type: "error",
        title: error instanceof MiniAppSubmissionValidationError ? "Invalid Mini App Details" : "Save Failed",
        message: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteMiniApp = async () => {
    if (!deleteTarget) return;
    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/publisher/miniapps/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete Mini App");
      setDeleteTarget(null);
      await fetchMiniApps(true);
      setNotification({ type: "success", title: "Mini App Deleted", message: "The Mini App was removed from your dashboard." });
    } catch (error: any) {
      setNotification({ type: "error", title: "Delete Failed", message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const fetchReport = async (miniapp: MiniApp, start = reportStart, end = reportEnd, date = reportDateSearch) => {
    setReportLoading(true);
    try {
      const query = new URLSearchParams();
      if (start) query.set("start", start);
      if (end) query.set("end", end);
      if (date) query.set("date", date);
      const res = await apiFetch(`/api/publisher/miniapps/${miniapp.id}/report?${query.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setReport(data);
      setReportStart(data.range?.startDate || "");
      setReportEnd(data.range?.endDate || "");
      setReportDateSearch(data.range?.dateSearch || "");
    } catch (error: any) {
      setNotification({ type: "error", title: "Report Failed", message: error.message });
    } finally {
      setReportLoading(false);
    }
  };

  const openReport = async (miniapp: MiniApp) => {
    setReportTarget(miniapp);
    setReport(null);
    setReportStart("");
    setReportEnd("");
    setReportDateSearch("");
    setMenuOpenId(null);
    await fetchReport(miniapp, "", "", "");
  };

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Mini Apps (Beta)</h1>
          <div className="flex items-center gap-2">
            <Link href="/docs/publisher/miniapps#overview" className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-all hover:text-blue-600">
              <HelpCircle size={18} />
            </Link>
            {hasBetaAccess !== false && (
              <button onClick={openCreate} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0c9de8] text-white transition-all hover:bg-blue-600 active:scale-95">
                <Plus size={24} />
              </button>
            )}
          </div>
        </div>

        {hasBetaAccess === false ? (
          <div className="space-y-6 py-20 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[32px] bg-slate-100 text-slate-400">
              <X size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900">Feature not available yet</h3>
              <p className="mx-auto max-w-[300px] text-sm font-medium text-slate-400">Mini App monetization is currently limited to selected beta publishers.</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <Loader2 className="animate-spin text-blue-600" size={32} />
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Loading Mini Apps...</p>
          </div>
        ) : miniapps.length === 0 ? (
          <div className="space-y-6 py-20 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[32px] bg-blue-50 text-blue-300">
              <Smartphone size={40} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900">No Mini Apps yet</h3>
              <p className="mx-auto max-w-[260px] text-sm font-medium text-slate-400">Submit your Telegram Mini App for review.</p>
            </div>
            <button onClick={openCreate} className="text-sm font-black uppercase tracking-widest text-[#0c9de8]">Add Mini App</button>
          </div>
        ) : (
          <div className="space-y-3">
            {miniapps.map((miniapp) => (
              <div key={miniapp.id} className="relative rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <Smartphone size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 pr-12">
                    <h3 className="truncate text-sm font-black text-slate-900">{miniapp.miniapp_name}</h3>
                    {statusIcon(miniapp.status)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-tight text-slate-400">
                    <span>@{miniapp.miniapp_username}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-200" />
                    <span>Bot {miniapp.bot_id}</span>
                    <span className={cn("rounded border px-1.5 py-0.5", statusClass(miniapp.status))}>{statusLabel(miniapp.status)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Networks Active", numberValue(miniapp.active_network_count)],
                      ["Total Requests", numberValue(miniapp.total_requests ?? miniapp.mediation_request_count)],
                      ["Total Impressions", numberValue(miniapp.total_impressions ?? miniapp.confirmed_impression_count)],
                      ["Fill Rate", `${numberValue(miniapp.fill_rate)}%`],
                      ["Last Activity", formatDate(miniapp.last_activity_at)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-slate-50 px-3 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
                        <div className="mt-1 truncate text-[11px] font-black text-slate-900" title={String(value)}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                </div>
                <div className="absolute right-3 top-3">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpenId(menuOpenId === miniapp.id ? null : miniapp.id);
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition-all hover:bg-slate-50"
                  >
                    <MoreVertical size={20} />
                  </button>
                  {menuOpenId === miniapp.id && (
                    <div className="absolute right-0 top-12 z-[100] w-44 rounded-2xl border border-slate-100 bg-white p-2 shadow-2xl">
                      <button onClick={() => openReport(miniapp)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50">
                        <BarChart3 size={16} /> Reports
                      </button>
                      <button onClick={() => openEdit(miniapp)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50">
                        <Edit3 size={16} /> Edit
                      </button>
                      <button onClick={() => { setDeleteTarget(miniapp); setMenuOpenId(null); }} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold text-red-500 transition-all hover:bg-red-50">
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[100] flex items-end bg-slate-900/40 sm:items-center sm:justify-center sm:p-4">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900">{editing ? "Edit Mini App" : "Add Mini App"}</h2>
              <button onClick={() => setFormOpen(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              {[
                ["miniapp_name", "Mini App Name", "My Mini App"],
                ["miniapp_username", "Mini App Username", "@GameTreasureXBot"],
                ["bot_id", "Bot ID", "1234567890"],
                ["webapp_url", "Web App URL", "https://example.com/app"],
                ["miniapp_url", "Direct Mini App URL", "https://t.me/GameTreasureXBot/app"],
              ].map(([key, label, placeholder]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</label>
                  <input
                    value={form[key as keyof MiniAppForm]}
                    onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-blue-500 focus:bg-white"
                  />
                </div>
              ))}
            </div>
            <button onClick={saveMiniApp} disabled={isSaving} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] py-3 text-sm font-black text-white transition-all hover:bg-blue-600 disabled:bg-slate-200">
              {isSaving && <Loader2 className="animate-spin" size={18} />}
              Submit
            </button>
          </div>
        </div>
      )}

      {reportTarget && (
        <div className="fixed inset-0 z-[100] flex items-end bg-slate-900/40 sm:items-center sm:justify-center sm:p-4">
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-5xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <h2 className="text-lg font-black text-slate-900">Mini App Report</h2>
                <p className="text-xs font-semibold text-slate-400">{reportTarget.miniapp_name}</p>
              </div>
              <button onClick={() => setReportTarget(null)} className="rounded-full p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                <input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <input value={reportDateSearch} onChange={(event) => setReportDateSearch(event.target.value)} placeholder="Search date" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <button onClick={() => fetchReport(reportTarget)} className="rounded-lg bg-[#0c9de8] px-4 py-2 text-sm font-bold text-white">Apply</button>
                </div>
              </div>

              {reportLoading || !report ? (
                <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                    {[
                      ["Today Impressions", numberValue(report.summary.today_impressions)],
                      ["Yesterday Impressions", numberValue(report.summary.yesterday_impressions)],
                      ["Total Impressions", numberValue(report.summary.total_impressions)],
                      ["Today's Revenue", money(report.summary.today_revenue)],
                      ["Lifetime Revenue", money(report.summary.lifetime_revenue)],
                      ["Settled Earnings", money(report.summary.total_settled_earnings)],
                      ["Locked Earnings", money(report.summary.locked_earnings)],
                      ["Unlocked/Available", money(report.summary.unlocked_earnings)],
                      ["Unsettled Earnings", money(report.summary.unsettled_earnings)],
                      ["Blended CPM", money(report.summary.blended_cpm)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[1060px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">External Impressions</th>
                          <th className="px-3 py-2">External Revenue</th>
                          <th className="px-3 py-2">Fee</th>
                          <th className="px-3 py-2">Net External</th>
                          <th className="px-3 py-2">Internal Impressions</th>
                          <th className="px-3 py-2">Internal Revenue</th>
                          <th className="px-3 py-2">Total Revenue</th>
                          <th className="px-3 py-2">Blended CPM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.daily.length === 0 ? (
                          <tr><td colSpan={9} className="p-6 text-center text-slate-500">No stats found.</td></tr>
                        ) : report.daily.map((row) => (
                          <tr key={String(row.date)}>
                            <td className="px-3 py-2 font-semibold">{String(row.date).slice(0, 10)}</td>
                            <td className="px-3 py-2">{numberValue(row.external_impressions)}</td>
                            <td className="px-3 py-2">{money(row.external_revenue)}</td>
                            <td className="px-3 py-2">{money(row.ads_galaxy_fee)}</td>
                            <td className="px-3 py-2">{money(row.external_net_revenue)}</td>
                            <td className="px-3 py-2">{numberValue(row.internal_impressions)}</td>
                            <td className="px-3 py-2">{money(row.internal_revenue)}</td>
                            <td className="px-3 py-2">{money(row.total_revenue)}</td>
                            <td className="px-3 py-2">{money(row.blended_cpm)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                        <tr><th className="px-3 py-2">Country</th><th className="px-3 py-2">Impressions</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.countries.length === 0 ? (
                          <tr><td colSpan={2} className="p-6 text-center text-slate-500">No country stats.</td></tr>
                        ) : report.countries.map((row) => (
                          <tr key={row.country}><td className="px-3 py-2 font-semibold">{row.country}</td><td className="px-3 py-2">{numberValue(row.impressions)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteMiniApp}
        title="Delete Mini App"
        message={deleteTarget ? `Remove ${deleteTarget.miniapp_name}?` : ""}
        confirmBtnText="Delete"
        confirmBtnVariant="danger"
        isLoading={isSaving}
      />

      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />
    </DashboardLayout>
  );
}
