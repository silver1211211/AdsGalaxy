"use client";

import React from "react";
import { AlertTriangle, Clock3, DollarSign, Megaphone, RefreshCw, ShieldCheck, Users } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";

export default function PromoteAdsGalaxyAdminPage() {
  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [paymentReference, setPaymentReference] = React.useState("");
  const [confirmedAmount, setConfirmedAmount] = React.useState("");
  const load = React.useCallback(() => fetch("/api/admin/promote-ads-galaxy", { cache: "no-store" }).then(async r => { const body=await r.json(); if(!r.ok) throw new Error(body.error); setData(body); }).catch(e=>setError(e.message)), []);
  React.useEffect(() => { load(); }, [load]);
  async function action(name: string) {
    const highRisk = ["activate", "close", "approve_payout", "confirm_payment"].includes(name);
    if (highRisk && !window.confirm(`Confirm ${name.replaceAll("_", " ")}. This action is audited and cannot be silently undone.`)) return;
    setBusy(name); setError("");
    try { const r=await fetch("/api/admin/promote-ads-galaxy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:name,payment_reference:paymentReference,confirmed_amount:confirmedAmount})}); const body=await r.json(); if(!r.ok) throw new Error(body.error); await load(); }
    catch(e){setError(e instanceof Error?e.message:"Action failed");} finally {setBusy("");}
  }
  const campaign=data?.campaign, stats=data?.stats||{};
  const cards=[["Referrals",stats.referrals||0,Users],["Channels",stats.channels||0,Megaphone],["Pending",stats.pending_validation||0,Clock3],["Qualified",stats.qualified||0,ShieldCheck],["Manual review",stats.manual_review||0,AlertTriangle],["Projected liability",`$${stats.liability||"0.00"}`,DollarSign]] as const;
  return <AdminLayout><div className="space-y-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-widest text-[#0c9de8]">Publisher acquisition</p><h1 className="mt-1 text-3xl font-black text-slate-950">Promote AdsGalaxy</h1><p className="mt-2 text-sm text-slate-500">Three-day campaign controls, validation, liability and payout review.</p></div><button onClick={load} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black"><RefreshCw size={14}/>Refresh</button></div>
    {error&&<div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
    <section className="rounded-3xl bg-slate-950 p-6 text-white"><div className="flex flex-wrap items-center justify-between gap-4"><div><span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest">{campaign?.status||"loading"}</span><p className="mt-4 text-sm text-white/60">Starts: {campaign?.starts_at?new Date(campaign.starts_at).toISOString():"NULL"}</p><p className="mt-1 text-sm text-white/60">Ends: {campaign?.ends_at?new Date(campaign.ends_at).toISOString():"NULL"}</p></div><div className="flex flex-wrap gap-2">{campaign?.status==="draft"&&<button onClick={()=>action("activate")} disabled={!!busy} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black">Activate 3-day campaign</button>}{campaign?.status==="active"&&<><button onClick={()=>action("pause")} className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black">Pause</button><button onClick={()=>action("close")} className="rounded-xl bg-red-500 px-4 py-2 text-xs font-black">Close</button></>}{campaign?.status==="paused"&&<button onClick={()=>action("resume")} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black">Resume</button>}<button onClick={()=>action("process")} className="rounded-xl bg-white/10 px-4 py-2 text-xs font-black">Process now</button></div></div></section>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{cards.map(([label,value,Icon])=><div key={label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><Icon size={18} className="text-[#0c9de8]"/><p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>)}</div>
    <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"><h2 className="font-black">Payout control</h2><p className="mt-2 text-sm text-slate-500">Approval prepares eligible rows only. Confirm payment only after funds were genuinely sent; the reference and exact amount are permanently audited.</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><button onClick={()=>action("approve_payout")} disabled={!['closed','payout_review'].includes(campaign?.status)||!!busy} className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Approve payout batch</button><input value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="Transaction / payment reference" className="rounded-xl border border-slate-200 px-3 py-2 text-xs"/><input value={confirmedAmount} onChange={e=>setConfirmedAmount(e.target.value)} placeholder="Exact amount sent" inputMode="decimal" className="rounded-xl border border-slate-200 px-3 py-2 text-xs"/><button onClick={()=>action("confirm_payment")} disabled={campaign?.status!=="payout_review"||!!busy||!paymentReference||!confirmedAmount} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Confirm funds sent</button></div></section>
    <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"><h2 className="font-black">Audit trail</h2><div className="mt-4 space-y-2">{(data?.audits||[]).map((row:any,i:number)=><div key={i} className="rounded-xl bg-slate-50 px-3 py-2 text-xs"><strong>{row.action}</strong><span className="ml-2 text-slate-400">{new Date(row.created_at).toISOString()}</span></div>)}</div></section>
  </div></AdminLayout>;
}
