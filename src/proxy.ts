import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX = "adsgalaxy-local-miniapp-dev:";

function clean(value: unknown) {
  return String(value || "").trim();
}

function hostnameFromHostHeader(host: string | null) {
  return clean(host).toLowerCase().replace(/:\d+$/, "");
}

function isLocalMiniappDevAllowed(request: NextRequest) {
  const hostname = hostnameFromHostHeader(request.headers.get("host"));
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_LOCAL_MINIAPP_DEV === "true"
    && (hostname === "localhost" || hostname === "127.0.0.1");
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/dev/miniapp") && !isLocalMiniappDevAllowed(request)) {
    return new NextResponse(null, { status: 404 });
  }

  const initData = request.headers.get("x-telegram-init-data") || "";
  if (initData.startsWith(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX) && !isLocalMiniappDevAllowed(request)) {
    return NextResponse.json({ error: "Local Mini App dev auth is unavailable" }, { status: 401 });
  }

  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    const secret = clean(process.env.CRON_SECRET);
    const supplied = clean(request.headers.get("x-cron-secret"));
    if (!secret) {
      return NextResponse.json({ error: "Cron secret is not configured" }, { status: 503 });
    }
    if (!supplied || supplied !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
