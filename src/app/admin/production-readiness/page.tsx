"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertTriangle, CheckCircle2, Download, Loader2, Pause, Play, Power, ShieldAlert } from "lucide-react";

type Data = {
  platform: Record<string, any>;
  settings: Record<string, string>;
  health: {
    activeChannels: number;
    pausedChannels: number;
    activeBots: number;
    pausedBots: number;
    activeMiniApps: number;
    pausedMiniApps: number;
    activeAdvertisers: number;
    activeCampaigns: number;
    networkHealth: Array<{ network: string; enabled: boolean }>;
    lastSchedulerRun: number;
    lastBroadcastRun: number;
  };
  readiness: Record<string, boolean | string>;
  alerts: Array<{ id: number; severity: string; title: string; details: string; created_at: string }>;
  audits: Array<{ id: number; action: string; entity_type: string; reason: string; created_at: string }>;
};

const platformToggles = [
  ["platform_active", "Platform Active"],
  ["platform_maintenance_mode", "Maintenance Mode"],
  ["platform_read_only", "Read Only"],
  ["platform_emergency_stop", "Emergency Stop"],
];

const bulkTargets = [
  ["channels", "Channels"],
  ["bots", "Bots"],
  ["miniapps", "Mini Apps"],
  ["campaigns", "Campaigns"],
];

const withdrawalMethods = ["BEP20", "TRC20", "TON"];

function enabled(value: unknown) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

function time(value: number) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default function ProductionReadinessPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("Production safety action");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/production-safety");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load production controls");
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (body: Record<string, unknown>, label: string) => {
    setSaving(label);
    setError("");
    try {
      const res = await fetch("/api/admin/production-safety", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Action failed");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  };

  const exportConfig = () => {
    window.open("/api/admin/production-safety?export=1", "_blank");
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900">Production Readiness</h1>
            <p className="text-xs font-semibold text-slate-500">Safety switches, emergency controls, launch health, and audit trail.</p>
          </div>
          <button onClick={exportConfig} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white">
            <Download size={14} /> Export Safe Config
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {loading || !data ? (
          <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-12"><Loader2 className="animate-spin text-blue-600" /></div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              {platformToggles.map(([key, label]) => {
                const on = enabled(data.settings[key]);
                return (
                  <button
                    key={key}
                    onClick={() => submit({ action: "set_platform", key, value: !on }, key)}
                    className={`rounded-lg border p-4 text-left ${on ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-slate-900">{label}</span>
                      {saving === key ? <Loader2 className="animate-spin" size={16} /> : <Power size={16} />}
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-500">{on ? "Enabled" : "Disabled"}</p>
                  </button>
                );
              })}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-black text-slate-900">Emergency Operations</h2>
                <input value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold" />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                {bulkTargets.map(([target, label]) => (
                  <div key={target} className="rounded-lg border border-slate-100 p-3">
                    <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
                    <div className="flex gap-2">
                      <button onClick={() => submit({ action: "bulk_status", target, mode: "pause" }, `${target}-pause`)} className="flex-1 rounded-md bg-red-600 px-2 py-2 text-xs font-bold text-white"><Pause size={13} className="inline" /> Pause All</button>
                      <button onClick={() => submit({ action: "bulk_status", target, mode: "resume" }, `${target}-resume`)} className="flex-1 rounded-md bg-emerald-600 px-2 py-2 text-xs font-bold text-white"><Play size={13} className="inline" /> Resume</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-black text-slate-900">Network Emergency Controls</h2>
                <div className="space-y-2">
                  {data.health.networkHealth.map((network) => (
                    <button key={network.network} onClick={() => submit({ action: "set_network", network: network.network, enabled: !network.enabled }, network.network)} className="flex w-full items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
                      <span className="font-bold text-slate-800">{network.network}</span>
                      <span className={`text-xs font-black ${network.enabled ? "text-emerald-600" : "text-red-600"}`}>{network.enabled ? "Enabled" : "Disabled"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-black text-slate-900">System Health Overview</h2>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                  {Object.entries({
                    "Active Channels": data.health.activeChannels,
                    "Paused Channels": data.health.pausedChannels,
                    "Active Bots": data.health.activeBots,
                    "Paused Bots": data.health.pausedBots,
                    "Active Mini Apps": data.health.activeMiniApps,
                    "Paused Mini Apps": data.health.pausedMiniApps,
                    "Active Advertisers": data.health.activeAdvertisers,
                    "Active Campaigns": data.health.activeCampaigns,
                  }).map(([label, value]) => <div key={label} className="rounded-md bg-slate-50 p-3"><p>{label}</p><p className="text-lg text-slate-900">{value}</p></div>)}
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-500">Last Scheduler Run: {time(data.health.lastSchedulerRun)}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Last Broadcast Run: {time(data.health.lastBroadcastRun)}</p>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-black text-slate-900">Withdrawal Safety</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <button
                  onClick={() => submit({ action: "set_withdrawals", paused: !enabled(data.settings.withdrawals_paused) }, "withdrawals")}
                  className={`rounded-lg border p-3 text-left ${enabled(data.settings.withdrawals_paused) ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}
                >
                  <p className="text-sm font-black text-slate-900">Withdrawals</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{enabled(data.settings.withdrawals_paused) ? "Paused" : "Open"}</p>
                </button>
                {withdrawalMethods.map((method) => {
                  const key = `withdrawal_method_${method}_enabled`;
                  const on = enabled(data.settings[key] ?? "1");
                  return (
                    <button key={method} onClick={() => submit({ action: "set_withdrawal_method", method, enabled: !on }, method)} className="rounded-lg border border-slate-100 p-3 text-left">
                      <p className="text-sm font-black text-slate-900">{method}</p>
                      <p className={`mt-1 text-xs font-bold ${on ? "text-emerald-600" : "text-red-600"}`}>{on ? "Enabled" : "Paused"}</p>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-500">User-facing reason: {data.settings.withdrawals_pause_reason || reason}</p>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-black text-slate-900">Pre-launch Checklist</h2>
                {Object.entries(data.readiness).filter(([key]) => key !== "overallStatus").map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
                    <span className="font-bold capitalize text-slate-700">{key.replace(/[A-Z]/g, " $&")}</span>
                    {value ? <CheckCircle2 className="text-emerald-600" size={18} /> : <AlertTriangle className="text-amber-500" size={18} />}
                  </div>
                ))}
                <p className="mt-3 text-sm font-black text-slate-900">Overall Status: {String(data.readiness.overallStatus).replace("_", " ")}</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-black text-slate-900">Automatic Alerts</h2>
                {data.alerts.length === 0 ? <p className="text-sm font-semibold text-slate-500">No open admin alerts.</p> : data.alerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className="mb-2 rounded-md border border-amber-100 bg-amber-50 p-3">
                    <p className="flex items-center gap-2 text-sm font-black text-slate-900"><ShieldAlert size={15} /> {alert.title}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">{alert.details}</p>
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
