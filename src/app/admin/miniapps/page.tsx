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
    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${statusClass(status)}`}>{statusLabel(status)}</span>
  );

  const ActionButtons = ({ miniapp }: { miniapp: MiniApp }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {miniapp.status === "pending" && (
        <button
          onClick={() => setPendingAction({ miniapp, action: "await", title: "Begin Network Onboarding", message: `Move ${miniapp.miniapp_name} to Awaiting while AdsGalaxy prepares network configuration?` })}
          disabled={actionLoading === miniapp.id}
          className="rounded-md border border-blue-100 bg-blue-50 p-1.5 text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50"
          title="Begin onboarding"
        >
          {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
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
          className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50"
          title={miniapp.status === "paused" ? "Resume" : "Pause"}
        >
          {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={16} /> : miniapp.status === "paused" ? <Play size={16} /> : <Pause size={16} />}
        </button>
      )}
      {miniapp.status !== "rejected" && (
        <button
          onClick={() => setPendingAction({ miniapp, action: "reject", title: "Reject Mini App", message: `Reject ${miniapp.miniapp_name}?`, danger: true })}
          disabled={actionLoading === miniapp.id}
          className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
          title="Reject"
        >
          {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={16} /> : <X size={16} />}
        </button>
      )}
      <button
        onClick={() => openReport(miniapp)}
        className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
        title="Reports"
      >
        <BarChart3 size={16} />
      </button>
      <button
        onClick={() => openNetworks(miniapp)}
        className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-600"
        title="Network configuration"
      >
        <Settings2 size={16} />
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
        className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
        title="Delete Mini App"
      >
        {actionLoading === miniapp.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
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

      {networkMiniApp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Network Configuration</h3>
                <p className="text-xs text-slate-500">{networkMiniApp.miniapp_name}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                    Configured {networks.filter((network) => network.enabled).length} / 6
                  </span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                    Enabled {networks.filter((network) => network.enabled).length}
                  </span>
                </div>
              </div>
              <button onClick={() => setNetworkMiniApp(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="space-y-3 overflow-y-auto p-5">
              {networksLoading ? (
                <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></div>
              ) : networks.map((network, index) => (
                <div key={network.network_name} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{networkLabels[network.network_name] || network.network_name}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{placementLabels[network.network_name]}</div>
                    </div>
                    <button
                      onClick={() => setNetworks((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${network.enabled ? "bg-blue-600" : "bg-slate-200"}`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${network.enabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                  {network.network_name !== "AdsGalaxyInternal" && (
                    <input
                      value={network.network_placement_id}
                      onChange={(event) => setNetworks((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, network_placement_id: event.target.value } : item))}
                      className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      placeholder={placementLabels[network.network_name]}
                    />
                  )}
                  <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Priority
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={network.priority_order || index + 1}
                      onChange={(event) => setNetworks((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, priority_order: Number(event.target.value) || index + 1 } : item))}
                      className="mt-1 w-24 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500"
                    />
                  </label>
                  <div className="mt-3 flex items-center gap-2">
                    {network.network_name !== "AdsGalaxyInternal" && (
                      <button
                        onClick={() => testNetwork(network.network_name)}
                        disabled={networkTestLoading === network.network_name || networksLoading}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {networkTestLoading === network.network_name && <Loader2 className="animate-spin" size={14} />}
                        Test Init
                      </button>
                    )}
                    {networkTestResult[network.network_name] && (
                      <span className="min-w-0 truncate text-xs text-slate-500" title={networkTestResult[network.network_name]}>
                        {networkTestResult[network.network_name]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 border-t border-slate-200 p-4">
              <button onClick={() => setNetworkMiniApp(null)} className="flex-1 rounded-md border border-slate-200 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={saveNetworks} disabled={networksLoading} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-200">
                {networksLoading && <Loader2 className="animate-spin" size={16} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {reportMiniApp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Mini App Report</h3>
                <p className="text-xs text-slate-500">{reportMiniApp.miniapp_name}</p>
              </div>
              <button onClick={() => setReportMiniApp(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto p-5">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                <input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <input value={reportDateSearch} onChange={(event) => setReportDateSearch(event.target.value)} placeholder="Search date" className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <button onClick={() => fetchReport(reportMiniApp)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Apply</button>
                </div>
              </div>

              {reportLoading || !report ? (
                <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-8">
                    {[
                      ["Today Impressions", numberValue(report.summary.today_impressions)],
                      ["Yesterday Impressions", numberValue(report.summary.yesterday_impressions)],
                      ["Total Impressions", numberValue(report.summary.total_impressions)],
                      ["Today's Revenue", money(report.summary.today_revenue)],
                      ["Lifetime Revenue", money(report.summary.lifetime_revenue)],
                      ["External Ad Revenue", money(report.summary.external_revenue)],
                      ["Platform Fee Revenue", money(report.summary.ads_galaxy_fee)],
                      ["Internal Ad Revenue", money(report.summary.internal_revenue)],
                      ["Publisher Revenue", money(report.summary.net_revenue)],
                      ["Settled Amount", money(report.summary.total_settled_earnings)],
                      ["Locked Amount", money(report.summary.locked_earnings)],
                      ["Unlocked Amount", money(report.summary.unlocked_earnings)],
                      ["Unsettled Amount", money(report.summary.unsettled_earnings)],
                      ["Blended CPM", money(report.summary.blended_cpm)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-slate-200">
                      <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase text-slate-400">Network Breakdown</div>
                      <div className="max-h-72 overflow-auto">
                        <table className="w-full min-w-[620px] text-left text-sm">
                          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                            <tr><th className="px-3 py-2">Network</th><th className="px-3 py-2">Impressions</th><th className="px-3 py-2">Gross</th><th className="px-3 py-2">Publisher</th><th className="px-3 py-2">CPM</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {report.networks.length === 0 ? (
                              <tr><td colSpan={5} className="p-6 text-center text-slate-500">No network stats.</td></tr>
                            ) : report.networks.map((row) => (
                              <tr key={String(row.network_name)}><td className="px-3 py-2 font-semibold">{networkLabels[String(row.network_name)] || row.network_name}</td><td className="px-3 py-2">{numberValue(row.impressions)}</td><td className="px-3 py-2">{money(row.gross_revenue)}</td><td className="px-3 py-2">{money(row.publisher_revenue)}</td><td className="px-3 py-2">{money(row.gross_cpm)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200">
                      <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase text-slate-400">Enabled Networks</div>
                      <div className="divide-y divide-slate-100">
                        {report.enabled_networks.length === 0 ? (
                          <div className="p-6 text-center text-sm text-slate-500">No network configuration.</div>
                        ) : report.enabled_networks.map((network) => (
                          <div key={network.network_name} className="flex items-center justify-between gap-3 p-3 text-sm">
                            <div><div className="font-semibold text-slate-900">{networkLabels[network.network_name] || network.network_name}</div><div className="text-xs text-slate-500">{network.network_name === "AdsGalaxyInternal" ? "Internal demand toggle" : network.network_placement_id || "No placement ID"}</div></div>
                            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${network.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{network.enabled ? "Enabled" : "Disabled"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase text-slate-400">Network Selection Diagnostics</div>
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full min-w-[860px] text-left text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                          <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Selected</th><th className="px-3 py-2">Candidate Pool</th><th className="px-3 py-2">Excluded Networks</th><th className="px-3 py-2">Reason</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(!report.network_diagnostics || report.network_diagnostics.length === 0) ? (
                            <tr><td colSpan={5} className="p-6 text-center text-slate-500">No recent selection diagnostics.</td></tr>
                          ) : report.network_diagnostics.map((row) => (
                            <tr key={row.request_id}>
                              <td className="px-3 py-2 text-xs">{formatDate(row.created_at)}</td>
                              <td className="px-3 py-2 font-semibold">{row.selected_network || "None"}</td>
                              <td className="px-3 py-2 text-xs">{row.candidate_pool.length ? row.candidate_pool.join(", ") : "None"}</td>
                              <td className="px-3 py-2 text-xs">{row.excluded_networks.length ? row.excluded_networks.map((item) => `${item.network_name}: ${item.reason}`).join(" / ") : "None"}</td>
                              <td className="px-3 py-2 text-xs">{row.decision_reason || row.final_result}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[1060px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">External Impressions</th><th className="px-3 py-2">External Revenue</th><th className="px-3 py-2">Fee</th><th className="px-3 py-2">Net External</th><th className="px-3 py-2">Internal Impressions</th><th className="px-3 py-2">Internal Revenue</th><th className="px-3 py-2">Total Revenue</th><th className="px-3 py-2">Blended CPM</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.daily.length === 0 ? (
                          <tr><td colSpan={9} className="p-6 text-center text-slate-500">No daily stats.</td></tr>
                        ) : report.daily.map((row) => (
                          <tr key={String(row.date)}><td className="px-3 py-2 font-semibold">{String(row.date).slice(0, 10)}</td><td className="px-3 py-2">{numberValue(row.external_impressions)}</td><td className="px-3 py-2">{money(row.external_revenue)}</td><td className="px-3 py-2">{money(row.ads_galaxy_fee)}</td><td className="px-3 py-2">{money(row.external_net_revenue)}</td><td className="px-3 py-2">{numberValue(row.internal_impressions)}</td><td className="px-3 py-2">{money(row.internal_revenue)}</td><td className="px-3 py-2">{money(row.total_revenue)}</td><td className="px-3 py-2">{money(row.blended_cpm)}</td></tr>
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

      {revenueSummary && (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[
            ["External Ad Revenue", money(revenueSummary.external_ad_revenue)],
            ["Platform Fee Revenue", money(revenueSummary.platform_fee_revenue)],
            ["Internal Ad Revenue", money(revenueSummary.internal_ad_revenue)],
            ["Publisher Revenue", money(revenueSummary.publisher_revenue)],
            ["Blended CPM", money(revenueSummary.blended_cpm)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Mini Apps</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search Mini Apps..." className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-10 pr-4 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-wrap rounded-md border border-slate-200/50 bg-slate-100 p-0.5">
              {["all", "pending", "awaiting", "approved", "rejected", "paused"].map((filter) => (
                <button key={filter} onClick={() => { setPage(1); setStatusFilter(filter); }} className={`flex-1 rounded px-3 py-1.5 text-xs font-medium ${statusFilter === filter ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}>
                  {filter === "all" ? "All" : statusLabel(filter as MiniApp["status"])}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap rounded-md border border-slate-200/50 bg-slate-100 p-0.5">
              {["all", "0", "1", "2", "3", "4"].map((filter) => (
                <button key={filter} onClick={() => { setPage(1); setNetworkCountFilter(filter); }} className={`flex-1 rounded px-3 py-1.5 text-xs font-medium ${networkCountFilter === filter ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-200/50"}`}>
                  {filter === "all" ? "All Config" : `${filter} ${filter === "1" ? "Network" : "Networks"}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Mini App</th>
                <th className="px-4 py-3 font-medium">Publisher</th>
                <th className="px-4 py-3 font-medium">Bot ID</th>
                <th className="px-4 py-3 font-medium">URLs</th>
                <th className="px-4 py-3 font-medium">Network Status</th>
                <th className="px-4 py-3 font-medium">Traffic Quality</th>
                <th className="px-4 py-3 font-medium">Status / Updated</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></td></tr>
              ) : miniapps.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">No Mini Apps found.</td></tr>
              ) : miniapps.map((miniapp) => (
                <tr key={miniapp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-semibold text-slate-900"><Smartphone size={14} className="text-blue-500" /> {miniapp.miniapp_name}</div>
                    <div className="text-xs text-slate-500">@{miniapp.miniapp_username} - #{miniapp.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{displayOwner(miniapp)}</div>
                    <div className="text-xs text-slate-500">User #{miniapp.user_id}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{miniapp.bot_id}</td>
                  <td className="px-4 py-3">
                    <div className="max-w-[240px] truncate text-xs text-blue-600" title={miniapp.webapp_url}>{miniapp.webapp_url}</div>
                    <div className="max-w-[240px] truncate text-xs text-slate-500" title={miniapp.miniapp_url}>{miniapp.miniapp_url}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        Configured {numberValue(miniapp.enabled_network_count ?? miniapp.configured_network_count)} / 6
                      </span>
                      <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        Enabled {numberValue(miniapp.enabled_network_count)}
                      </span>
                    </div>
                    <div className="mt-1 max-w-[240px] truncate text-xs text-slate-500" title={miniapp.enabled_network_names || "No networks enabled"}>
                      {miniapp.enabled_network_names || "No networks enabled"}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">Requests {numberValue(miniapp.mediation_request_count)}</div>
                    <div className="text-[10px] text-slate-400">{formatDate(miniapp.last_mediation_request_at)}</div>
                    <div className="text-[10px] text-slate-500">
                      No-fill {numberValue(miniapp.no_fill_count)} · Failures {numberValue(miniapp.recent_network_failures)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Fill {numberValue(miniapp.fill_rate)}% · Ratio {numberValue(miniapp.request_to_impression_ratio)} · Flags {numberValue(miniapp.suspicious_flag_count)}
                    </div>
                    {miniapp.network_health && miniapp.network_health.length > 0 && (
                      <div className="max-w-[240px] truncate text-[10px] text-slate-400" title={miniapp.network_health.map((item) => `${item.network_name}: ${item.health_score}`).join(", ")}>
                        Scores {miniapp.network_health.map((item) => `${item.network_name} ${item.health_score}`).join(" / ")}
                      </div>
                    )}
                    {miniapp.temporarily_disabled_networks && (
                      <div className="max-w-[220px] truncate text-[10px] font-semibold text-amber-600" title={miniapp.temporarily_disabled_networks}>
                        Disabled {miniapp.temporarily_disabled_networks}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] font-semibold text-slate-500">
                      Monetag {miniapp.monetag_status || "Active"} · {miniapp.monetag_status === "Locked" ? formatDate(miniapp.monetag_locked_until) : `${numberValue(miniapp.monetag_opportunity_count)} / ${numberValue(miniapp.monetag_next_allowed_opportunity)}`}
                    </div>
                    {miniapp.monetag_last_user_masked && (
                      <div className="text-[10px] text-slate-400">Last user {miniapp.monetag_last_user_masked}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/traffic-quality/miniapp/${miniapp.id}`} className="font-black text-blue-700 hover:text-blue-900">{numberValue(miniapp.traffic_quality_score)}</Link>
                    <div className="text-xs capitalize text-slate-500">{qualityLabel(miniapp.traffic_quality_tier)} / {qualityLabel(miniapp.traffic_risk_level)} risk</div>
                    <div className="text-[10px] text-slate-400">{formatDate(miniapp.traffic_quality_updated_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={miniapp.status} />
                    <div className="mt-1 text-[10px] text-slate-400">Updated {formatDate(miniapp.updated_at)}</div>
                  </td>
                  <td className="px-4 py-3 text-right"><ActionButtons miniapp={miniapp} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></div>
          ) : miniapps.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No Mini Apps found.</div>
          ) : miniapps.map((miniapp) => (
            <div key={miniapp.id} className="rounded-lg border border-slate-200 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-slate-900"><Smartphone size={14} className="text-blue-500" /> <span className="truncate">{miniapp.miniapp_name}</span></div>
                  <div className="text-xs text-slate-500">@{miniapp.miniapp_username}</div>
                  <div className="text-xs text-slate-400">{displayOwner(miniapp)}</div>
                </div>
                <StatusBadge status={miniapp.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Bot ID</div><div className="truncate font-semibold text-slate-900">{miniapp.bot_id}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">User</div><div className="font-semibold text-slate-900">#{miniapp.user_id}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Configured Networks</div><div className="font-semibold text-slate-900">{numberValue(miniapp.enabled_network_count ?? miniapp.configured_network_count)} / 6</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Networks Enabled</div><div className="font-semibold text-slate-900">{numberValue(miniapp.enabled_network_count)}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Last Updated</div><div className="truncate font-semibold text-slate-900">{formatDate(miniapp.updated_at)}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Requests</div><div className="font-semibold text-slate-900">{numberValue(miniapp.mediation_request_count)}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">No-fill</div><div className="font-semibold text-slate-900">{numberValue(miniapp.no_fill_count)}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Failures</div><div className="font-semibold text-slate-900">{numberValue(miniapp.recent_network_failures)}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Fill Rate</div><div className="font-semibold text-slate-900">{numberValue(miniapp.fill_rate)}%</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Flags</div><div className="font-semibold text-slate-900">{numberValue(miniapp.suspicious_flag_count)}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Monetag</div><div className="font-semibold text-slate-900">{miniapp.monetag_status || "Active"}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Last User</div><div className="font-semibold text-slate-900">{miniapp.monetag_last_user_masked || "N/A"}</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-bold uppercase text-slate-400">Quality</div><Link href={`/admin/traffic-quality/miniapp/${miniapp.id}`} className="font-semibold text-blue-700 hover:text-blue-900">{numberValue(miniapp.traffic_quality_score)} / {qualityLabel(miniapp.traffic_risk_level)}</Link></div>
                </div>
              <div className="mt-3"><ActionButtons miniapp={miniapp} /></div>
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
