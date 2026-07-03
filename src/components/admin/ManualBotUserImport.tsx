"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Loader2, UserPlus, Users } from "lucide-react";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

type ImportResult = {
  total_submitted: number;
  valid: number;
  added: number;
  updated: number;
  invalid: number;
  duplicate: number;
  failed_ids: Array<{ id: string; reason: string }>;
};

type HistoryItem = {
  id: number;
  admin_id: number | null;
  admin_username: string | null;
  metadata: string | ImportResult | null;
  created_at: string;
};

function parseInput(value: string) {
  const tokens = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const unique = [...new Set(tokens)];
  return { unique, numeric: unique.filter((id) => /^[1-9]\d{4,19}$/.test(id)), invalid: unique.filter((id) => !/^[1-9]\d{4,19}$/.test(id)) };
}

function historyResult(value: HistoryItem["metadata"]): Partial<ImportResult> {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value) as Partial<ImportResult>; } catch { return {}; }
}

export default function ManualBotUserImport({ botId, onImported }: { botId: number; onImported?: () => void }) {
  const [input, setInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifiedCount, setVerifiedCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const parsed = useMemo(() => parseInput(input), [input]);

  const loadHistory = useCallback(async () => {
    const response = await fetch(`/api/admin/bots/${botId}/users/manual`, { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as { history?: HistoryItem[] };
    if (response.ok) setHistory(Array.isArray(data.history) ? data.history : []);
  }, [botId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  async function importUsers() {
    setConfirming(false);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/admin/bots/${botId}/users/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: input }),
      });
      const data = await response.json().catch(() => ({})) as ImportResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      setInput("");
      await loadHistory();
      onImported?.();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  async function verifyUsers() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/admin/bots/${botId}/users/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: input, dry_run: true }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; valid?: number; failed_ids?: Array<{ id: string; reason: string }> };
      if (!response.ok) throw new Error(data.error || "Verification failed");
      const valid = Number(data.valid || 0);
      setVerifiedCount(valid);
      if (valid === 0) {
        setError(data.failed_ids?.[0]?.reason || "No Telegram-valid users were found");
        return;
      }
      setConfirming(true);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/40">
      <ConfirmationModal isOpen={confirming} onClose={() => setConfirming(false)} onConfirm={importUsers} title="Confirm Bot User Import" message={`You are about to add ${verifiedCount || 0} valid users to this bot.`} confirmBtnText="Add Users" isLoading={loading} />
      <div className="border-b border-blue-100 bg-white/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200"><UserPlus size={18} /></span>
          <div><h4 className="text-sm font-black text-slate-900">Manually Add Bot Users</h4><p className="mt-1 text-xs leading-5 text-slate-500">Paste up to 100 Telegram user IDs. Each ID is verified with this bot before saving.</p></div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <textarea value={input} onChange={(event) => { setInput(event.target.value); setVerifiedCount(null); }} rows={6} placeholder={"12345, 67890\n99887\n55661 44332"} className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">{parsed.unique.length} unique</span>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">{parsed.numeric.length} numeric</span>
          {parsed.invalid.length > 0 && <span className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">{parsed.invalid.length} invalid format</span>}
        </div>
        {parsed.invalid.length > 0 && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700"><span className="font-black">Rejected values:</span> {parsed.invalid.join(", ")}</div>}
        {error && <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-700"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</div>}
        <button type="button" disabled={loading || parsed.numeric.length === 0 || parsed.unique.length > 100} onClick={verifyUsers} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <UserPlus size={17} />}{loading ? "Verifying with Telegram..." : "Verify Users"}
        </button>

        {result && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-emerald-800"><CheckCircle2 size={17} />Import completed</div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[['Submitted', result.total_submitted], ['Added', result.added], ['Updated', result.updated], ['Duplicates', result.duplicate], ['Invalid', result.invalid]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white p-2.5 text-center"><p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-lg font-black text-slate-900">{value}</p></div>)}
            </div>
            {result.failed_ids.length > 0 && <div className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-xl bg-white p-3">{result.failed_ids.map((item) => <p key={`${item.id}-${item.reason}`} className="text-xs text-red-700"><span className="font-black">{item.id}</span> — {item.reason}</p>)}</div>}
          </div>
        )}

        <div className="border-t border-slate-200/70 pt-4">
          <div className="mb-3 flex items-center gap-2"><Clock3 size={14} className="text-slate-400" /><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recent manual imports</p></div>
          {history.length === 0 ? <p className="rounded-xl bg-white p-3 text-xs text-slate-400">No manual imports recorded for this bot.</p> : <div className="space-y-2">{history.map((item) => { const summary = historyResult(item.metadata); return <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><Users size={14} className="text-blue-500" /><span className="text-xs font-bold text-slate-700">{summary.added || 0} added, {summary.updated || 0} updated, {summary.invalid || 0} invalid</span></div><span className="text-[10px] font-semibold text-slate-400">{item.admin_username || `Admin #${item.admin_id || "—"}`} · {new Date(item.created_at).toLocaleString()}</span></div>; })}</div>}
        </div>
      </div>
    </section>
  );
}
