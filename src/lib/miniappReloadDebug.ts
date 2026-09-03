"use client";

export type MiniappReloadDebugDetails = Record<string, string | number | boolean | null | undefined>;

export function miniappReloadDebug(event: string, details: MiniappReloadDebugDetails = {}) {
  // Production diagnostics are opt-in: unconditional telemetry created one
  // extra request and two log entries for every instrumented Mini App event.
  if (process.env.NEXT_PUBLIC_MINIAPP_RELOAD_DEBUG !== "1") return;
  const payload = { event, timestamp: new Date().toISOString(), ...details };
  console.info("[MINIAPP_RELOAD_DEBUG]", payload);
  if (typeof window === "undefined") return;
  void fetch("/api/debug/miniapp-reload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}
