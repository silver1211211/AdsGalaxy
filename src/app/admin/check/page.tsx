"use client";

import { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertTriangle, CheckCircle2, Loader2, Lock, ShieldAlert, ShieldOff, Unlock } from "lucide-react";

type ReviewCase = Record<string, unknown> & { id: number; publisher_id: number; username?: string; reason: string; risk_level: string; inventory_type?: string; inventory_id?: number; channel_title?: string; open_incidents?: number; metadata?: string };

export default function AdminCheckPage() {
  const [data, setData] = useState<{ summary?: Record<string, number>; cases?: ReviewCase[] }>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const load = async () => {
    setLoading(true);
    const response = await fetch("/api/admin/check", { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (response.ok) setData(json);
    else setMessage(json.error || "Unable to load Admin Check cases.");
    setLoading(false);
  };
  // The initial fetch intentionally owns this page's loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  const act = async (item: ReviewCase, action: string) => {
    const destructive = action === "ban_publisher" || action === "suspend_publisher";
    if (destructive && !window.confirm(`Confirm ${action.replaceAll("_", " ")} for publisher #${item.publisher_id}?`)) return;
    const note = destructive ? window.prompt("Admin reason (required for the audit):", "") || "" : "";
    if (destructive && !note.trim()) return;
    setWorking(item.id); setMessage("");
    const response = await fetch("/api/admin/check", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case_id: item.id, action, note }) });
    const json = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Admin Check action completed." : json.error || "Action failed.");
    setWorking(null);
    if (response.ok) await load();
  };
  return <AdminLayout><div className="space-y-5">
    <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><ShieldAlert className="text-red-600" /> Check</h1><p className="text-sm font-semibold text-slate-500">Human review for trust, fraud, health, and payout-safety signals. No case here automatically bans a publisher.</p></div>
    {message && <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">{message}</div>}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold uppercase text-slate-400">Unresolved</div><div className="text-2xl font-black">{Number(data.summary?.unresolved || 0)}</div></div>
      <div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold uppercase text-slate-400">Critical</div><div className="text-2xl font-black text-red-600">{Number(data.summary?.critical || 0)}</div></div>
      <div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold uppercase text-slate-400">High risk</div><div className="text-2xl font-black text-amber-600">{Number(data.summary?.high_risk || 0)}</div></div>
    </div>
    {loading ? <Loader2 className="mx-auto animate-spin text-blue-600" /> : <div className="space-y-3">
      {(data.cases || []).map((item) => <section key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wider text-red-600">{item.risk_level} · Case #{item.id}</div><h2 className="text-lg font-black text-slate-900">Publisher #{item.publisher_id} {item.username ? `@${item.username}` : ""}</h2><p className="text-sm text-slate-600">{item.reason}</p></div><div className="text-right text-xs font-semibold text-slate-500">{item.inventory_type || "publisher"} {item.inventory_id ? `#${item.inventory_id}` : ""}<br />{item.channel_title || ""}<br />{Number(item.open_incidents || 0)} open incident(s)</div></div>
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4"><div className="rounded-lg bg-slate-50 p-3">Trust <b>{String(item.publisher_trust_score ?? "-")}</b></div><div className="rounded-lg bg-slate-50 p-3">Risk <b>{String(item.publisher_risk_score ?? "-")}</b></div><div className="rounded-lg bg-slate-50 p-3">Available <b>${String(item.balance_available ?? "0")}</b></div><div className="rounded-lg bg-slate-50 p-3">Locked <b>${String(item.balance_locked ?? "0")}</b></div></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={working===item.id} onClick={()=>act(item,"clear")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white"><CheckCircle2 className="mr-1 inline" size={14}/>Clear</button>
          <button disabled={working===item.id} onClick={()=>act(item,"false_positive")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white"><ShieldOff className="mr-1 inline" size={14}/>False positive</button>
          {item.inventory_type === "channel" && <><button disabled={working===item.id} onClick={()=>act(item,"hold_settlement")} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white"><Lock className="mr-1 inline" size={14}/>Hold settlement</button><button disabled={working===item.id} onClick={()=>act(item,"release_settlement")} className="rounded-lg border px-3 py-2 text-xs font-black text-slate-700"><Unlock className="mr-1 inline" size={14}/>Release settlement</button></>}
          <button disabled={working===item.id} onClick={()=>act(item,"suspend_publisher")} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700"><AlertTriangle className="mr-1 inline" size={14}/>Suspend 7 days</button>
          <button disabled={working===item.id} onClick={()=>act(item,"ban_publisher")} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white">Manual ban</button>
        </div>
      </section>)}
      {(data.cases || []).length === 0 && <div className="rounded-xl border bg-white p-10 text-center text-sm font-semibold text-slate-500">No unresolved review cases.</div>}
    </div>}
  </div></AdminLayout>;
}
