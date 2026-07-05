"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface TestIntegrationPopupProps {
  isOpen: boolean;
  onClose: () => void;
  integrationUrl: string | null;
  botId: number | string;
  onSuccess?: () => void;
}

export default function TestIntegrationPopup({ isOpen, onClose, integrationUrl, botId, onSuccess }: TestIntegrationPopupProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "warning" | "error"; message: string; checks?: Array<{ key: string; label: string; status: "success" | "warning" | "failure"; message: string; diagnostic?: string }> } | null>(null);

  function handleClose() {
    if (testing) return;
    setResult(null);
    onClose();
  }

  async function runTest() {
    if (!integrationUrl) return;
    setTesting(true);
    setResult(null);
    try {
      const response = await apiFetch(`/api/publisher/bots/${botId}/test-integration`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({})) as { message?: string; status?: string; checks?: NonNullable<typeof result>["checks"]; error?: string };
      const type = response.ok && data.status === "success" ? "success" : response.ok && data.status === "warning" ? "warning" : "error";
      setResult({ type, message: data.message || data.error || "Integration diagnostic completed", checks: data.checks });
      if (response.ok && data.status !== "failure") onSuccess?.();
    } catch {
      setResult({ type: "error", message: "Integration diagnostic failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4" aria-modal="true" role="dialog">
          <motion.div
            key="test-integration-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            onClick={handleClose}
            aria-hidden="true"
          />

          <motion.div
            key="test-integration-container"
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
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 size={20} />
                </div>
                <div className="min-w-0 flex-1 pt-1.5">
                  <h3 className="text-[17px] font-black leading-snug text-slate-900">Test Integration</h3>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                    Runs a real diagnostic across AdsGalaxy, Telegram, the integration secret, callback storage, and SDK readiness.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Diagnostic coverage</p>
                <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-600">
                  Endpoint, Telegram getMe, webhook status, encrypted credentials, integration secret, callback write, database state, ownership, and SDK auth readiness.
                </p>
              </div>

              {result && (
                <div className={
                  result.type === "success"
                    ? "rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs font-bold text-emerald-700"
                    : result.type === "warning"
                    ? "rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs font-bold text-amber-700"
                    : "rounded-2xl border border-red-100 bg-red-50 px-3 py-3 text-xs font-bold text-red-700"
                }>
                  {result.message}
                  {result.checks?.length ? (
                    <div className="mt-3 space-y-2">
                      {result.checks.map((item) => {
                        const Icon = item.status === "success" ? CheckCircle2 : item.status === "warning" ? AlertTriangle : XCircle;
                        return (
                          <div key={item.key} className="rounded-xl bg-white/70 p-2 text-slate-700">
                            <div className="flex items-center gap-2 font-black">
                              <Icon size={14} className={item.status === "success" ? "text-emerald-600" : item.status === "warning" ? "text-amber-600" : "text-red-600"} />
                              <span>{item.label}</span>
                            </div>
                            <p className="mt-1 pl-5 text-[11px] font-semibold text-slate-500">{item.message}</p>
                            {item.diagnostic && <p className="mt-1 pl-5 text-[10px] font-mono text-slate-400">{item.diagnostic}</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}

              <button
                type="button"
                disabled={!integrationUrl || testing}
                onClick={runTest}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-black text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {testing ? "Testing..." : "Run Test"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
