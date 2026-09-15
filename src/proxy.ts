import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX = "adsgalaxy-local-miniapp-dev:";

function clean(value: unknown) {
  return String(value || "").trim();
}

function hostnameFromHostHeader(host: string | null) {
  return clean(host).toLowerCase().replace(/:\d+$/, "");
}

function requestHostname(request: NextRequest) {
  const forwardedHost = clean(request.headers.get("x-forwarded-host")).split(",")[0]?.trim() || "";
  return hostnameFromHostHeader(forwardedHost || request.headers.get("host"));
}

function isApprovedMiniappDevHost(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "preview.adsgalaxy.online";
}

function isLocalMiniappDevAllowed(request: NextRequest) {
  const hostname = requestHostname(request);
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_LOCAL_MINIAPP_DEV === "true"
    && isApprovedMiniappDevHost(hostname);
}

function isReadOnlyOwnerPreview(request: NextRequest, initData: string) {
  if (requestHostname(request) === "preview.adsgalaxy.online") return true;
  if (!initData.startsWith(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX)) return false;

  try {
    const encoded = initData.slice(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX.length);
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { user?: unknown };
    return payload.user === "silver";
  } catch {
    return false;
  }
}

function buildOwnerPreviewInitData() {
  const payload = btoa(JSON.stringify({ user: "silver", ref: "" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX}${payload}`;
}

function isSafeReadOnlyPreviewPost(request: NextRequest) {
  if (request.method.toUpperCase() !== "POST") return false;
  return request.nextUrl.pathname === "/api/advertiser/channel-growth/verify"
    || request.nextUrl.pathname === "/api/admin/login";
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/dev/miniapp") && !isLocalMiniappDevAllowed(request)) {
    return new NextResponse(null, { status: 404 });
  }

  const initData = request.headers.get("x-telegram-init-data") || "";
  if (initData.startsWith(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX) && !isLocalMiniappDevAllowed(request)) {
    return NextResponse.json({ error: "Local Mini App dev auth is unavailable" }, { status: 401 });
  }

  if (
    request.nextUrl.pathname.startsWith("/api/")
    && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())
    && isLocalMiniappDevAllowed(request)
    && isReadOnlyOwnerPreview(request, initData)
    && !isSafeReadOnlyPreviewPost(request)
  ) {
    return NextResponse.json({ error: "Preview account is read-only", code: "PREVIEW_READ_ONLY" }, { status: 403 });
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

  const requestHeaders = new Headers(request.headers);
  if (
    requestHostname(request) === "preview.adsgalaxy.online"
    && initData.startsWith(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX)
    && isLocalMiniappDevAllowed(request)
  ) {
    requestHeaders.set("x-telegram-init-data", buildOwnerPreviewInitData());
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
