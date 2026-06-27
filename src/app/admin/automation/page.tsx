"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Bot, CheckCircle2, FileText, Globe2, Loader2, PauseCircle, PlayCircle, ShieldCheck, SlidersHorizontal, Users, XCircle } from "lucide-react";

type AutomationData = {
  settings: Array<{ key: string; value: string; description?: string }>;
  categories: Array<any>;
  domains: Array<any>;
  policies: Array<any>;
  queues: { campaigns: Array<any>; domains: Array<any>; publishers: Array<any>; traffic: Array<any> };
  audits: Array<any>;
};

const defaultData: AutomationData = { settings: [], categories: [], domains: [], policies: [], queues: { campaigns: [], domains: [], publishers: [], traffic: [] }, audits: [] };

function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />;
}

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">{children}</select>;
}

function QueuePanel({ title, rows }: { title: string; rows: Array<any> }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-black text-slate-900">{title}</h3>
      <div className="space-y-2">
        {rows.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400">No open items.</p> : rows.slice(0, 6).map((row) => (
          <div key={`${title}-${row.id}`} className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-black text-slate-900">{row.reason || row.domain || `Item #${row.id}`}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{row.risk_level || row.status} / {new Date(row.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AutomationCenterPage() {
  const [data, setData] = useState<AutomationData>(defaultData);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [setting, setSetting] = useState({ key: "approval_mode", value: "hybrid", description: "manual, hybrid, automatic" });
  const [category, setCategory] = useState({ category: "Utilities", decision: "auto_approve", applies_to: "all", reason: "" });
  const [domain, setDomain] = useState({ domain: "", status: "normal", notes: "" });
  const [policy, setPolicy] = useState({ policy_key: "", title: "", body: "", severity: "medium", active: true });
  const [bulk, setBulk] = useState({ ids: "", bulk_action: "approve", campaign_type: "campaign" });
  const [warning, setWarning] = useState({ user_id: "", warning_level: "warning", reason: "" });
  const [suspension, setSuspension] = useState({ entity_type: "advertiser", entity_id: "", scope: "temporary", reason: "", suspended_until: "" });

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/automation");
    const json = await res.json();
    if (res.ok) setData(json);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const submit = async (payload: Record<string, unknown>) => {
    setMessage("");
    const res = await fetch("/api/admin/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Automation settings saved." : json.error || "Action failed.");
    if (res.ok) await fetchData();
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><ShieldCheck size={24} /> Automation Center</h1>
            <p className="text-sm font-semibold text-slate-500">Approval rules, domain trust, policy moderation, queues, bulk actions, warnings, and suspensions.</p>
          </div>
          {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}
        </div>

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-4">
              <QueuePanel title="Campaign Review Queue" rows={data.queues.campaigns} />
              <QueuePanel title="Domain Review Queue" rows={data.queues.domains} />
              <QueuePanel title="Publisher Review Queue" rows={data.queues.publishers} />
              <QueuePanel title="Traffic Review Queue" rows={data.queues.traffic} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><SlidersHorizontal size={16} /> Automation Settings</h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={setting.key} onChange={(value) => {
                    const found = data.settings.find((item) => item.key === value);
                    setSetting({ key: value, value: found?.value || "", description: found?.description || "" });
                  }}>
                    {data.settings.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}
                  </Select>
                  <Input value={setting.value} onChange={(value) => setSetting((prev) => ({ ...prev, value }))} />
                  <button onClick={() => submit({ action: "update_setting", ...setting })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {data.settings.slice(0, 9).map((item) => <div key={item.key} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.key}</b><br />{item.value}</div>)}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><FileText size={16} /> Category Review Rules</h2>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Input value={category.category} onChange={(value) => setCategory((prev) => ({ ...prev, category: value }))} placeholder="Category" />
                  <Select value={category.decision} onChange={(value) => setCategory((prev) => ({ ...prev, decision: value }))}><option value="auto_approve">Auto Approve</option><option value="review">Review</option><option value="reject">Reject</option></Select>
                  <Input value={category.reason} onChange={(value) => setCategory((prev) => ({ ...prev, reason: value }))} placeholder="Reason" />
                  <button onClick={() => submit({ action: "upsert_category_rule", ...category })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {data.categories.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.category}</b><br />{item.decision}</div>)}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Globe2 size={16} /> Domain Trust Rules</h2>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Input value={domain.domain} onChange={(value) => setDomain((prev) => ({ ...prev, domain: value }))} placeholder="example.com" />
                  <Select value={domain.status} onChange={(value) => setDomain((prev) => ({ ...prev, status: value }))}><option value="trusted">Trusted</option><option value="normal">Normal</option><option value="watchlist">Watchlist</option><option value="blocked">Blocked</option></Select>
                  <Input value={domain.notes} onChange={(value) => setDomain((prev) => ({ ...prev, notes: value }))} placeholder="Notes" />
                  <button onClick={() => submit({ action: "upsert_domain_rule", ...domain })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="mt-4 max-h-56 overflow-y-auto space-y-2">
                  {data.domains.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.domain}</b> / {item.status} / campaigns {item.campaign_count} / approvals {item.approval_count} / violations {item.violation_count}</div>)}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><FileText size={16} /> Platform Policies</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={policy.policy_key} onChange={(value) => setPolicy((prev) => ({ ...prev, policy_key: value }))} placeholder="policy_key" />
                  <Input value={policy.title} onChange={(value) => setPolicy((prev) => ({ ...prev, title: value }))} placeholder="Title" />
                  <Input value={policy.body} onChange={(value) => setPolicy((prev) => ({ ...prev, body: value }))} placeholder="Body" />
                  <Select value={policy.severity} onChange={(value) => setPolicy((prev) => ({ ...prev, severity: value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select>
                  <button onClick={() => submit({ action: "upsert_policy", ...policy })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white sm:col-span-2">Save Policy</button>
                </div>
                <div className="mt-4 space-y-2">
                  {data.policies.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.title}</b> / {item.severity}</div>)}
                </div>
              </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><CheckCircle2 size={16} /> Bulk Actions</h2>
              <div className="grid gap-2 md:grid-cols-5">
                <Input value={bulk.ids} onChange={(value) => setBulk((prev) => ({ ...prev, ids: value }))} placeholder="IDs, comma separated" />
                <Select value={bulk.campaign_type} onChange={(value) => setBulk((prev) => ({ ...prev, campaign_type: value }))}><option value="campaign">Campaign</option><option value="miniapp_rewarded">Mini App Ad</option></Select>
                <Select value={bulk.bulk_action} onChange={(value) => setBulk((prev) => ({ ...prev, bulk_action: value }))}><option value="approve">Approve Many</option><option value="reject">Reject Many</option><option value="pause">Pause Many</option><option value="resume">Resume Many</option><option value="feature">Feature Many</option><option value="hide">Hide Many</option></Select>
                <button onClick={() => submit({ action: "bulk_action", ...bulk, ids: bulk.ids.split(",").map((id) => Number(id.trim())).filter(Boolean) })} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white md:col-span-2">Run Bulk Action</button>
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Users size={16} /> Warning System</h2>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Input value={warning.user_id} onChange={(value) => setWarning((prev) => ({ ...prev, user_id: value }))} placeholder="User ID" />
                  <Select value={warning.warning_level} onChange={(value) => setWarning((prev) => ({ ...prev, warning_level: value }))}><option value="warning">Warning</option><option value="final_warning">Final Warning</option><option value="restricted">Restricted</option><option value="suspended">Suspended</option></Select>
                  <Input value={warning.reason} onChange={(value) => setWarning((prev) => ({ ...prev, reason: value }))} placeholder="Reason" />
                  <button onClick={() => submit({ action: "warn_user", ...warning, user_id: Number(warning.user_id) })} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Notify</button>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><PauseCircle size={16} /> Suspension System</h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={suspension.entity_type} onChange={(value) => setSuspension((prev) => ({ ...prev, entity_type: value }))}><option value="advertiser">Advertiser</option><option value="publisher">Publisher</option><option value="channel">Channel</option><option value="bot">Bot</option><option value="miniapp">Mini App</option></Select>
                  <Input value={suspension.entity_id} onChange={(value) => setSuspension((prev) => ({ ...prev, entity_id: value }))} placeholder="Entity ID" />
                  <Select value={suspension.scope} onChange={(value) => setSuspension((prev) => ({ ...prev, scope: value }))}><option value="temporary">Temporary</option><option value="permanent">Permanent</option></Select>
                  <Input value={suspension.reason} onChange={(value) => setSuspension((prev) => ({ ...prev, reason: value }))} placeholder="Reason" />
                  <Input value={suspension.suspended_until} onChange={(value) => setSuspension((prev) => ({ ...prev, suspended_until: value }))} placeholder="YYYY-MM-DD HH:mm:ss" />
                  <div className="flex gap-2">
                    <button onClick={() => submit({ action: "suspend", ...suspension, entity_id: Number(suspension.entity_id) })} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white"><PauseCircle className="inline" size={14} /> Suspend</button>
                    <button onClick={() => submit({ action: "restore", entity_type: suspension.entity_type, entity_id: Number(suspension.entity_id) })} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white"><PlayCircle className="inline" size={14} /> Restore</button>
                  </div>
                </div>
              </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Bot size={16} /> Recent Audit Logs</h2>
              <div className="max-h-72 overflow-y-auto space-y-2">
                {data.audits.map((item) => (
                  <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                    <b>{item.action}</b> / {item.entity_type} #{item.entity_id || "-"} / {item.decision || "n/a"} / {item.rule_used || "manual"}
                    <div className="text-slate-400">{item.reason || "No reason"} / {new Date(item.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
