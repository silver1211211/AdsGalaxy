"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, Code2, ImagePlus, Italic, Loader2, Pause, Play, Send, Strikethrough, TestTube2, Underline, X, XCircle } from "lucide-react";

type Broadcast = Record<string, any>;
const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0c9de8] focus:ring-4 focus:ring-[#0c9de8]/10";
const badge = (status: string) => status === "completed" ? "bg-emerald-50 text-emerald-700" : ["queued", "running"].includes(status) ? "bg-[#0c9de8]/10 text-[#087fbd]" : ["failed", "cancelled"].includes(status) ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";

export default function AdminBroadcastsPage() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [form, setForm] = useState({ title: "", title_bold: false, message: "", button_text: "", button_url: "", image_path: "" });
  const [imagePreview, setImagePreview] = useState("");
  const [testId, setTestId] = useState("");
  const [target, setTarget] = useState({ target_type: "all_users", target_value: "24", target_unit: "hours" });
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<"upload" | "fetch" | "test" | "send" | "">("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    const response = await fetch("/api/admin/platform-broadcasts", { cache: "no-store" });
    if (response.ok) setItems((await response.json()).broadcasts || []);
  };
  useEffect(() => {
    let timer: number | null = null;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const start = () => { if (timer !== null) window.clearInterval(timer); timer = window.setInterval(refresh, 15_000); };
    refresh(); start();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const active = items.find(item => ["queued", "running", "pausing", "paused"].includes(item.status));
  const progress = useMemo(() => {
    if (!active) return null;
    const total = Number(active.discovered_count || 0), sent = Number(active.sent_live || 0), sending = Number(active.sending_count || 0), queued = Number(active.queued_count || 0);
    return { total, sent, sending, queued, failed: Number(active.failed_live || 0), blocked: Number(active.blocked_live || 0), percent: total ? Math.min(100, sent / total * 100) : 0 };
  }, [active]);

  const wrap = (mark: string) => {
    const element = textarea.current; if (!element) return;
    const start = element.selectionStart, end = element.selectionEnd;
    setForm(current => ({ ...current, message: current.message.slice(0, start) + mark + current.message.slice(start, end) + mark + current.message.slice(end) }));
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + mark.length, end + mark.length); });
  };

  const upload = async (file?: File) => {
    if (!file) return;
    const preview = URL.createObjectURL(file); setImagePreview(preview); setBusy("upload"); setNotice(null);
    const data = new FormData(); data.append("image", file);
    const response = await fetch("/api/admin/platform-broadcasts/image", { method: "POST", body: data }); const result = await response.json();
    setBusy("");
    if (!response.ok) { URL.revokeObjectURL(preview); setImagePreview(""); setNotice({ tone: "error", text: result.error || "Image upload failed." }); return; }
    setForm(current => ({ ...current, image_path: result.path }));
  };

  const fetchRecipients = async () => {
    setBusy("fetch"); setNotice(null); setRecipientCount(null);
    const query = new URLSearchParams({ preview: "1", ...target });
    const response = await fetch(`/api/admin/platform-broadcasts?${query}`, { cache: "no-store" });
    const result = await response.json(); setBusy("");
    if (!response.ok) return setNotice({ tone: "error", text: result.error || "Unable to fetch recipients." });
    setRecipientCount(Number(result.count || 0));
    setNotice({ tone: "ok", text: `${Number(result.count || 0).toLocaleString()} eligible recipient${Number(result.count) === 1 ? "" : "s"} found.` });
  };

  const submit = async (test: boolean) => {
    if (!form.message.trim()) return setNotice({ tone: "error", text: "Enter a message before sending." });
    if (test && !/^[1-9][0-9]{4,19}$/.test(testId.trim())) return setNotice({ tone: "error", text: "Enter a valid Telegram ID for the test recipient." });
    if (!test && recipientCount === null) return setNotice({ tone: "error", text: "Fetch recipients before sending." });
    if (!test && !window.confirm(`Send this broadcast to ${recipientCount?.toLocaleString()} fetched recipient${recipientCount === 1 ? "" : "s"}? Delivery will continue in the background.`)) return;
    setBusy(test ? "test" : "send"); setNotice(null);
    const response = await fetch(`/api/admin/platform-broadcasts${test ? "/test" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, ...(test ? { telegram_id: testId.trim() } : { ...target, confirm: "BROADCAST_RECIPIENTS" }) }) });
    const result = await response.json(); setBusy("");
    setNotice(response.ok ? { tone: "ok", text: test ? "Test message delivered successfully." : "Broadcast queued. Live delivery has started." } : { tone: "error", text: result.error || "Unable to send broadcast." });
    if (response.ok && !test) await load();
  };

  const action = async (name: string) => {
    if (!active) return; if (name === "cancel" && !window.confirm("Cancel all future deliveries? Messages already sent cannot be recalled.")) return;
    const response = await fetch(`/api/admin/platform-broadcasts/${active.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name }) });
    const result = await response.json(); if (!response.ok) setNotice({ tone: "error", text: result.error || "Action failed." }); await load();
  };

  return <AdminLayout><main className="mx-auto max-w-[1240px] space-y-6 pb-10 text-slate-900">
    <header className="flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#0c9de8]">Admin communication</p><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">AdsGalaxy Broadcast</h1><p className="mt-1 text-sm text-slate-500">Compose, test and deliver platform announcements from the official bot.</p></div><div className="text-xs font-semibold text-slate-400">Live updates every 1.5 seconds</div></header>
    {notice && <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}><span>{notice.text}</span><button onClick={() => setNotice(null)}><X size={16}/></button></div>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.05)]"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold">New broadcast</h2><p className="text-xs text-slate-500">Test first, then send to all eligible platform users.</p></div><div className="grid lg:grid-cols-[1.08fr_.92fr]">
      <div className="space-y-5 p-5 lg:border-r lg:border-slate-100 lg:p-6"><div><label className="mb-1.5 block text-xs font-bold text-slate-600">Title <span className="font-normal text-slate-400">(optional)</span></label><div className="flex gap-2"><input className={input} value={form.title} maxLength={255} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Announcement title"/><button onClick={() => setForm({ ...form, title_bold: !form.title_bold })} className={`shrink-0 rounded-xl border px-4 ${form.title_bold ? "border-[#0c9de8] bg-[#0c9de8]/10 text-[#087fbd]" : "border-slate-200 text-slate-500"}`}><Bold size={17}/></button></div></div>
      <div><div className="mb-2 flex items-center justify-between"><label className="text-xs font-bold text-slate-600">Message</label><span className="text-[11px] text-slate-400">{form.message.length}/4000</span></div><div className="mb-2 flex gap-1.5">{[[Bold,"**","Bold"],[Italic,"_","Italic"],[Underline,"__","Underline"],[Strikethrough,"~~","Strike"],[Code2,"`","Code"]].map(([Icon,mark,label]:any)=><button key={label} title={label} onClick={() => wrap(mark)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-[#0c9de8] hover:text-[#0c9de8]"><Icon size={15}/></button>)}</div><textarea ref={textarea} className={`${input} min-h-48 resize-y`} value={form.message} maxLength={4000} onChange={event => setForm({ ...form, message: event.target.value })} placeholder="Write your announcement…"/></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 text-sm font-semibold text-slate-600 transition hover:border-[#0c9de8] hover:text-[#0c9de8]"><ImagePlus size={17}/>{busy === "upload" ? "Uploading…" : form.image_path ? "Replace image" : "Add image"}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={event => upload(event.target.files?.[0])}/></label>{form.image_path && <button onClick={() => { setForm({ ...form, image_path: "" }); setImagePreview(""); }} className="rounded-xl border border-slate-200 text-sm font-semibold text-slate-500">Remove image</button>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><input className={input} value={form.button_text} maxLength={80} onChange={event => setForm({ ...form, button_text: event.target.value })} placeholder="Button text (optional)"/><input className={input} value={form.button_url} onChange={event => setForm({ ...form, button_url: event.target.value })} placeholder="https://…"/></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><label className="mb-3 block text-xs font-bold text-slate-600">Recipients</label><div className="grid gap-2 sm:grid-cols-[1fr_110px_120px_auto]"><select className={input} value={target.target_type} onChange={event => { setTarget({ ...target, target_type: event.target.value }); setRecipientCount(null); }}><option value="all_users">Everybody</option><option value="joined_within">Joined within the last</option><option value="active_within">Active within the last</option></select>{target.target_type !== "all_users" && <><input className={input} inputMode="numeric" value={target.target_value} onChange={event => { setTarget({ ...target, target_value: event.target.value.replace(/\D/g, "") }); setRecipientCount(null); }} aria-label="Time window"/><select className={input} value={target.target_unit} onChange={event => { setTarget({ ...target, target_unit: event.target.value }); setRecipientCount(null); }}><option value="seconds">Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option></select></>}<button disabled={Boolean(busy)} onClick={fetchRecipients} className="min-h-12 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white disabled:opacity-50">{busy === "fetch" ? <Loader2 className="mx-auto animate-spin" size={17}/> : "Fetch"}</button></div><p className="mt-2 text-[11px] text-slate-500">{recipientCount === null ? "Choose a group and fetch the current eligible users." : `${recipientCount.toLocaleString()} users selected and ready to receive this broadcast.`}</p></div>
      <div className="rounded-xl bg-slate-50 p-3"><label className="mb-2 block text-xs font-bold text-slate-600">Test recipient Telegram ID</label><div className="flex flex-col gap-2 sm:flex-row"><input className={input} inputMode="numeric" value={testId} onChange={event => setTestId(event.target.value.replace(/\D/g, ""))} placeholder="Enter Telegram ID"/><button disabled={Boolean(busy)} onClick={() => submit(true)} className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#0c9de8] px-5 text-sm font-bold text-[#087fbd] disabled:opacity-50">{busy === "test" ? <Loader2 className="animate-spin" size={17}/> : <TestTube2 size={17}/>}Test send</button></div><p className="mt-2 text-[11px] text-slate-400">The ID must belong to an AdsGalaxy user who has started the official bot. Telegram errors are shown here.</p></div>
      <button disabled={Boolean(busy) || Boolean(active) || recipientCount === null || recipientCount === 0} onClick={() => submit(false)} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#0c9de8] px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-[#0c9de8]/20 transition hover:bg-[#078bcf] disabled:cursor-not-allowed disabled:opacity-50"><Send size={18}/>{active ? "A broadcast is already active" : target.target_type === "all_users" ? "Send to everybody" : "Send to fetched users"}</button></div>

      <div className="bg-slate-50/70 p-5 lg:p-6"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold">Message preview</h3><p className="text-[11px] text-slate-400">Telegram-style preview</p></div>{form.image_path && <span className="rounded-full bg-[#0c9de8]/10 px-2 py-1 text-[10px] font-bold text-[#087fbd]">Image attached</span>}</div><div className="flex min-h-[420px] items-center justify-center rounded-2xl bg-[#dfe9ee] p-4"><div className="w-full max-w-[390px] overflow-hidden rounded-2xl bg-white shadow-md">{(imagePreview || form.image_path) && <img src={imagePreview || form.image_path} alt="Selected broadcast" className="max-h-72 w-full object-cover" onError={() => setNotice({ tone: "error", text: "The selected image preview could not be loaded. Please upload it again." })}/>}<div className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-5">{form.title && <div className={form.title_bold ? "font-bold" : ""}>{form.title}</div>}{form.title && form.message && <div className="h-2"/>}<div>{form.message || <span className="text-slate-400">Your message will appear here.</span>}</div></div>{form.button_text && <div className="border-t border-slate-100 px-3 py-2.5 text-center text-sm font-bold text-[#0c9de8]">{form.button_text}</div>}</div></div></div>
    </div></section>

    {active && progress && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${badge(active.status)}`}>{active.status}</span><span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"/>Live</span></div><h2 className="mt-2 text-lg font-black">Current delivery</h2></div><div className="flex gap-2">{active.status === "paused" ? <button onClick={() => action("resume")} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold"><Play size={16}/>Resume</button> : <button onClick={() => action("pause")} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold"><Pause size={16}/>Pause</button>}<button onClick={() => action("cancel")} className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600"><XCircle size={16}/>Cancel</button></div></div><div className="mt-5"><div className="mb-2 flex items-end justify-between"><span className="text-xs font-semibold text-slate-500">Delivery progress</span><span className="text-2xl font-black text-[#0c9de8]">{progress.percent.toFixed(1)}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#0c9de8] transition-[width] duration-700 ease-out" style={{ width: `${progress.percent}%` }}/></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[["Recipients",progress.total],["Sent",progress.sent],["Sending",progress.sending],["Queued",progress.queued],["Failed",progress.failed],["Blocked",progress.blocked]].map(([label,value])=><div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-lg font-black">{Number(value).toLocaleString()}</p></div>)}</div></div></section>}

    <section><div className="mb-3"><h2 className="text-lg font-black">Broadcast history</h2><p className="text-xs text-slate-500">Recent platform broadcasts and delivery results.</p></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{items.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">No broadcasts yet.</div> : items.map((item, index) => { const total=Number(item.discovered_count||0),sent=Number(item.sent_live||0),remaining=Number(item.queued_count||0)+Number(item.sending_count||0); return <article key={item.id} className={`grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5 ${index ? "border-t border-slate-100" : ""}`}><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold">{item.title || "Untitled announcement"}</h3><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase ${badge(item.status)}`}>{item.status}</span></div><p className="mt-1 text-[11px] text-slate-400">{new Date(item.created_at).toLocaleString()} · {item.created_by || "Admin"}</p></div><div className="grid grid-cols-3 gap-4 text-right text-xs sm:min-w-72"><div><p className="text-slate-400">Recipients</p><b>{total.toLocaleString()}</b></div><div><p className="text-slate-400">Sent</p><b className="text-emerald-600">{sent.toLocaleString()}</b></div><div><p className="text-slate-400">Remaining</p><b>{remaining.toLocaleString()}</b></div></div></article> })}</div></section>
  </main></AdminLayout>;
}
