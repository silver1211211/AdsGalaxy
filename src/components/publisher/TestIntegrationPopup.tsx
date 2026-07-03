"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, X } from "lucide-react";

interface TestIntegrationPopupProps {
  isOpen: boolean;
  onClose: () => void;
  integrationUrl: string | null;
  botId: number | string;
  onSuccess?: () => void;
}

export default function TestIntegrationPopup({ isOpen, onClose, integrationUrl, botId, onSuccess }: TestIntegrationPopupProps) {
  const [testUserId, setTestUserId] = useState("");
  const [testUsername, setTestUsername] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function handleClose() {
    if (testing) return;
    setTestUserId("");
    setTestUsername("");
    setResult(null);
    onClose();
  }

  async function runTest() {
    if (!integrationUrl || !testUserId) return;
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch(integrationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test: true,
          bot_id: String(botId),
          telegram_user_id: testUserId || undefined,
          username: testUsername || undefined,
          timestamp: Math.floor(Date.now() / 1000),
          request_id: `test-${botId}-${Date.now()}-${crypto.randomUUID()}`,
        }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      setResult({ type: response.ok ? "success" : "error", message: data.message || "Unknown response" });
      if (response.ok) onSuccess?.();
    } catch {
      setResult({ type: "error", message: "Integration test failed" });
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
                    Runs a test log only. No bot user is created.
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                <input
                  value={testUserId}
                  onChange={(event) => setTestUserId(event.target.value.replace(/[^0-9-]/g, ""))}
                  placeholder="telegram_user_id"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-[#0c9de8] focus:bg-white focus:ring-4 focus:ring-[#0c9de8]/10"
                />
                <input
                  value={testUsername}
                  onChange={(event) => setTestUsername(event.target.value)}
                  placeholder="username (optional)"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-[#0c9de8] focus:bg-white focus:ring-4 focus:ring-[#0c9de8]/10"
                />
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Expected success response</p>
                <code className="mt-2 block break-all text-[10px] text-slate-700">{`{"success":true,"message":"Integration test successful","test":true}`}</code>
              </div>

              {result && (
                <div className={
                  result.type === "success"
                    ? "rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs font-bold text-emerald-700"
                    : "rounded-2xl border border-red-100 bg-red-50 px-3 py-3 text-xs font-bold text-red-700"
                }>
                  {result.message}
                </div>
              )}

              <button
                type="button"
                disabled={!integrationUrl || !testUserId || testing}
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
