"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, UserPlus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

type BulkAddResult = { newlyAdded: number; alreadyAdded: number; invalid: number };

function parseIds(value: string) {
  const tokens = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const unique = [...new Set(tokens)];
  return { unique, numeric: unique.filter((id) => /^[1-9]\d{4,19}$/.test(id)), invalid: unique.filter((id) => !/^[1-9]\d{4,19}$/.test(id)) };
}

interface ManualAddUsersPopupProps {
  isOpen: boolean;
  onClose: () => void;
  botId: number | string;
  onAdded?: () => void;
}

export default function ManualAddUsersPopup({ isOpen, onClose, botId, onAdded }: ManualAddUsersPopupProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BulkAddResult | null>(null);
  const [queued, setQueued] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parsed = parseIds(input);

  function handleClose() {
    if (loading || queued) return;
    setInput("");
    setError("");
    setResult(null);
    onClose();
  }

  async function handleAdd() {
    if (loading || queued || parsed.numeric.length === 0) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await apiFetch(`/api/publisher/bots/${botId}/users`, {
        method: "POST",
        body: JSON.stringify({ chat_ids: parsed.numeric }),
      });
      const data = await response.json().catch(() => ({})) as BulkAddResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to add users");
      setResult(data);
      setInput("");
      setQueued(true);
      closeTimer.current = setTimeout(() => {
        setQueued(false);
        setResult(null);
        onClose();
        onAdded?.();
      }, 1200);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4" aria-modal="true" role="dialog">
          <motion.div
            key="add-users-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            onClick={handleClose}
            aria-hidden="true"
          />

          <motion.div
            key="add-users-container"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="relative flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)]"
          >
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            >
              <X size={16} />
            </button>

            <div className="space-y-5 overflow-y-auto p-6">
              <div className="flex items-start gap-4 pr-10">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#0c9de8]">
                  <UserPlus size={20} />
                </div>
                <div className="min-w-0 flex-1 pt-1.5">
                  <h3 className="text-[17px] font-black leading-snug text-slate-900">Manually Add Users</h3>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                    Users are added for verification. AdsGalaxy will automatically verify message delivery before activating them.
                  </p>
                </div>
              </div>

              {queued ? (
                <div className="flex min-h-36 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 px-4 text-center text-sm font-black text-emerald-700">
                  User verification in progress...
                </div>
              ) : <textarea
                value={input}
                onChange={(event) => { setInput(event.target.value); setResult(null); setError(""); }}
                rows={5}
                placeholder={"12345, 67890\n99887"}
                className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-[#0c9de8] focus:bg-white focus:ring-4 focus:ring-[#0c9de8]/10"
              />}

              {!queued && <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">{parsed.unique.length} unique</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">{parsed.numeric.length} numeric</span>
                {parsed.invalid.length > 0 && (
                  <span className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">{parsed.invalid.length} invalid format</span>
                )}
              </div>}

              {error && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-3 py-3 text-xs font-bold text-red-700">{error}</div>
              )}

              {result && !queued && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Added</p>
                    <p className="mt-1 text-lg font-black text-emerald-700">{result.newlyAdded}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Existing</p>
                    <p className="mt-1 text-lg font-black text-slate-700">{result.alreadyAdded}</p>
                  </div>
                  <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-red-500">Invalid</p>
                    <p className="mt-1 text-lg font-black text-red-700">{result.invalid}</p>
                  </div>
                </div>
              )}

              {!queued && <button
                type="button"
                disabled={loading || parsed.numeric.length === 0}
                onClick={handleAdd}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0c9de8] py-3.5 text-sm font-black text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                {loading ? "Adding..." : "Add Users"}
              </button>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
