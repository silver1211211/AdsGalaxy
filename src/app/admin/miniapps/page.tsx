"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Modal from "@/components/ui/Modal";
import { BarChart3, Check, ChevronLeft, ChevronRight, Loader2, Pause, Play, Search, Settings2, Smartphone, Trash2, X } from "lucide-react";

type MiniApp = {
  id: number;
  user_id: number;
  miniapp_name: string;
  miniapp_username: string;
  bot_id: string;
  webapp_url: string;
  miniapp_url: string;
  status: "pending" | "awaiting" | "approved" | "paused" | "rejected";
  traffic_quality_score?: string | number;
  traffic_quality_tier?: string;
  traffic_risk_level?: string;
  traffic_quality_updated_at?: string | null;
  owner_username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  owner_telegram_id?: string | number | null;
  created_at?: string;
  updated_at?: string;
  mediation_request_count?: string | number;
  configured_network_count?: string | number;
  enabled_network_count?: string | number;
  enabled_network_names?: string;
  total_impressions?: string | number;
  no_fill_count?: string | number;
  last_mediation_request_at?: string | null;
  recent_selected_network?: string | null;
  recent_network_failures?: string | number;
  temporarily_disabled_networks?: string;
  fill_rate?: string | number;
  request_to_impression_ratio?: string | number;
  suspicious_flag_count?: string | number;
  monetag_lock_count?: string | number;
  network_health?: Array<{ network_name: string; health_score: number }>;
  monetag_status?: string;
  monetag_opportunity_count?: string | number;
  monetag_next_allowed_opportunity?: string | number;
  monetag_locked_until?: string | null;
  monetag_last_user_masked?: string | null;
};

type NetworkConfig = {
  network_name: string;
  network_placement_id: string;
  enabled: boolean;
  priority_order?: number;
};

type MiniAppReport = {
  summary: Record<string, number>;
  daily: Array<Record<string, number | string>>;
  countries: Array<{ country: string; impressions: number }>;
  networks: Array<Record<string, number | string>>;
  enabled_networks: NetworkConfig[];
  network_diagnostics?: Array<{
    request_id: string;
    selected_network: string | null;
    candidate_pool: string[];
    excluded_networks: Array<{ network_name: string; reason: string }>;
    decision_reason: string;
    final_result: string;
    created_at: string;
  }>;
  range: { startDate: string; endDate: string; dateSearch: string };
};

type RevenueSummary = Record<string, number>;

type PendingAction = {
  miniapp: MiniApp;
  action: "await" | "reject" | "pause" | "resume" | "delete";
  title: string;
  message: string;
  danger?: boolean;
} | null;

const placementLabels: Record<string, string> = {
  Monetag: "Zone ID",
  AdsGram: "Placement ID",
  RichAds: "Widget ID",
  AdExium: "Widget ID",
  GigaPub: "Project ID",
  AdsGalaxyInternal: "Internal AdsGalaxy Ads",
};

const networkLabels: Record<string, string> = {
  Monetag: "Monetag",
  AdsGram: "AdsGram",
  RichAds: "RichAds",
  AdExium: "AdExium",
  GigaPub: "GigaPub",
  AdsGalaxyInternal: "Internal AdsGalaxy Ads",
};

