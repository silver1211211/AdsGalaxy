"use client";

import { useCallback, useEffect, useState } from "react";
import { Pause, Play, ShieldCheck } from "lucide-react";
import { AdminCampaignsView } from "@/app/admin/campaigns/page";

type Exempt = { user_id: number; username?: string; channel_count: number };

export default function SilverControlClient() {
  const [exempt, setExempt] = useState<Exempt[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [pullId, setPullId] = useState("");
  const [userId, setUserId] = useState("");
  const [delivery, setDelivery] = useState(true);
  const [error, setError] = useState("");

  const loadControls = useCallback(async () => {
    try {
      const [campaignResponse, exemptResponse, deliveryResponse] = await Promise.all([
        fetch("/api/check/silver/campaigns?limit=1", { cache: "no-store" }),
        fetch("/api/check/silver/exempt-users", { cache: "no-store" }),
        fetch("/api/check/silver/delivery", { cache: "no-store" }),
      ]);
      if (!campaignResponse.ok || !exemptResponse.ok || !deliveryResponse.ok) throw new Error("Unable to load Silver control data");
      const campaignData = await campaignResponse.json();
      const exemptData = await exemptResponse.json();
      const deliveryData = await deliveryResponse.json();
      setStats(campaignData.stats || {});
      setExempt(exemptData.users || []);
      setDelivery(Boolean(deliveryData.enabled));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadControls(), 0);
    return () => window.clearTimeout(timer);
  }, [loadControls]);

  const mutate = async (url: string, method: string, body?: unknown) => {
    setError("");
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Action failed");
    await loadControls();
    window.dispatchEvent(new Event("silver-campaigns-changed"));
  };

  const card = (label: string, value: unknown) => (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black">{String(value ?? 0)}</p>
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-100 p-3 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 p-4 text-white">
          <div><p className="text-xs font-black tracking-[.2em] text-slate-400">PRIVATE CAMPAIGN SCOPE</p><h1 className="text-2xl font-black">SILVER ADS CONTROL</h1></div>
          <ShieldCheck />
        </header>
        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {card("Managed Campaigns", stats.managed_campaigns)}
          {card("Exempt Users", stats.exempt_users)}
          {card("Active Silver Campaigns", stats.active_campaigns)}
          {card("Silver Delivery", delivery ? "Active" : "Paused")}
        </section>
        <section className="grid gap-2 rounded-2xl bg-white p-3 md:grid-cols-[1fr_auto_1fr_auto_auto] md:items-end">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Main campaign #</label>
            <input value={pullId} onChange={(event) => setPullId(event.target.value)} placeholder="Current Main campaign number" inputMode="numeric" className="w-full rounded-xl border px-3 py-2" />
            <p className="mt-1 text-[10px] font-semibold text-slate-400">Uses the number currently shown in Main Admin.</p>
          </div>
          <button onClick={() => mutate("/api/check/silver/campaigns", "POST", { main_campaign_number: Number(pullId) }).catch((actionError) => setError(actionError.message))} className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">Pull Campaign</button>
          <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Internal publisher user ID" className="rounded-xl border px-3 py-2" />
          <button onClick={() => mutate("/api/check/silver/exempt-users", "POST", { user_id: Number(userId) }).catch((actionError) => setError(actionError.message))} className="rounded-xl bg-slate-700 px-4 py-2 font-bold text-white">Exempt User</button>
          <button onClick={() => mutate("/api/check/silver/delivery", "PATCH", { enabled: !delivery }).catch((actionError) => setError(actionError.message))} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-bold text-white ${delivery ? "bg-rose-600" : "bg-emerald-600"}`}>
            {delivery ? <Pause size={15} /> : <Play size={15} />}{delivery ? "Pause Silver Delivery" : "Resume Silver Delivery"}
          </button>
        </section>
        {error && <p className="rounded-xl bg-rose-50 p-3 font-bold text-rose-700">{error}</p>}
        <AdminCampaignsView silverMode />
        <section className="rounded-2xl bg-white p-3">
          <h2 className="mb-2 font-black">EXEMPT PUBLISHERS</h2>
          <div className="space-y-2">
            {exempt.map((publisher) => (
              <div key={publisher.user_id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                <span><strong>User {publisher.user_id}</strong> @{publisher.username || ""} · {publisher.channel_count} channels</span>
                <button onClick={() => mutate(`/api/check/silver/exempt-users?user_id=${publisher.user_id}`, "DELETE").catch((actionError) => setError(actionError.message))} className="text-xs font-black text-rose-600">Remove</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
