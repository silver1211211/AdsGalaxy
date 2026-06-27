"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { BarChart3, Code2, KeyRound, Loader2, RefreshCw, ShieldOff, SlidersHorizontal, Webhook } from "lucide-react";

function stat(value: unknown) {
  return Number(value || 0).toLocaleString();
}

export default function AdminDeveloperPlatformPage() {
  const [data, setData] = useState<any>({ settings: [], apps: [], analytics: {}, requests: [], deliveries: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [setting, setSetting] = useState({ key: "rate_limit_per_minute", value: "100", description: "Default API requests per minute per key" });
  const [newKey, setNewKey] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/developer-platform");
    const payload = await res.json().catch(() => ({}));
    if (res.ok) setData(payload);
    else setMessage(payload.error || "Failed to load developer platform");
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const patch = async (payload: Record<string, unknown>) => {
    setMessage("");
    setNewKey("");
    const res = await fetch("/api/admin/developer-platform", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(json.error || "Admin action failed");
      return;
    }
    if (json.raw_key) setNewKey(json.raw_key);
    setMessage("Developer platform updated.");
    await fetchData();
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Code2 size={24} /> Developer Platform</h1>
            <p className="text-sm font-semibold text-slate-500">API keys, developer apps, rate limits, webhook retries, usage, and audit visibility.</p>
          </div>
          {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}
        </div>

        {newKey && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">New key: <code className="break-all">{newKey}</code></div>}

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-5">
              {[
                ["Requests", stat(data.analytics?.requests), BarChart3],
                ["Errors", stat(data.analytics?.errors), ShieldOff],
                ["Active Apps", stat(data.analytics?.active_apps), Code2],
                ["Webhook Deliveries", stat(data.analytics?.webhook_deliveries), Webhook],
                ["Reward Validations", stat(data.analytics?.reward_validations), KeyRound],
              ].map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><Icon size={14} /> {label}</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><SlidersHorizontal size={16} /> Rate Limits and Platform Settings</h2>
              <div className="grid gap-2 md:grid-cols-4">
                <select value={setting.key} onChange={(event) => {
                  const found = data.settings.find((item: any) => item.key === event.target.value);
                  setSetting({ key: event.target.value, value: found?.value || "", description: found?.description || "" });
                }} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  {data.settings.map((item: any) => <option key={item.key} value={item.key}>{item.key}</option>)}
                </select>
                <input value={setting.value} onChange={(event) => setSetting({ ...setting, value: event.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
                <input value={setting.description} onChange={(event) => setSetting({ ...setting, description: event.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm md:col-span-1" />
                <button onClick={() => patch({ action: "update_setting", ...setting })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save</button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Developer Applications</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Developer</th><th>Application</th><th>Mode</th><th>Status</th><th>Keys</th><th>Created</th><th className="pr-3 text-right">Controls</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.apps.map((app: any) => (
                      <tr key={app.id}>
                        <td className="px-3 py-2">@{app.username || app.telegram_id}<div className="text-xs text-slate-400">User #{app.user_id}</div></td>
                        <td className="font-semibold">{app.name}<div className="text-xs text-slate-400">{app.platform}</div></td>
                        <td>{app.mode}</td><td>{app.status}</td><td>{app.key_count}</td><td>{new Date(app.created_at).toLocaleString()}</td>
                        <td className="pr-3 text-right">
                          <button onClick={() => patch({ action: "set_application_status", application_id: app.id, status: app.status === "suspended" ? "active" : "suspended" })} className="mr-2 rounded border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">{app.status === "suspended" ? "Restore App" : "Suspend App"}</button>
                          <button onClick={() => patch({ action: "set_developer_status", user_id: app.user_id, status: "suspended" })} className="rounded border border-red-200 px-3 py-2 text-xs font-bold text-red-600">Suspend Developer</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">API Audit Log</div>
                <div className="max-h-96 overflow-auto">
                  {data.requests.slice(0, 40).map((row: any) => (
                    <div key={row.id} className="border-b border-slate-100 p-3 text-xs">
                      <b>{row.method}</b> {row.endpoint} / {row.status_code} / {row.success ? "success" : "error"}
                      <div className="text-slate-400">{row.ip_address || "no ip"} / {row.error_message || row.request_id || "ok"} / {new Date(row.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold uppercase text-slate-400">Webhook History and Retries</div>
                <div className="max-h-96 overflow-auto">
                  {data.deliveries.slice(0, 40).map((row: any) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 border-b border-slate-100 p-3 text-xs">
                      <div><b>{row.event_type}</b> / {row.status}<div className="text-slate-400">attempts {row.attempts} / {row.error_message || row.response_status || "pending"}</div></div>
                      <RefreshCw size={14} className={row.status === "retrying" ? "text-amber-500" : "text-slate-300"} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
