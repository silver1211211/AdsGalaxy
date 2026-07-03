"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Ban, Eye, Gauge, Loader2, Pause, Play, RefreshCw, Scale, ShieldAlert, Snowflake, Trash2, type LucideIcon } from "lucide-react";

type RecordValue = Record<string, unknown>;
type ControlData = {
  channel: RecordValue;
  fraud_events: RecordValue[];
  recent_settlements: RecordValue[];
  ledger_proof: RecordValue;
  audits: RecordValue[];
};

const money = (value: unknown) => `$${Number(value || 0).toFixed(4)}`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "—";
const badge = (value: unknown) => String(value || "unknown").replaceAll("_", " ");

function ActionButton({ name, label, icon: Icon, danger = false, options = {}, running, onRun }: {
  name: string; label: string; icon: LucideIcon; danger?: boolean; options?: RecordValue;
  running: string; onRun: (name: string, options: RecordValue, dangerous: boolean) => void;
}) {
  return <button disabled={Boolean(running)} onClick={() => onRun(name, options, danger)} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${danger ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"}`}>
    {running === name ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}{label}
  </button>;
}

export default function ChannelControlCenter({ channelId, onChanged }: { channelId: number; onChanged?: () => void }) {
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState("");
  const [reason, setReason] = useState("");
  const [trust, setTrust] = useState("");
  const [hours, setHours] = useState("24");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/admin/channels/${channelId}/control-center`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load channel controls");
    setData(payload);
    setTrust(String(payload.channel.trust_score ?? 60));
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/channels/${channelId}/control-center`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load channel controls");
        if (active) { setData(payload); setTrust(String(payload.channel.trust_score ?? 60)); }
      })
      .catch((error: Error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [channelId]);

  const run = async (action: string, options: RecordValue = {}, dangerous = false) => {
    if (dangerous && !window.confirm("Confirm this administrative action. It will be recorded in the audit log.")) return;
    setRunning(action);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/channels/${channelId}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, duration_hours: Number(hours), ...options }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Action failed");
      setMessage(`${badge(action)} completed`);
      await load();
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally { setRunning(""); }
  };

  if (loading) return <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-10"><Loader2 className="animate-spin text-blue-600" /></div>;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message || "Control center unavailable"}</div>;
  const channel = data.channel;
  const frozen = Boolean(channel.trust_score_frozen_until && new Date(String(channel.trust_score_frozen_until)) > new Date());
  const excluded = Boolean(channel.settlement_excluded_until && new Date(String(channel.settlement_excluded_until)) > new Date());
  const banned = channel.publisher_status === "banned" || Number(channel.publisher_is_banned) === 1;

  const actionProps = { running, onRun: run };

  return (
    <div className="space-y-5">
      {message && <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">{message}</div>}
      <section>
        <div className="mb-3 flex items-center justify-between"><h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Operational controls</h4><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold capitalize text-slate-700">Health: {badge(channel.health_status)} · {Number(channel.health_score ?? 100)}/100</span></div>
        {Boolean(channel.health_failure_reason) && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><div className="font-bold">{String(channel.health_failure_reason)}</div><div className="mt-1">{String(channel.suggested_fix || "Review channel telemetry and run a health check.")}</div></div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {channel.status === "active" ? <ActionButton {...actionProps} name="pause" label="Pause" icon={Pause} /> : <ActionButton {...actionProps} name="resume" label="Resume" icon={Play} />}
          <ActionButton {...actionProps} name="health_check" label="Health check" icon={Activity} />
          <ActionButton {...actionProps} name="view_refresh" label="Refresh views" icon={RefreshCw} />
          <ActionButton {...actionProps} name="settlement" label="Settle now" icon={Scale} />
          <ActionButton {...actionProps} name={channel.under_review ? "clear_review" : "mark_review"} label={channel.under_review ? "Clear review" : "Under review"} icon={Eye} />
          <ActionButton {...actionProps} name="delete" label="Disable channel" icon={Trash2} danger />
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Trust and fraud</h4>
        <div className="grid grid-cols-3 gap-3">
          {[['Trust', channel.trust_score, 'text-emerald-700'], ['Risk', channel.risk_score, 'text-red-700'], ['PQI', channel.pqi ?? channel.traffic_quality_score, 'text-blue-700']].map(([label, value, color]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-400">{String(label)}</div><div className={`mt-1 text-xl font-black ${String(color)}`}>{Number(value || 0).toFixed(1)}</div></div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_100px_100px]">
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required reason for sensitive actions" className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400" />
            <input type="number" min="-100" max="100" value={trust} onChange={(event) => setTrust(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <input type="number" min="1" max="720" value={hours} onChange={(event) => setHours(event.target.value)} title="Duration in hours" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ActionButton {...actionProps} name="adjust_trust" label="Set trust" icon={Gauge} danger options={{ value: Number(trust) }} />
            <ActionButton {...actionProps} name={frozen ? "unfreeze_trust" : "freeze_trust"} label={frozen ? "Unfreeze trust" : "Freeze trust"} icon={Snowflake} />
            <ActionButton {...actionProps} name="mark_false_positive" label="False positive" icon={ShieldAlert} danger />
            {banned && <ActionButton {...actionProps} name="reinstate" label="Reinstate" icon={Play} danger />}
            <ActionButton {...actionProps} name={excluded ? "include_settlement" : "exclude_settlement"} label={excluded ? "Include settlement" : "Exclude settlement"} icon={Ban} danger={!excluded} />
          </div>
          <div className="mt-2 text-[10px] text-slate-500">Freeze until: {date(channel.trust_score_frozen_until)} · Settlement excluded until: {date(channel.settlement_excluded_until)}</div>
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Settlement proof</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[['Advertiser debit', data.ledger_proof.advertiser_debit], ['Publisher credit', data.ledger_proof.publisher_credit], ['Platform revenue', data.ledger_proof.platform_revenue], ['Reserve', data.ledger_proof.reserve_amount], ['Difference', data.ledger_proof.accounting_difference]].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 p-3"><div className="text-[9px] font-bold uppercase text-slate-400">{String(label)}</div><div className="mt-1 text-sm font-black text-slate-900">{money(value)}</div></div>
          ))}
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[840px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Date','Type','Campaign','Units','Debit','Publisher','Platform','Reserve','Holdback','Quality','CPM / CPC'].map((item) => <th key={item} className="px-3 py-2">{item}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{data.recent_settlements.map((row) => <tr key={String(row.id)}><td className="px-3 py-2">{date(row.created_at)}</td><td className="px-3 py-2 capitalize">{String(row.settlement_type)}</td><td className="px-3 py-2">#{String(row.campaign_id)}</td><td className="px-3 py-2">{String(row.new_units)}</td><td className="px-3 py-2">{money(row.advertiser_debit)}</td><td className="px-3 py-2">{money(row.publisher_credit)}</td><td className="px-3 py-2">{money(row.platform_revenue)}</td><td className="px-3 py-2">{money(row.reserve_amount)}</td><td className="px-3 py-2">{money(row.quality_holdback)}</td><td className="px-3 py-2">{Number(row.publisher_quality_score || 0).toFixed(1)} / {Number(row.publisher_quality_weight || 0).toFixed(3)}</td><td className="px-3 py-2">{money(row.effective_publisher_cpm)} / {money(row.effective_publisher_cpc)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div><h4 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Latest fraud events</h4><div className="max-h-56 space-y-2 overflow-y-auto">{data.fraud_events.map((event) => <div key={String(event.id)} className="rounded-xl border border-slate-200 p-3 text-xs"><div className="flex justify-between"><span className="font-bold capitalize text-slate-800">{badge(event.fraud_type)}</span><span className="font-bold uppercase text-red-600">{String(event.severity)}</span></div><p className="mt-1 text-slate-600">{String(event.reason)}</p><div className="mt-1 text-[10px] text-slate-400">{date(event.created_at)}{event.false_positive_at ? " · false positive" : ""}</div></div>)}</div></div>
        <div><h4 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Admin audit</h4><div className="max-h-56 space-y-2 overflow-y-auto">{data.audits.map((event) => <div key={String(event.id)} className="rounded-xl border border-slate-200 p-3 text-xs"><div className="font-bold capitalize text-slate-800">{badge(event.action)}</div><div className="mt-1 text-slate-600">{String(event.reason)}</div><div className="mt-1 text-[10px] text-slate-400">Admin #{String(event.admin_id || 'system')} · {date(event.created_at)}</div></div>)}</div></div>
      </section>
    </div>
  );
}
