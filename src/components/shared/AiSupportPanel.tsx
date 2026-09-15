"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bot, Send, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTranslations } from "@/i18n/client";

type Message = { role: "USER" | "ASSISTANT"; content: string };

export function renderSafeLinks(content: string) {
  return content.split(/(https?:\/\/[^\s]+)/gi).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return part;
    const match = part.match(/^(.*?)([.,!?;:]+)?$/);
    const url = match?.[1] ?? part;
    const punctuation = match?.[2] ?? "";
    return <React.Fragment key={`${url}-${index}`}><a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{url}</a>{punctuation}</React.Fragment>;
  });
}

function errorKey(status: number, code: string) {
  if (status === 429 && code === "DAILY_CAPACITY_REACHED") return "aiSupport.error.capacity" as const;
  if (status === 429) return "aiSupport.error.rateLimited" as const;
  if (status === 413) return "aiSupport.error.tooLarge" as const;
  if (status === 422) return "aiSupport.error.invalid" as const;
  return "aiSupport.error.generic" as const;
}

export default function AiSupportPanel() {
  const { t } = useTranslations();
  const [messages, setMessages] = useState<Message[]>([]);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ message: string; requestId: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController(); abortRef.current = controller;
    apiFetch("/api/ai-support", { signal: controller.signal, timeoutMs: 30000 }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("load");
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    }).catch((cause) => { if (cause?.name !== "AbortError") setError(t("aiSupport.error.generic")); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [t]);

  async function sendMessage(retry?: { message: string; requestId: string }) {
    const message = retry?.message || value.trim(); if (!message || sending) return;
    const requestId = retry?.requestId || crypto.randomUUID();
    setValue(""); setError(null); setNotice(null); setRetryRequest(null); setSending(true);
    if (!retry) setMessages((current) => [...current, { role: "USER", content: message }]);
    try {
      const response = await apiFetch("/api/ai-support", { method: "POST", body: JSON.stringify({ message, requestId }), timeoutMs: 30000 });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(t(errorKey(response.status, String(data.error || "")))); setRetryRequest({ message, requestId }); return; }
      setMessages((current) => [...current, { role: "ASSISTANT", content: data.message }]);
    } catch { setError(t("aiSupport.error.generic")); setRetryRequest({ message, requestId }); }
    finally { setSending(false); }
  }

  async function clearConversation() {
    setConfirmClear(false); setError(null); setNotice(null);
    try {
      const response = await apiFetch("/api/ai-support", { method: "DELETE", timeoutMs: 30000 });
      if (!response.ok) throw new Error("clear");
      setMessages([]); setRetryRequest(null); setNotice(t("aiSupport.cleared"));
    } catch { setError(t("aiSupport.error.generic")); }
  }

  return <section className="mx-auto flex h-[calc(100dvh-6rem)] min-h-[28rem] max-w-3xl flex-col lg:h-[calc(100dvh-8rem)]">
    <div className="mb-2 shrink-0"><h1 className="text-xl font-black leading-tight text-slate-900 sm:text-2xl">{t("aiSupport.title")}</h1><p className="mt-0.5 text-sm leading-5 text-slate-500">{t("aiSupport.subtitle")}</p></div>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 sm:p-4" aria-live="polite">
        {loading && <p className="text-sm text-slate-500">{t("aiSupport.loading")}</p>}
        {!loading && messages.length === 0 && <div className="flex h-full min-h-48 flex-col items-center justify-center px-4 text-center"><Bot className="mb-2 text-[#0c9de8]" size={32}/><p className="font-semibold text-slate-700">{t("aiSupport.welcome")}</p><p className="mt-0.5 text-sm text-slate-500">{t("aiSupport.empty")}</p></div>}
        {messages.map((message, index) => <div key={index} className={`flex ${message.role === "USER" ? "justify-end" : "justify-start"}`}><div className={`w-fit max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-5 sm:max-w-[76%] ${message.role === "USER" ? "rounded-br-md bg-[#0c9de8] text-white" : "rounded-bl-md bg-slate-100 text-slate-800"}`}>{renderSafeLinks(message.content)}</div></div>)}
        {sending && <p className="text-sm font-medium text-[#0c9de8]">{t("aiSupport.responding")}</p>}
        {notice && <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
        {error && <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><span>{error}</span>{retryRequest && <button onClick={() => void sendMessage(retryRequest)} className="font-bold underline">{t("aiSupport.retry")}</button>}</div>}
      </div>
      <div className="shrink-0 border-t border-slate-100 p-2.5 sm:p-3">
        <div className="mb-1.5 flex min-h-6 justify-end">{confirmClear ? <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs"><span>{t("aiSupport.clearConfirm")}</span><button onClick={() => setConfirmClear(false)} className="rounded-lg px-2 py-1">{t("aiSupport.cancel")}</button><button onClick={clearConversation} className="rounded-lg bg-red-600 px-2 py-1 text-white">{t("aiSupport.clear")}</button></div> : <button onClick={() => setConfirmClear(true)} disabled={!messages.length} className="flex items-center gap-1 text-xs font-semibold text-slate-500 disabled:opacity-40"><Trash2 size={13}/>{t("aiSupport.clear")}</button>}</div>
        <div className="flex items-end gap-2"><textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} maxLength={4000} rows={1} placeholder={t("aiSupport.placeholder")} className="min-h-11 max-h-24 min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm leading-5 outline-none focus:border-[#0c9de8]"/><button onClick={() => void sendMessage()} disabled={sending || !value.trim()} aria-label={t("aiSupport.send")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0c9de8] text-white disabled:opacity-40"><Send size={17}/></button></div>
      </div>
    </div>
  </section>;
}
