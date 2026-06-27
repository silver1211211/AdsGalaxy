"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Gauge,
  Loader2,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

type RevenueData = {
  settings: Array<any>;
  rules: Array<any>;
  alerts: Array<any>;
  audits: Array<any>;
  snapshots: Array<any>;
  payout_checks: Array<any>;
  financials: Record<string, number>;
  profitability: { campaigns: Array<any>; categories: Array<any>; inventory: Array<any>; countries: Array<any> };
  risk_scores: { publishers: Array<any>; advertisers: Array<any> };
  revenue_reviews: { pending: Array<any>; approved: Array<any>; rejected: Array<any> };
};

const emptyData: RevenueData = {
  settings: [],
  rules: [],
  alerts: [],
  audits: [],
  snapshots: [],
  payout_checks: [],
  financials: {},
  profitability: { campaigns: [], categories: [], inventory: [], countries: [] },
  risk_scores: { publishers: [], advertisers: [] },
  revenue_reviews: { pending: [], approved: [], rejected: [] },
};

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: unknown) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />;
}

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">{children}</select>;
}

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: string; icon: any; tone: string }) {
  const colors: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
        </div>
        <div className={`rounded-lg p-3 ${colors[tone] || colors.blue}`}><Icon size={22} /></div>
      </div>
    </div>
  );
}

