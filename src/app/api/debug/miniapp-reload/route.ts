import { NextResponse } from "next/server";

const ALLOWED_KEYS = new Set([
  "event", "timestamp", "route", "phase", "result", "error_name", "error_message",
  "status", "duration_ms", "waited_ms", "telegram_window_present", "webapp_present",
  "webapp_init_data_present", "cached_init_data_present", "init_data_present",
]);

function safeValue(value: unknown) {
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 160);
  return null;
}

export async function POST(request: Request) {
  if (process.env.MINIAPP_RELOAD_DEBUG !== "1") {
    return new NextResponse(null, { status: 204 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4096) return NextResponse.json({ ok: false }, { status: 413 });
  const input = await request.json().catch(() => ({}));
  const diagnostic: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input && typeof input === "object" ? input : {})) {
    if (ALLOWED_KEYS.has(key)) diagnostic[key] = safeValue(value);
  }
  console.info("[MINIAPP_RELOAD_DEBUG]", diagnostic);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
