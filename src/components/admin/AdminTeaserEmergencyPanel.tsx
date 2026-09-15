"use client";

import React from "react";
import { Loader2, RefreshCw, X, Zap } from "lucide-react";
import { useTranslations } from "@/i18n/client";
import { teaserErrorMessageKey } from "@/lib/teaserErrorMessage";

type Campaign = { id: number; name: string; status: string; teaser_cpm: string | number; budget: string | number };
type Job = { id: number; campaign_id: number; status: string; queued_count?: number; injected_count?: number; skipped_count?: number; retrying_count?: number; created_at?: string };

export default function AdminTeaserEmergencyPanel({ campaignId }: { campaignId: number }) {
  const { t } = useTranslations();
  const [campaign, setCampaign] = React.useState<Campaign | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [open, setOpen] = React.useState(false);
  const [override, setOverride] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const safe = React.useCallback(
    (code: unknown) => t(teaserErrorMessageKey(code) as never),
    [t],
  );

  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/teaser/emergency-push", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "TEASER_JOB_LOAD_FAILED");
      setCampaign((body.campaigns || []).find((item: Campaign) => Number(item.id) === campaignId) || null);
      setJobs((body.jobs || []).filter((item: Job) => Number(item.campaign_id) === campaignId));
    } catch (loadError) { setError(safe(loadError instanceof Error ? loadError.message : "TEASER_JOB_LOAD_FAILED")); }
    finally { setLoading(false); }
  }, [campaignId, safe]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const create = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/teaser/emergency-push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign_id: campaignId, override_targeting: override, confirmation: override ? undefined : "CONFIRM", override_confirmation: override ? "CONFIRM_OVERRIDE" : undefined, idempotency_key: `teaser:${campaignId}:${crypto.randomUUID()}` }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "TEASER_EMERGENCY_CREATE_FAILED");
      setOpen(false); setOverride(false); setConfirmed(false); await load();
    } catch (createError) { setError(safe(createError instanceof Error ? createError.message : "TEASER_EMERGENCY_CREATE_FAILED")); }
    finally { setBusy(false); }
  };

  return <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-sky-600">{t("teaser.delivery")}</p><h2 className="mt-1 font-black text-slate-950">{t("teaser.emergency")}</h2><p className="mt-1 text-xs text-slate-500">{t("teaser.emergencyExplain")}</p></div><div className="flex gap-2"><button onClick={() => void load()} className="rounded-lg border bg-white p-2 text-slate-600" aria-label={t("common.refresh")}><RefreshCw size={15} className={loading ? "animate-spin" : ""}/></button><button disabled={!campaign || busy} onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"><Zap size={14}/>{t("teaser.confirmPush")}</button></div></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p>}
    {!loading && !campaign && <p className="mt-3 text-xs font-semibold text-amber-700">{t("teaser.error.campaignNotEligible")}</p>}
    {jobs.length > 0 && <div className="mt-3 space-y-2">{jobs.slice(0, 5).map((job) => <div key={job.id} className="rounded-lg bg-white p-2 text-xs text-slate-600"><b>#{job.id} · {job.status}</b><span className="ml-2">{t("teaser.injected")}: {Number(job.injected_count || 0).toLocaleString()} · {t("teaser.skipped")}: {Number(job.skipped_count || 0).toLocaleString()}</span></div>)}</div>}
    {open && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5"><div className="flex items-center justify-between"><h3 className="font-black">{t("teaser.emergency")}</h3><button onClick={() => setOpen(false)}><X size={19}/></button></div><p className="mt-3 text-sm text-slate-500">{campaign?.name} · CPM ${Number(campaign?.teaser_cpm || 0).toFixed(2)}</p><label className="mt-4 flex gap-2 rounded-xl border p-3 text-xs font-semibold"><input type="checkbox" checked={override} onChange={(event) => { setOverride(event.target.checked); setConfirmed(false); }}/>{override ? t("teaser.overrideWarning") : t("teaser.normalTargeting")}</label>{override && <label className="mt-3 flex gap-2 text-xs font-semibold"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>{t("teaser.overrideConfirm")}</label>}<div className="mt-5 flex gap-2"><button onClick={() => setOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-bold">{t("common.cancel")}</button><button disabled={busy || (override && !confirmed)} onClick={() => void create()} className="flex-1 rounded-xl bg-sky-600 py-3 text-sm font-black text-white disabled:opacity-40">{busy ? <Loader2 className="mx-auto animate-spin" size={17}/> : override ? t("teaser.sendWithOverride") : t("teaser.confirmPush")}</button></div></div></div>}
  </section>;
}