function statusClass(status: MiniApp["status"]) {
  if (status === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "awaiting") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "paused") return "bg-slate-100 text-slate-600 border-slate-200";
  if (status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function statusLabel(status: MiniApp["status"]) {
  if (status === "pending") return "Pending Review";
  if (status === "awaiting") return "Awaiting";
  if (status === "approved") return "Approved";
  if (status === "paused") return "Paused";
  return "Rejected";
}

function displayOwner(miniapp: MiniApp) {
  return miniapp.owner_username ? `@${miniapp.owner_username}` : `${miniapp.first_name || ""} ${miniapp.last_name || ""}`.trim() || "No username";
}

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function qualityLabel(value?: string) {
  return String(value || "good").replace(/_/g, " ");
}

export default function AdminMiniAppsPage() {
  const [miniapps, setMiniapps] = useState<MiniApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkCountFilter, setNetworkCountFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [networkMiniApp, setNetworkMiniApp] = useState<MiniApp | null>(null);
  const [networks, setNetworks] = useState<NetworkConfig[]>([]);
  const [networksLoading, setNetworksLoading] = useState(false);
  const [networkTestLoading, setNetworkTestLoading] = useState<string | null>(null);
  const [networkTestResult, setNetworkTestResult] = useState<Record<string, string>>({});
  const [reportMiniApp, setReportMiniApp] = useState<MiniApp | null>(null);
  const [report, setReport] = useState<MiniAppReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportStart, setReportStart] = useState("");
  const [reportEnd, setReportEnd] = useState("");
  const [reportDateSearch, setReportDateSearch] = useState("");
  const [revenueSummary, setRevenueSummary] = useState<RevenueSummary | null>(null);

  const fetchMiniApps = async (p: number, s: string, q: string, n: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/miniapps?page=${p}&limit=10&status=${s}&network_count=${n}&search=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to fetch Mini Apps");
      setMiniapps(data.miniapps || []);
      setRevenueSummary(data.revenue_summary || null);
      setTotalPages(data.totalPages || 1);
    } catch (err: any) {
      setError(err.message || "Failed to fetch Mini Apps");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchMiniApps(page, statusFilter, search, networkCountFilter);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [page, statusFilter, networkCountFilter, search]);

  const runAction = async () => {
    if (!pendingAction) return;
    const { miniapp, action } = pendingAction;
    setActionLoading(miniapp.id);
    try {
      const res = await fetch(`/api/admin/miniapps/${miniapp.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      setPendingAction(null);
      await fetchMiniApps(page, statusFilter, search, networkCountFilter);
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const openNetworks = async (miniapp: MiniApp) => {
    setNetworkMiniApp(miniapp);
    setNetworksLoading(true);
    setNetworkTestResult({});
    try {
      const res = await fetch(`/api/admin/miniapps/${miniapp.id}/networks`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load networks");
      setNetworks(data.networks || []);
    } catch (err: any) {
      setError(err.message || "Failed to load networks");
      setNetworkMiniApp(null);
    } finally {
      setNetworksLoading(false);
    }
  };

  const saveNetworks = async () => {
    if (!networkMiniApp) return;
    setNetworksLoading(true);
    try {
      const res = await fetch(`/api/admin/miniapps/${networkMiniApp.id}/networks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ networks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save networks");
      setNetworks(data.networks || networks);
      setNetworkMiniApp(null);
      await fetchMiniApps(page, statusFilter, search, networkCountFilter);
    } catch (err: any) {
      setError(err.message || "Failed to save networks");
    } finally {
      setNetworksLoading(false);
    }
  };

  const testNetwork = async (networkName: string) => {
    if (!networkMiniApp) return;
    setNetworkTestLoading(networkName);
    try {
      const res = await fetch(`/api/admin/miniapps/${networkMiniApp.id}/networks/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_name: networkName }),
      });
      const data = await res.json().catch(() => ({}));
      const status = res.ok
        ? `Ready - rewarded ${data.adapter_initialization?.supports_rewarded ? "supported" : "unsupported"}, interstitial ${data.adapter_initialization?.supports_interstitial ? "supported" : "unsupported"}`
        : `${data.error_code || "ERROR"} - ${data.error_message || data.error || "Adapter test failed"}`;
      setNetworkTestResult((prev) => ({ ...prev, [networkName]: status }));
    } catch (err: any) {
      setNetworkTestResult((prev) => ({ ...prev, [networkName]: err.message || "Adapter test failed" }));
    } finally {
      setNetworkTestLoading(null);
    }
  };

  const fetchReport = async (miniapp: MiniApp, start = reportStart, end = reportEnd, date = reportDateSearch) => {
    setReportLoading(true);
    try {
      const query = new URLSearchParams();
      if (start) query.set("start", start);
      if (end) query.set("end", end);
      if (date) query.set("date", date);
      const res = await fetch(`/api/admin/miniapps/${miniapp.id}/report?${query.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setReport(data);
      setReportStart(data.range?.startDate || "");
      setReportEnd(data.range?.endDate || "");
      setReportDateSearch(data.range?.dateSearch || "");
    } catch (err: any) {
      setError(err.message || "Failed to load report");
    } finally {
      setReportLoading(false);
    }
  };

  const openReport = async (miniapp: MiniApp) => {
    setReportMiniApp(miniapp);
    setReport(null);
    setReportStart("");
    setReportEnd("");
    setReportDateSearch("");
    await fetchReport(miniapp, "", "", "");
  };

  const StatusBadge = ({ status }: { status: MiniApp["status"] }) => (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
      {statusLabel(status)}
    </span>
  );

  const ActionButtons = ({ miniapp }: { miniapp: MiniApp }) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {miniapp.status === "pending" && (
        <button
          onClick={() => setPendingAction({ miniapp, action: "await", title: "Begin Network Onboarding", message: `Move ${miniapp.miniapp_name} to Awaiting while AdsGalaxy prepares network configuration?` })}
          disabled={actionLoading === miniapp.id}
          className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50"
          title="Begin onboarding"
        >
          {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
        </button>
      )}
      {miniapp.status !== "pending" && miniapp.status !== "rejected" && (
        <button
          onClick={() => setPendingAction({
            miniapp,
            action: miniapp.status === "paused" ? "resume" : "pause",
            title: miniapp.status === "paused" ? "Resume Mini App" : "Pause Mini App",
            message: `${miniapp.status === "paused" ? "Resume" : "Pause"} ${miniapp.miniapp_name}?`,
            danger: miniapp.status !== "paused",
          })}
          disabled={actionLoading === miniapp.id}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50"
          title={miniapp.status === "paused" ? "Resume" : "Pause"}
        >
          {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={15} /> : miniapp.status === "paused" ? <Play size={15} /> : <Pause size={15} />}
        </button>
      )}
      {miniapp.status !== "rejected" && (
        <button
          onClick={() => setPendingAction({ miniapp, action: "reject", title: "Reject Mini App", message: `Reject ${miniapp.miniapp_name}?`, danger: true })}
          disabled={actionLoading === miniapp.id}
          className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
          title="Reject"
        >
          {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={15} /> : <X size={15} />}
        </button>
      )}
      <button
        onClick={() => openReport(miniapp)}
        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
        title="Reports"
      >
        <BarChart3 size={15} />
      </button>
      <button
        onClick={() => openNetworks(miniapp)}
        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
        title="Network configuration"
      >
        <Settings2 size={15} />
      </button>
      <button
        onClick={() => setPendingAction({
          miniapp,
          action: "delete",
          title: "Delete Mini App",
          message: `Delete ${miniapp.miniapp_name}? This removes it from publisher access and admin lists. Only admins can perform this action.`,
          danger: true,
        })}
        disabled={actionLoading === miniapp.id}
        className="rounded-lg border border-red-100 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
        title="Delete Mini App"
      >
        {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
      </button>
    </div>
  );

  return (
    <AdminLayout>
      <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Error">{error}</Modal>
      <ConfirmationModal
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={runAction}
        title={pendingAction?.title || ""}
        message={pendingAction?.message || ""}
        confirmBtnText="Confirm"
        confirmBtnVariant={pendingAction?.danger ? "danger" : "primary"}
        isLoading={actionLoading !== null}
      />

      {/* Network Configuration Modal */}
      {networkMiniApp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Network Configuration</h3>
                <p className="mt-0.5 text-sm text-slate-500">{networkMiniApp.miniapp_name}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    {networks.filter((n) => n.enabled).length} / 6 Configured
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {networks.filter((n) => n.enabled).length} Enabled
                  </span>
                </div>
              </div>
              <button onClick={() => setNetworkMiniApp(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto p-6">
              {networksLoading ? (
                <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
              ) : networks.map((network, index) => (
                <div
                  key={network.network_name}
                  className={`rounded-xl border p-4 transition-colors ${network.enabled ? "border-blue-200 bg-blue-50/30" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${network.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <div>
                        <div className="font-semibold text-slate-900">{networkLabels[network.network_name] || network.network_name}</div>
                        <div className="text-xs text-slate-500">{placementLabels[network.network_name]}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-semibold ${network.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                        {network.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <button
                        onClick={() => setNetworks((prev) => prev.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item))}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${network.enabled ? "bg-blue-600" : "bg-slate-200"}`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${network.enabled ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </div>
                  </div>
                  {network.network_name !== "AdsGalaxyInternal" && (
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="mb-1.5 block text-xs font-semibold text-slate-600">{placementLabels[network.network_name] || "Placement ID"}</label>
                        <input
                          value={network.network_placement_id}
                          onChange={(e) => setNetworks((prev) => prev.map((item, i) => i === index ? { ...item, network_placement_id: e.target.value } : item))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                          placeholder={placementLabels[network.network_name]}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-600">Priority</label>
                        <input
                          type="number"
                          min={1}
                          max={4}
                          value={network.priority_order || index + 1}
                          onChange={(e) => setNetworks((prev) => prev.map((item, i) => i === index ? { ...item, priority_order: Number(e.target.value) || index + 1 } : item))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    {network.network_name !== "AdsGalaxyInternal" && (
                      <button
                        onClick={() => testNetwork(network.network_name)}
                        disabled={networkTestLoading === network.network_name || networksLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {networkTestLoading === network.network_name && <Loader2 className="animate-spin" size={13} />}
                        Test Init
                      </button>
                    )}
                    {networkTestResult[network.network_name] && (
                      <span
                        className={`min-w-0 truncate text-xs font-medium ${networkTestResult[network.network_name].startsWith("Ready") ? "text-emerald-600" : "text-red-600"}`}
                        title={networkTestResult[network.network_name]}
                      >
                        {networkTestResult[network.network_name]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setNetworkMiniApp(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={saveNetworks} disabled={networksLoading} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400">
                {networksLoading && <Loader2 className="animate-spin" size={16} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {reportMiniApp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Mini App Report</h3>
                <p className="mt-0.5 text-sm text-slate-500">{reportMiniApp.miniapp_name}</p>
              </div>
              <button onClick={() => setReportMiniApp(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              {/* Date Filters */}
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">Start Date</label>
                  <input type="date" value={reportStart} onChange={(e) => setReportStart(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">End Date</label>
                  <input type="date" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">Search Date</label>
                  <div className="flex gap-2">
                    <input value={reportDateSearch} onChange={(e) => setReportDateSearch(e.target.value)} placeholder="YYYY-MM-DD" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                    <button onClick={() => fetchReport(reportMiniApp)} className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Apply</button>
                  </div>
                </div>
              </div>

              {reportLoading || !report ? (
                <div className="p-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
              ) : (
                <div className="space-y-6">
                  {/* Performance Summary */}
                  <div>
                    <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Performance Summary</h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      {[
                        ["Today Impressions", numberValue(report.summary.today_impressions)],
                        ["Yesterday", numberValue(report.summary.yesterday_impressions)],
                        ["Total Impressions", numberValue(report.summary.total_impressions)],
                        ["Today's Revenue", money(report.summary.today_revenue)],
                        ["Lifetime Revenue", money(report.summary.lifetime_revenue)],
                        ["Blended CPM", money(report.summary.blended_cpm)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                          <div className="mt-1.5 text-sm font-bold text-slate-900">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Revenue Breakdown */}
                  <div>
                    <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Revenue Breakdown</h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                      {[
                        ["External Ad Revenue", money(report.summary.external_revenue)],
                        ["Platform Fee", money(report.summary.ads_galaxy_fee)],
                        ["Internal Ad Revenue", money(report.summary.internal_revenue)],
                        ["Publisher Revenue", money(report.summary.net_revenue)],
                        ["Settled Amount", money(report.summary.total_settled_earnings)],
                        ["Locked Amount", money(report.summary.locked_earnings)],
                        ["Unlocked Amount", money(report.summary.unlocked_earnings)],
                        ["Unsettled Amount", money(report.summary.unsettled_earnings)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                          <div className="mt-1.5 text-sm font-bold text-slate-900">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Network Breakdown + Enabled Networks */}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Network Breakdown</h4>
                      </div>
                      <div className="max-h-72 overflow-auto">
                        <table className="w-full min-w-[580px] text-left text-sm">
                          <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                            <tr>
                              <th className="px-4 py-2.5 font-medium">Network</th>
                              <th className="px-4 py-2.5 font-medium">Impressions</th>
                              <th className="px-4 py-2.5 font-medium">Gross</th>
                              <th className="px-4 py-2.5 font-medium">Publisher</th>
                              <th className="px-4 py-2.5 font-medium">CPM</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {report.networks.length === 0 ? (
                              <tr><td colSpan={5} className="p-6 text-center text-slate-500">No network stats.</td></tr>
                            ) : report.networks.map((row) => (
                              <tr key={String(row.network_name)} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-semibold text-slate-900">{networkLabels[String(row.network_name)] || row.network_name}</td>
                                <td className="px-4 py-3 text-slate-700">{numberValue(row.impressions)}</td>
                                <td className="px-4 py-3 text-slate-700">{money(row.gross_revenue)}</td>
                                <td className="px-4 py-3 text-slate-700">{money(row.publisher_revenue)}</td>
                                <td className="px-4 py-3 text-slate-700">{money(row.gross_cpm)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Enabled Networks</h4>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {report.enabled_networks.length === 0 ? (
                          <div className="p-6 text-center text-sm text-slate-500">No network configuration.</div>
                        ) : report.enabled_networks.map((network) => (
                          <div key={network.network_name} className="flex items-center justify-between gap-3 px-4 py-3">
                            <div>
                              <div className="font-semibold text-slate-900">{networkLabels[network.network_name] || network.network_name}</div>
                              <div className="text-xs text-slate-500">{network.network_name === "AdsGalaxyInternal" ? "Internal demand toggle" : network.network_placement_id || "No placement ID"}</div>
                            </div>
                            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${network.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                              {network.enabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Network Selection Diagnostics */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Network Selection Diagnostics</h4>
                    </div>
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full min-w-[860px] text-left text-sm">
                        <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 font-medium">Time</th>
                            <th className="px-4 py-2.5 font-medium">Selected</th>
                            <th className="px-4 py-2.5 font-medium">Candidates</th>
                            <th className="px-4 py-2.5 font-medium">Excluded</th>
                            <th className="px-4 py-2.5 font-medium">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(!report.network_diagnostics || report.network_diagnostics.length === 0) ? (
                            <tr><td colSpan={5} className="p-6 text-center text-slate-500">No recent selection diagnostics.</td></tr>
                          ) : report.network_diagnostics.map((row) => (
                            <tr key={row.request_id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 text-xs text-slate-500">{formatDate(row.created_at)}</td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{row.selected_network || "None"}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{row.candidate_pool.length ? row.candidate_pool.join(", ") : "None"}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{row.excluded_networks.length ? row.excluded_networks.map((i) => `${i.network_name}: ${i.reason}`).join(" / ") : "None"}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{row.decision_reason || row.final_result}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Daily Breakdown */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Daily Breakdown</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1060px] text-left text-sm">
                        <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 font-medium">Date</th>
                            <th className="px-4 py-2.5 font-medium">Ext. Impressions</th>
                            <th className="px-4 py-2.5 font-medium">Ext. Revenue</th>
                            <th className="px-4 py-2.5 font-medium">Fee</th>
                            <th className="px-4 py-2.5 font-medium">Net External</th>
                            <th className="px-4 py-2.5 font-medium">Int. Impressions</th>
                            <th className="px-4 py-2.5 font-medium">Int. Revenue</th>
                            <th className="px-4 py-2.5 font-medium">Total Revenue</th>
                            <th className="px-4 py-2.5 font-medium">Blended CPM</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.daily.length === 0 ? (
                            <tr><td colSpan={9} className="p-6 text-center text-slate-500">No daily stats.</td></tr>
                          ) : report.daily.map((row) => (
                            <tr key={String(row.date)} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{String(row.date).slice(0, 10)}</td>
                              <td className="px-4 py-3 text-slate-700">{numberValue(row.external_impressions)}</td>
                              <td className="px-4 py-3 text-slate-700">{money(row.external_revenue)}</td>
                              <td className="px-4 py-3 text-slate-700">{money(row.ads_galaxy_fee)}</td>
                              <td className="px-4 py-3 text-slate-700">{money(row.external_net_revenue)}</td>
                              <td className="px-4 py-3 text-slate-700">{numberValue(row.internal_impressions)}</td>
                              <td className="px-4 py-3 text-slate-700">{money(row.internal_revenue)}</td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{money(row.total_revenue)}</td>
                              <td className="px-4 py-3 text-slate-700">{money(row.blended_cpm)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Geographic Breakdown */}
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Geographic Breakdown</h4>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 font-medium">Country</th>
                            <th className="px-4 py-2.5 font-medium">Impressions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.countries.length === 0 ? (
                            <tr><td colSpan={2} className="p-6 text-center text-slate-500">No country stats.</td></tr>
                          ) : report.countries.map((row) => (
                            <tr key={row.country} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{row.country}</td>
                              <td className="px-4 py-3 text-slate-700">{numberValue(row.impressions)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Mini Apps</h1>
        <p className="mt-0.5 text-sm text-slate-500">Review and manage publisher mini app monetization</p>
      </div>

      {/* Revenue Summary Cards */}
      {revenueSummary && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["External Ad Revenue", money(revenueSummary.external_ad_revenue)],
            ["Platform Fee Revenue", money(revenueSummary.platform_fee_revenue)],
            ["Internal Ad Revenue", money(revenueSummary.internal_ad_revenue)],
            ["Publisher Revenue", money(revenueSummary.publisher_revenue)],
            ["Blended CPM", money(revenueSummary.blended_cpm)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
              <div className="mt-2 text-lg font-black text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main Table Card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Filters Toolbar */}
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">All Mini Apps</h2>
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search Mini Apps..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-xs outline-none focus:ring-2 focus:ring-blue-500 lg:w-64"
              />
            </div>
            <div className="flex overflow-x-auto">
              <div className="flex flex-shrink-0 rounded-lg border border-slate-200/50 bg-slate-100 p-0.5">
                {["all", "pending", "awaiting", "approved", "rejected", "paused"].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => { setPage(1); setStatusFilter(filter); }}
                    className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-all ${statusFilter === filter ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}
                  >
                    {filter === "all" ? "All" : statusLabel(filter as MiniApp["status"])}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex overflow-x-auto">
              <div className="flex flex-shrink-0 rounded-lg border border-slate-200/50 bg-slate-100 p-0.5">
                {["all", "0", "1", "2", "3", "4"].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => { setPage(1); setNetworkCountFilter(filter); }}
                    className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-all ${networkCountFilter === filter ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}
                  >
                    {filter === "all" ? "All Networks" : `${filter} ${filter === "1" ? "Network" : "Networks"}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Mini App</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Publisher</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Bot ID</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">URLs</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Network Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Traffic Quality</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></td></tr>
              ) : miniapps.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-slate-500">No Mini Apps found.</td></tr>
              ) : miniapps.map((miniapp) => (
                <tr key={miniapp.id} className="transition-colors hover:bg-slate-50/80">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Smartphone size={14} className="flex-shrink-0 text-blue-500" />
                      <span>{miniapp.miniapp_name}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">@{miniapp.miniapp_username}</div>
                    <div className="text-xs text-slate-400">#{miniapp.id}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-900">{displayOwner(miniapp)}</div>
                    <div className="text-xs text-slate-500">User #{miniapp.user_id}</div>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-700">{miniapp.bot_id}</td>
                  <td className="px-5 py-4">
                    <div className="max-w-[220px] truncate text-xs font-medium text-blue-600" title={miniapp.webapp_url}>{miniapp.webapp_url}</div>
                    <div className="max-w-[220px] truncate text-xs text-slate-500" title={miniapp.miniapp_url}>{miniapp.miniapp_url}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        {numberValue(miniapp.enabled_network_count ?? miniapp.configured_network_count)} / 6 Configured
                      </span>
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        {numberValue(miniapp.enabled_network_count)} Enabled
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      <div className="max-w-[200px] truncate text-xs text-slate-600" title={miniapp.enabled_network_names || "No networks enabled"}>
                        {miniapp.enabled_network_names || "No networks enabled"}
                      </div>
                      <div className="flex gap-3 text-[10px] text-slate-500">
                        <span>Requests {numberValue(miniapp.mediation_request_count)}</span>
                        <span>Fill {numberValue(miniapp.fill_rate)}%</span>
                      </div>
                      <div className="flex gap-3 text-[10px] text-slate-500">
                        <span>No-fill {numberValue(miniapp.no_fill_count)}</span>
                        <span>Failures {numberValue(miniapp.recent_network_failures)}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Ratio {numberValue(miniapp.request_to_impression_ratio)} · Flags {numberValue(miniapp.suspicious_flag_count)}
                      </div>
                      <div className="text-[10px] text-slate-400">{formatDate(miniapp.last_mediation_request_at)}</div>
                      {miniapp.network_health && miniapp.network_health.length > 0 && (
                        <div className="max-w-[200px] truncate text-[10px] text-slate-400" title={miniapp.network_health.map((item) => `${item.network_name}: ${item.health_score}`).join(", ")}>
                          Scores {miniapp.network_health.map((item) => `${item.network_name} ${item.health_score}`).join(" / ")}
                        </div>
                      )}
                      {miniapp.temporarily_disabled_networks && (
                        <div className="max-w-[200px] truncate text-[10px] font-semibold text-amber-600" title={miniapp.temporarily_disabled_networks}>
                          Disabled: {miniapp.temporarily_disabled_networks}
                        </div>
                      )}
                      <div className="text-[10px] font-medium text-slate-500">
                        Monetag {miniapp.monetag_status || "Active"}
                        {miniapp.monetag_status === "Locked"
                          ? ` · Until ${formatDate(miniapp.monetag_locked_until)}`
                          : ` · ${numberValue(miniapp.monetag_opportunity_count)} / ${numberValue(miniapp.monetag_next_allowed_opportunity)}`}
                      </div>
                      {miniapp.monetag_last_user_masked && (
                        <div className="text-[10px] text-slate-400">Last user {miniapp.monetag_last_user_masked}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/admin/traffic-quality/miniapp/${miniapp.id}`} className="text-base font-black text-blue-700 hover:text-blue-900">
                      {numberValue(miniapp.traffic_quality_score)}
                    </Link>
                    <div className="mt-0.5 text-xs capitalize text-slate-500">{qualityLabel(miniapp.traffic_quality_tier)}</div>
                    <div className="text-xs capitalize text-slate-500">{qualityLabel(miniapp.traffic_risk_level)} risk</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{formatDate(miniapp.traffic_quality_updated_at)}</div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={miniapp.status} />
                    <div className="mt-1.5 text-[10px] text-slate-400">Updated {formatDate(miniapp.updated_at)}</div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <ActionButtons miniapp={miniapp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="space-y-3 p-4 md:hidden">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
          ) : miniapps.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No Mini Apps found.</div>
          ) : miniapps.map((miniapp) => (
            <div key={miniapp.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-slate-900">
                    <Smartphone size={14} className="flex-shrink-0 text-blue-500" />
                    <span className="truncate">{miniapp.miniapp_name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">@{miniapp.miniapp_username} · {displayOwner(miniapp)}</div>
                </div>
                <StatusBadge status={miniapp.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Bot ID</div>
                  <div className="mt-1 truncate font-semibold text-slate-900">{miniapp.bot_id}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">User</div>
                  <div className="mt-1 font-semibold text-slate-900">#{miniapp.user_id}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Configured</div>
                  <div className="mt-1 font-semibold text-slate-900">{numberValue(miniapp.enabled_network_count ?? miniapp.configured_network_count)} / 6</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Enabled</div>
                  <div className="mt-1 font-semibold text-emerald-700">{numberValue(miniapp.enabled_network_count)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Requests</div>
                  <div className="mt-1 font-semibold text-slate-900">{numberValue(miniapp.mediation_request_count)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Fill Rate</div>
                  <div className="mt-1 font-semibold text-slate-900">{numberValue(miniapp.fill_rate)}%</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">No-fill</div>
                  <div className="mt-1 font-semibold text-slate-900">{numberValue(miniapp.no_fill_count)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Failures</div>
                  <div className="mt-1 font-semibold text-red-700">{numberValue(miniapp.recent_network_failures)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Monetag</div>
                  <div className="mt-1 font-semibold text-slate-900">{miniapp.monetag_status || "Active"}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Flags</div>
                  <div className="mt-1 font-semibold text-slate-900">{numberValue(miniapp.suspicious_flag_count)}</div>
                </div>
                <div className="col-span-2 rounded-lg bg-slate-50 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Traffic Quality</div>
                  <Link href={`/admin/traffic-quality/miniapp/${miniapp.id}`} className="mt-1 block font-semibold text-blue-700 hover:text-blue-900">
                    {numberValue(miniapp.traffic_quality_score)} · {qualityLabel(miniapp.traffic_risk_level)} risk
                  </Link>
                </div>
                {miniapp.monetag_last_user_masked && (
                  <div className="col-span-2 rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Last Monetag User</div>
                    <div className="mt-1 font-semibold text-slate-900">{miniapp.monetag_last_user_masked}</div>
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <ActionButtons miniapp={miniapp} />
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              <ChevronLeft size={15} />
            </button>
            <button disabled={page === totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
