"use client";

import { useEffect, useState } from "react";
import { waitForTelegramInitData } from "@/lib/telegramWebApp";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/apiErrorMessage";

type CallbackDiagnostics = {
  delivery_summary?: { total: number; delivered: number; pending: number; failed: number };
  latest_attempt?: {
    event_id?: string; status?: string; attempts?: number; attempted_at?: string;
    http_status?: number | null; safe_response?: string | null; last_error?: string | null;
  } | null;
  contract?: {
    event_type?: string;
    payload_format?: Record<string, string>;
    signature?: { canonical_form?: string; algorithm?: string; headers?: string[] };
  };
};

export default function MiniAppRewardCallbackPanel({ miniappId }: { miniappId: number }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("disabled");
  const [effectiveStatus, setEffectiveStatus] = useState("disabled_by_publisher");
  const [statusReason, setStatusReason] = useState("");
  const [diagnostics, setDiagnostics] = useState<CallbackDiagnostics>({});
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    waitForTelegramInitData().then((initData) => fetch(`/api/publisher/miniapps/${miniappId}/reward-callback`, {
      headers: { "x-telegram-init-data": initData },
    })).then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        if (!cancelled && getApiErrorCode(data) === "CALLBACK_SCHEMA_NOT_READY") {
          setEffectiveStatus("schema_unavailable");
        }
        throw new Error(getApiErrorMessage(data, "Could not load reward callback"));
      }
      if (!cancelled) {
        setUrl(data.callback_url || "");
        setStatus(data.configured_status || data.status || "disabled");
        setEffectiveStatus(data.effective_status || "disabled_by_publisher");
        setStatusReason(data.status_reason || "");
        setDiagnostics({ delivery_summary: data.delivery_summary, latest_attempt: data.latest_attempt, contract: data.contract });
      }
    }).catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [miniappId]);

  async function send(method: "PUT" | "POST" | "DELETE", body?: Record<string, unknown>) {
    setBusy(true); setMessage(""); setSecret("");
    try {
      const initData = await waitForTelegramInitData();
      const response = await fetch(`/api/publisher/miniapps/${miniappId}/reward-callback`, {
        method,
        headers: { "Content-Type": "application/json", "x-telegram-init-data": initData },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        if (getApiErrorCode(data) === "CALLBACK_SCHEMA_NOT_READY") setEffectiveStatus("schema_unavailable");
        throw new Error(getApiErrorMessage(data, "Reward callback request failed"));
      }
      setStatus(data.status || status);
      if (data.effective_status) setEffectiveStatus(data.effective_status);
      if (data.status_reason) setStatusReason(data.status_reason);
      if (data.callback_url) setUrl(data.callback_url);
      if (data.signing_secret) setSecret(data.signing_secret);
      setMessage(data.signing_secret ? "Copy this signing secret now. It will not be shown again." : "Reward callback updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reward callback request failed"); }
    finally { setBusy(false); }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(secret);
    setMessage("Signing secret copied. Store it securely.");
  }

  return <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
    <p className="text-sm font-black text-slate-900">Reward callback</p>
    <p className="mt-1 text-[11px] font-medium leading-5 text-slate-500">AdsGalaxy sends this callback after a server-verified completed ad. Store event_id uniquely and credit the user only once.</p>
    <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-slate-400">Callback URL</label>
    <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/adsgalaxy/reward" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
    <div className="mt-3 grid grid-cols-3 gap-2">
      <button disabled={busy || effectiveStatus === "schema_unavailable"} onClick={() => send("PUT", { callback_url: url })} className="rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Save</button>
      <button disabled={busy || status === "disabled" || effectiveStatus === "schema_unavailable"} onClick={() => send("DELETE")} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">Disable</button>
      <button disabled={busy || !url || effectiveStatus === "schema_unavailable"} onClick={() => send("POST", { action: "rotate" })} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">Rotate secret</button>
    </div>
    <p className="mt-2 text-[11px] font-bold text-slate-500">Status: {
      effectiveStatus === "active"
        ? "ACTIVE"
        : effectiveStatus === "saved_platform_disabled"
          ? "SAVED / DISABLED"
          : effectiveStatus === "schema_unavailable"
            ? "UNAVAILABLE"
            : effectiveStatus === "failed_attention"
              ? "FAILED / ATTENTION"
              : "SAVED / DISABLED"
    }</p>
    <p className="mt-1 text-[11px] font-medium text-slate-500">{effectiveStatus === "schema_unavailable" ? "Unavailable — callback database setup is pending." : statusReason}</p>
    {diagnostics.contract && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
      <p><span className="font-black text-slate-800">Event:</span> {diagnostics.contract.event_type}</p>
      <p><span className="font-black text-slate-800">Payload:</span> {Object.keys(diagnostics.contract.payload_format || {}).join(", ")}</p>
      <p><span className="font-black text-slate-800">Signature:</span> {diagnostics.contract.signature?.algorithm} over {diagnostics.contract.signature?.canonical_form}</p>
      <p className="break-words"><span className="font-black text-slate-800">Headers:</span> {(diagnostics.contract.signature?.headers || []).join(", ")}</p>
    </div>}
    {diagnostics.delivery_summary && <p className="mt-2 text-[11px] font-medium text-slate-500">Deliveries: {diagnostics.delivery_summary.delivered} delivered · {diagnostics.delivery_summary.pending} pending · {diagnostics.delivery_summary.failed} failed</p>}
    {diagnostics.latest_attempt && <div className="mt-2 rounded-xl border border-slate-200 p-3 text-[11px] leading-5 text-slate-600">
      <p className="font-black text-slate-800">Latest callback attempt</p>
      <p>Event ID: {diagnostics.latest_attempt.event_id || "—"}</p>
      <p>Status: {diagnostics.latest_attempt.status || "—"} · HTTP {diagnostics.latest_attempt.http_status ?? "—"} · Attempts {diagnostics.latest_attempt.attempts ?? 0}</p>
      <p>Attempted: {diagnostics.latest_attempt.attempted_at ? new Date(diagnostics.latest_attempt.attempted_at).toLocaleString() : "Not yet"}</p>
      {diagnostics.latest_attempt.last_error && <p>Last error: {diagnostics.latest_attempt.last_error}</p>}
      {diagnostics.latest_attempt.safe_response && <p className="break-all">Safe response: {diagnostics.latest_attempt.safe_response}</p>}
    </div>}
    {secret && <div className="mt-3 rounded-xl bg-amber-50 p-3"><code className="break-all text-xs text-amber-900">{secret}</code><button onClick={copySecret} className="mt-2 block text-xs font-black text-amber-700">Copy newly generated secret</button></div>}
    {message && <p className="mt-2 text-[11px] font-semibold text-slate-600">{message}</p>}
  </div>;
}
