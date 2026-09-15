export function logSlowRequest(route: string, startedAt: number, thresholdMs = 1_000) {
  const durationMs = Date.now() - startedAt;
  if (durationMs < thresholdMs) return;
  console.warn(JSON.stringify({ event: "api_timing", route, duration_ms: durationMs }));
}
