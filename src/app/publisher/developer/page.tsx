"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { apiFetch } from "@/lib/api";
import { BarChart3, Bot, Code2, Copy, ExternalLink, Loader2, Plus, ShieldCheck, TestTube2, Webhook } from "lucide-react";

const eventOptions = ["*", "reward.eligible", "reward.claimed", "campaign.approved", "campaign.rejected", "conversion.recorded", "referral.verified", "postback.conversion", "ad.click", "ad.completed"];

function stat(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function parseTextList(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).join("\n");
}

function copyText(value: unknown) {
  navigator.clipboard?.writeText(String(value || ""));
}

function formatDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleString() : "Never";
}

export default function DeveloperCenterPage() {
  const [data, setData] = useState<any>({ apps: [], keys: [], webhooks: [], deliveries: [], miniapps: [], bindings: [], analytics: {} });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [appForm, setAppForm] = useState({
    name: "AdsGalaxy App",
    platform: "telegram_mini_app",
    mode: "sandbox",
    permissions: ["read_only", "reporting", "reward_validation"],
    allowed_ips: "",
    allowed_origins: "",
    webhook_url: "",
  });
  const [webhookForm, setWebhookForm] = useState({ application_id: "", url: "", events: ["*"] });
  const [bindingForm, setBindingForm] = useState({ application_id: "", miniapp_id: "" });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/publisher/developer");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to load developer center");
      setData(payload);
      if (!webhookForm.application_id && payload.apps?.[0]?.id) {
        setWebhookForm((prev) => ({ ...prev, application_id: String(payload.apps[0].id) }));
        setBindingForm((prev) => ({ ...prev, application_id: String(payload.apps[0].id) }));
      }
    } catch (error: any) {
      setMessage(error.message || "Failed to load developer center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fillRate = useMemo(() => {
    const value = Number(data.analytics?.fill_rate ?? 100);
    return `${value.toFixed(1)}%`;
  }, [data.analytics]);

  const submit = async (payload: Record<string, unknown>) => {
    if (actionLoading) return;
    setActionLoading(true);
    setMessage("");
    setSecret("");
    try {
      const res = await apiFetch("/api/publisher/developer", { method: "POST", body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(json.error || "Developer action failed");
        return;
      }
      if (json.secret) setSecret(json.secret);
      setMessage("Developer settings updated.");
      await fetchData();
    } catch (error: any) {
      setMessage(error?.message || "Developer action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const toggleWebhookEvent = (event: string) => {
    setWebhookForm((prev) => ({
      ...prev,
      events: prev.events.includes(event) ? prev.events.filter((item) => item !== event) : [...prev.events, event],
    }));
  };

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Developer Platform</p>
            <h1 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">Developer Center</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Manage API sandbox applications, keys, webhooks, and verified test events.</p>
          </div>
          <Link href="/docs/developers" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">
            <Code2 size={16} /> Docs
          </Link>
        </div>

        <section className="overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 p-5 text-white shadow-xl shadow-blue-950/10 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/30"><Bot size={24} /></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300">Publisher Developer Center</p>
                <h2 className="mt-1 text-xl font-black">Bot Integration</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Add one secure call inside your existing /start handler. Keep complete ownership of your Telegram webhook and bot experience.</p>
              </div>
            </div>
            <div className="grid shrink-0 gap-2 sm:grid-cols-2">
              <Link href="/docs/publisher/bots" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-xs font-black text-white"><Code2 size={15} /> Documentation</Link>
              <Link href="/publisher/bots" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-black text-white"><TestTube2 size={15} /> Manage & Test</Link>
            </div>
          </div>
        </section>

        {message && <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm font-bold text-blue-700">{message}</div>}
        {secret && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Copy now</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-white p-3 text-xs font-bold text-slate-700">{secret}</code>
              <button onClick={() => copyText(secret)} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white"><Copy className="inline" size={14} /> Copy</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {[
                ["API Requests", stat(data.analytics?.requests), BarChart3],
                ["Impressions", stat(data.analytics?.impressions), BarChart3],
                ["Completions", stat(data.analytics?.completions), ShieldCheck],
                ["Fill Rate", fillRate, ShieldCheck],
                ["Errors", stat(data.analytics?.errors), ShieldCheck],
                ["Revenue", `$${Number(data.analytics?.revenue || 0).toFixed(2)}`, BarChart3],
              ].map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400"><Icon size={14} /> {label}</div>
                  <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-900"><Plus size={16} /> Create Application</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">Developer applications are for API sandbox testing and webhooks. Mini App ad delivery uses the Mini App ID shown in Mini App Details.</p>
                <div className="mt-4 grid gap-3">
                  <input value={appForm.name} onChange={(e) => setAppForm({ ...appForm, name: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select value={appForm.platform} onChange={(e) => setAppForm({ ...appForm, platform: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <option value="telegram_mini_app">Telegram Mini App</option>
                      <option value="telegram_bot">Telegram Bot</option>
                      <option value="website">Website</option>
                      <option value="mobile_app">Mobile App</option>
                      <option value="future_platform">Future Platform</option>
                    </select>
                    <select value={appForm.mode} onChange={(e) => setAppForm({ ...appForm, mode: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <option value="sandbox">Sandbox</option>
                      <option value="production" disabled>Production (not enabled)</option>
                    </select>
                  </div>
                  <textarea value={appForm.allowed_ips} onChange={(e) => setAppForm({ ...appForm, allowed_ips: parseTextList(e.target.value) })} placeholder="Allowed IPs, one per line" className="min-h-20 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <textarea value={appForm.allowed_origins} onChange={(e) => setAppForm({ ...appForm, allowed_origins: parseTextList(e.target.value) })} placeholder="Allowed origins, one per line" className="min-h-20 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <input value={appForm.webhook_url} onChange={(e) => setAppForm({ ...appForm, webhook_url: e.target.value })} placeholder="https://example.com/adsgalaxy-webhook" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <button onClick={() => submit({ action: "create_application", ...appForm })} className="rounded-xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">Create Application</button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-900"><Webhook size={16} /> Webhook Endpoint</h2>
                <div className="mt-4 grid gap-3">
                  <select value={webhookForm.application_id} onChange={(e) => setWebhookForm({ ...webhookForm, application_id: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <option value="">Select application</option>
                    {data.apps.map((app: any) => <option key={app.id} value={app.id}>{app.name}</option>)}
                  </select>
                  <input value={webhookForm.url} onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })} placeholder="https://example.com/webhooks/adsgalaxy" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                  <div className="flex flex-wrap gap-2">
                    {eventOptions.map((event) => (
                      <button key={event} onClick={() => toggleWebhookEvent(event)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${webhookForm.events.includes(event) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>{event}</button>
                    ))}
                  </div>
                  <button onClick={() => submit({ action: "save_webhook", ...webhookForm, application_id: Number(webhookForm.application_id) })} className="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">Save Webhook</button>
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Mini App bindings</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">Bind a publisher-owned Mini App to one application in the matching environment.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <select value={bindingForm.application_id} onChange={(e) => setBindingForm({ ...bindingForm, application_id: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <option value="">Select application</option>
                    {data.apps.map((app: any) => <option key={app.id} value={app.id}>{app.name} ({app.mode})</option>)}
                  </select>
                  <select value={bindingForm.miniapp_id} onChange={(e) => setBindingForm({ ...bindingForm, miniapp_id: e.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <option value="">Select Mini App</option>
                    {data.miniapps.map((miniapp: any) => <option key={miniapp.id} value={miniapp.id}>#{miniapp.id} {miniapp.miniapp_name}</option>)}
                  </select>
                </div>
                <button disabled={actionLoading} onClick={() => submit({ action: "bind_miniapp", application_id: Number(bindingForm.application_id), miniapp_id: Number(bindingForm.miniapp_id) })} className="mt-3 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">Bind Mini App</button>
                <div className="mt-4 grid gap-2">
                  {data.bindings.map((binding: any) => (
                    <div key={binding.id} className="rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                      #{binding.miniapp_id} {binding.miniapp_name} · {binding.environment} · {binding.status}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Production webhook controls</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">Reward webhooks support reward.eligible and reward.claimed. New secrets are displayed once.</p>
                <div className="mt-4 grid gap-2">
                  {data.webhooks.map((webhook: any) => (
                    <div key={webhook.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0"><p className="truncate text-sm font-black text-slate-800">{webhook.url}</p><p className="text-xs font-bold text-slate-400">{webhook.events.join(", ")}</p></div>
                      <button disabled={actionLoading} onClick={() => submit({ action: "rotate_webhook_secret", webhook_id: Number(webhook.id) })} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Rotate secret</button>
                    </div>
                  ))}
                  {data.deliveries.filter((delivery: any) => delivery.status === "failed" && delivery.terminal_at).map((delivery: any) => (
                    <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                      <div><p className="text-sm font-black text-slate-800">{delivery.event_type}</p><p className="text-xs font-bold text-slate-400">Failed delivery #{delivery.id}</p></div>
                      <button disabled={actionLoading} onClick={() => submit({ action: "retry_webhook_delivery", delivery_id: Number(delivery.id) })} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Retry</button>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4 text-xs font-black uppercase tracking-widest text-slate-400">API applications and reference IDs</div>
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                {data.apps.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center dark:border-slate-700 dark:bg-slate-900"><Code2 className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-black text-slate-700 dark:text-slate-200">No API applications yet</p><p className="mt-1 text-xs text-slate-500">Create a sandbox application to test signed API events and webhooks.</p></div> : data.apps.map((app: any) => (
                  <div key={app.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-black text-slate-900">{app.name}</h3>
                        <p className="text-xs font-bold text-slate-400">{app.platform} / {app.mode} / {app.status}</p>
                      </div>
                      <span className="rounded-lg bg-white px-2 py-1 text-xs font-black uppercase text-slate-500">{app.mode}</span>
                    </div>
                    <div className="mt-4 rounded-xl bg-white p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">API Application Reference</p>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm font-black text-white">{app.integration_id}</code>
                        <button onClick={() => copyText(app.integration_id)} className="rounded-lg bg-blue-600 p-2 text-white" aria-label="Copy Integration ID"><Copy size={16} /></button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button onClick={() => copyText(app.sandbox_integration_id)} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-bold text-slate-600">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Sandbox Reference</span>
                        {app.sandbox_integration_id}
                      </button>
                      <button onClick={() => copyText(app.production_integration_id)} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-bold text-slate-600">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Production Reference</span>
                        {app.production_integration_id}
                      </button>
                    </div>
                    <dl className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                      <div><dt className="font-black uppercase tracking-widest text-slate-400">Status</dt><dd className="font-bold text-slate-700">{app.status}</dd></div>
                      <div><dt className="font-black uppercase tracking-widest text-slate-400">Created</dt><dd className="font-bold text-slate-700">{formatDate(app.created_at)}</dd></div>
                      <div><dt className="font-black uppercase tracking-widest text-slate-400">Last Activity</dt><dd className="font-bold text-slate-700">{formatDate(app.last_activity_at || app.updated_at)}</dd></div>
                      <div><dt className="font-black uppercase tracking-widest text-slate-400">Environment</dt><dd className="font-bold text-slate-700">{app.mode}</dd></div>
                    </dl>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <Link href="/docs/publisher/miniapps#quick-start" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-600"><ExternalLink size={14} /> Docs</Link>
                      <Link href="/publisher/developer#analytics" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-600"><BarChart3 size={14} /> Analytics</Link>
                      <Link href="/docs/publisher/miniapps#error-handling" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-600"><TestTube2 size={14} /> Testing</Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
