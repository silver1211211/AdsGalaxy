"use client";

import { useEffect, useState } from "react";
import { waitForTelegramInitData } from "@/lib/telegramWebApp";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/apiErrorMessage";

export default function MiniAppRewardCallbackPanel({ miniappId }: { miniappId: number }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("disabled");
  const [effectiveStatus, setEffectiveStatus] = useState("disabled_by_publisher");
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
        ? "Active — callback delivery is enabled."
        : effectiveStatus === "saved_platform_disabled"
          ? "Saved — callback delivery is not currently enabled by the platform."
          : effectiveStatus === "schema_unavailable"
            ? "Unavailable — callback database setup is pending."
            : "Disabled by publisher."
    }</p>
    {secret && <div className="mt-3 rounded-xl bg-amber-50 p-3"><code className="break-all text-xs text-amber-900">{secret}</code><button onClick={copySecret} className="mt-2 block text-xs font-black text-amber-700">Copy newly generated secret</button></div>}
    {message && <p className="mt-2 text-[11px] font-semibold text-slate-600">{message}</p>}
  </div>;
}