function MiniTable({ title, rows, columns }: { title: string; rows: Array<any>; columns: Array<[string, (row: any) => string]> }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-black text-slate-900">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-slate-400">
            <tr>{columns.map(([label]) => <th key={label} className="border-b border-slate-100 px-2 py-2">{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-2 py-6 text-center font-semibold text-slate-400">No data yet.</td></tr>
            ) : rows.slice(0, 8).map((row, index) => (
              <tr key={`${title}-${index}`} className="border-b border-slate-50">
                {columns.map(([label, render]) => <td key={label} className="px-2 py-2 font-semibold text-slate-600">{render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function RevenueProtectionPage() {
  const [data, setData] = useState<RevenueData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [setting, setSetting] = useState({ key: "emergency_protection_mode", value: "0", description: "" });
  const [rule, setRule] = useState({ rule_key: "budget_80_consumed", rule_type: "spend", threshold_value: "80", severity: "high", rule_action: "alert", active: true, description: "" });
  const [override, setOverride] = useState({ action: "force_pause", entity_type: "campaign", entity_id: "", reason: "" });
  const [reviewFilter, setReviewFilter] = useState({ status: "pending", miniapp: "", publisher: "", date: "" });
  const [selectedReview, setSelectedReview] = useState<any | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/revenue-protection");
    const json = await res.json();
    if (res.ok) setData(json);
    else setMessage(json.error || "Failed to load revenue protection.");
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const submit = async (payload: Record<string, unknown>, success = "Saved.") => {
    setMessage("");
    const res = await fetch("/api/admin/revenue-protection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? success : json.error || "Action failed.");
    if (res.ok) await fetchData();
  };

  const reviewRows = (data.revenue_reviews[reviewFilter.status as keyof RevenueData["revenue_reviews"]] || []).filter((row) => {
    const miniappMatches = !reviewFilter.miniapp || String(row.miniapp_id) === reviewFilter.miniapp.trim();
    const publisherMatches = !reviewFilter.publisher || String(row.publisher_id) === reviewFilter.publisher.trim();
    const dateMatches = !reviewFilter.date || String(row.date).slice(0, 10) === reviewFilter.date;
    return miniappMatches && publisherMatches && dateMatches;
  });

  const reviewAction = async (action: "approve_review" | "reject_review", row: any) => {
    await submit(
      { action, stat_id: row.id, note: reviewNote },
      action === "approve_review" ? "Suspicious revenue approved." : "Suspicious revenue rejected."
    );
    setSelectedReview(null);
    setReviewNote("");
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><ShieldAlert size={24} /> Revenue Protection</h1>
            <p className="text-sm font-semibold text-slate-500">Financial safety controls, reserve protection, risk scoring, emergency safeguards, and audit trails.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => submit({ action: "run_scan", auto_pause: false }, "Protection scan completed.")} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
              Run Scan
            </button>
            <button onClick={() => submit({ action: "run_scan", auto_pause: true }, "Protection scan completed with auto-pause enabled.")} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
              Emergency Scan
            </button>
          </div>
        </div>

        {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard title="Total Revenue" value={money(data.financials.total_revenue)} icon={DollarSign} tone="green" />
              <StatCard title="Publisher Earnings" value={money(data.financials.total_publisher_earnings)} icon={DollarSign} tone="amber" />
              <StatCard title="Reserve Pool" value={money(data.financials.total_reserve)} icon={ShieldCheck} tone="blue" />
              <StatCard title="Net Profit" value={money(data.financials.net_profit)} icon={BarChart3} tone={Number(data.financials.net_profit || 0) < 0 ? "red" : "green"} />
              <StatCard title="Profit Margin" value={percent(data.financials.profit_margin)} icon={Gauge} tone="blue" />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Protection Settings</h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={setting.key} onChange={(value) => {
                    const found = data.settings.find((item) => item.key === value);
                    setSetting({ key: value, value: found?.value || "", description: found?.description || "" });
                  }}>
                    {data.settings.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}
                  </Select>
                  <Input value={setting.value} onChange={(value) => setSetting((prev) => ({ ...prev, value }))} />
                  <button onClick={() => submit({ action: "update_setting", ...setting })} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {data.settings.slice(0, 10).map((item) => <div key={item.key} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.key}</b><br />{item.value}</div>)}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Auto Pause Rules</h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input value={rule.rule_key} onChange={(value) => setRule((prev) => ({ ...prev, rule_key: value }))} placeholder="rule_key" />
                  <Select value={rule.rule_type} onChange={(value) => setRule((prev) => ({ ...prev, rule_type: value }))}><option value="spend">Spend</option><option value="risk">Risk</option><option value="reserve">Reserve</option><option value="traffic">Traffic</option><option value="profitability">Profitability</option></Select>
                  <Input value={rule.threshold_value} onChange={(value) => setRule((prev) => ({ ...prev, threshold_value: value }))} placeholder="Threshold" />
                  <Select value={rule.severity} onChange={(value) => setRule((prev) => ({ ...prev, severity: value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select>
                  <Select value={rule.rule_action} onChange={(value) => setRule((prev) => ({ ...prev, rule_action: value }))}><option value="alert">Alert</option><option value="pause">Pause</option><option value="flag">Flag</option></Select>
                  <button onClick={() => submit({ action: "upsert_rule", ...rule })} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save Rule</button>
                </div>
                <div className="mt-4 max-h-56 overflow-y-auto space-y-2">
                  {data.rules.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.rule_key}</b> / {item.rule_type} / {item.threshold_value} / {item.severity} / {item.action}</div>)}
                </div>
              </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><AlertTriangle size={16} /> Open Alerts</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {data.alerts.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400 lg:col-span-2">No open financial safety alerts.</p> : data.alerts.slice(0, 10).map((alert) => (
                  <div key={alert.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{alert.title}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{alert.details || "No details"}</p>
                        <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{alert.severity} / {alert.metric_key} / {new Date(alert.created_at).toLocaleString()}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => submit({ action: "ignore_alert", entity_type: "alert", entity_id: alert.id, reason: "Admin ignored alert" })} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-black uppercase text-slate-600">Ignore</button>
                        <button onClick={() => submit({ action: "mark_safe", entity_type: "alert", entity_id: alert.id, reason: "Admin marked safe" })} className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-black uppercase text-white">Safe</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-black text-slate-900">Admin Overrides</h2>
              <div className="grid gap-2 md:grid-cols-5">
                <Select value={override.action} onChange={(value) => setOverride((prev) => ({ ...prev, action: value }))}><option value="force_pause">Force Pause</option><option value="force_resume">Force Resume</option></Select>
                <Select value={override.entity_type} onChange={(value) => setOverride((prev) => ({ ...prev, entity_type: value }))}><option value="campaign">Campaign</option><option value="miniapp_rewarded">Mini App Ad</option><option value="publisher">Publisher</option><option value="advertiser">Advertiser</option><option value="channel">Channel</option><option value="bot">Bot</option><option value="miniapp">Mini App</option></Select>
                <Input value={override.entity_id} onChange={(value) => setOverride((prev) => ({ ...prev, entity_id: value }))} placeholder="Entity ID" />
                <Input value={override.reason} onChange={(value) => setOverride((prev) => ({ ...prev, reason: value }))} placeholder="Reason" />
                <button onClick={() => submit({ ...override, entity_id: Number(override.entity_id) })} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
                  {override.action === "force_pause" ? <PauseCircle className="mr-1 inline" size={14} /> : <PlayCircle className="mr-1 inline" size={14} />} Apply
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-black text-slate-900">Suspicious Revenue Reviews</h2>
                  <p className="text-xs font-semibold text-slate-500">Review Mini App daily stats held by revenue validation before settlement.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={reviewFilter.status} onChange={(value) => setReviewFilter((prev) => ({ ...prev, status: value }))}>
                    <option value="pending">Pending Reviews</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </Select>
                  <Input value={reviewFilter.miniapp} onChange={(value) => setReviewFilter((prev) => ({ ...prev, miniapp: value }))} placeholder="Miniapp ID" />
                  <Input value={reviewFilter.publisher} onChange={(value) => setReviewFilter((prev) => ({ ...prev, publisher: value }))} placeholder="Publisher ID" />
                  <input type="date" value={reviewFilter.date} onChange={(event) => setReviewFilter((prev) => ({ ...prev, date: event.target.value }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                    <tr>
                      {["Stat", "Miniapp", "Publisher", "Date", "Impressions", "Gross", "Publisher", "Fee", "Status", "Actions"].map((label) => (
                        <th key={label} className="border-b border-slate-100 px-2 py-2">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.length === 0 ? (
                      <tr><td colSpan={10} className="px-2 py-6 text-center font-semibold text-slate-400">No suspicious revenue reviews for this filter.</td></tr>
                    ) : reviewRows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-50">
                        <td className="px-2 py-2 font-black text-slate-700">#{row.id}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{row.miniapp_name || "Mini App"} #{row.miniapp_id}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">#{row.publisher_id}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{String(row.date).slice(0, 10)}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{Number(row.impressions || 0).toLocaleString()}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{money(row.gross_revenue)}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{money(row.publisher_revenue)}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{money(row.ads_galaxy_fee)}</td>
                        <td className="px-2 py-2 font-semibold text-slate-600">{row.revenue_review_status}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            <button onClick={() => { setSelectedReview(row); setReviewNote(row.revenue_review_note || ""); }} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-black uppercase text-slate-600">Details</button>
                            {row.revenue_review_status === "pending_review" && (
                              <>
                                <button onClick={() => { setSelectedReview(row); setReviewNote(""); }} className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-black uppercase text-white">Review</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedReview && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div><p className="text-[10px] font-black uppercase text-slate-400">Stat</p><p className="text-sm font-bold text-slate-800">#{selectedReview.id}</p></div>
                    <div><p className="text-[10px] font-black uppercase text-slate-400">Validation</p><p className="text-sm font-bold text-slate-800">{selectedReview.revenue_validation_status}</p></div>
                    <div><p className="text-[10px] font-black uppercase text-slate-400">Reason</p><p className="text-sm font-bold text-slate-800">{selectedReview.revenue_validation_reason || "Suspicious threshold"}</p></div>
                    <div><p className="text-[10px] font-black uppercase text-slate-400">Updated</p><p className="text-sm font-bold text-slate-800">{new Date(selectedReview.updated_at).toLocaleString()}</p></div>
                  </div>
                  <textarea
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="Review note"
                    className="mt-3 h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedReview.revenue_review_status === "pending_review" && (
                      <>
                        <button onClick={() => reviewAction("approve_review", selectedReview)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Approve</button>
                        <button onClick={() => reviewAction("reject_review", selectedReview)} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Reject</button>
                      </>
                    )}
                    <button onClick={() => { setSelectedReview(null); setReviewNote(""); }} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600">Close Details</button>
                  </div>
                </div>
              )}
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <MiniTable title="Top Profitable Campaigns" rows={data.profitability.campaigns} columns={[
                ["Campaign", (row) => `${row.name || "Campaign"} #${row.id}`],
                ["Category", (row) => row.category || "Uncategorized"],
                ["Spend", (row) => money(row.spend)],
                ["Profit", (row) => money(row.net_profit)],
              ]} />
              <MiniTable title="Top Profitable Categories" rows={data.profitability.categories} columns={[
                ["Category", (row) => row.category],
                ["Spend", (row) => money(row.spend)],
                ["Publisher", (row) => money(row.publisher_earnings)],
                ["Profit", (row) => money(row.net_profit)],
              ]} />
              <MiniTable title="Top Profitable Inventory" rows={data.profitability.inventory} columns={[
                ["Inventory", (row) => `${row.inventory_type} #${row.inventory_id}`],
                ["Spend", (row) => money(row.spend)],
                ["Publisher", (row) => money(row.publisher_earnings)],
                ["Profit", (row) => money(row.net_profit)],
              ]} />
              <MiniTable title="Top Profitable Countries" rows={data.profitability.countries} columns={[
                ["Country", (row) => row.country],
                ["Spend", (row) => money(row.spend)],
                ["Publisher", (row) => money(row.publisher_earnings)],
                ["Profit", (row) => money(row.net_profit)],
              ]} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <MiniTable title="Publisher Risk Scores" rows={data.risk_scores.publishers} columns={[
                ["Publisher", (row) => row.username ? `@${row.username}` : `${row.first_name || "User"} #${row.id}`],
                ["Score", (row) => String(row.publisher_risk_score || 0)],
                ["Status", (row) => row.revenue_protection_status || "normal"],
              ]} />
              <MiniTable title="Advertiser Risk Scores" rows={data.risk_scores.advertisers} columns={[
                ["Advertiser", (row) => row.username ? `@${row.username}` : `${row.first_name || "User"} #${row.id}`],
                ["Score", (row) => String(row.advertiser_risk_score || 0)],
                ["Status", (row) => row.revenue_protection_status || "normal"],
              ]} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <MiniTable title="Recent Payout Safety Checks" rows={data.payout_checks} columns={[
                ["Type", (row) => row.settlement_type],
                ["Campaign", (row) => row.campaign_id ? `#${row.campaign_id}` : "-"],
                ["Status", (row) => row.status],
                ["Reason", (row) => row.reason || "Passed"],
              ]} />
              <MiniTable title="Audit Logs" rows={data.audits} columns={[
                ["Action", (row) => row.action],
                ["Entity", (row) => `${row.entity_type} #${row.entity_id || "-"}`],
                ["Rule", (row) => row.rule_triggered || "-"],
                ["Time", (row) => new Date(row.created_at).toLocaleString()],
              ]} />
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
