import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PREVIEW_COOKIE_NAME,
  PREVIEW_HOSTNAME,
  verifyPreviewSessionToken,
} from "@/lib/previewAuth";

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
    || hostname === PREVIEW_HOSTNAME;
}

function isLocalMiniappDevAllowed(request: NextRequest) {
  const hostname = requestHostname(request);
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_LOCAL_MINIAPP_DEV === "true"
    && isApprovedMiniappDevHost(hostname);
}

function isReadOnlyOwnerPreview(request: NextRequest, initData: string) {
  if (requestHostname(request) === PREVIEW_HOSTNAME) return true;
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
    || request.nextUrl.pathname === "/api/admin/login"
    || request.nextUrl.pathname === "/api/preview/login"
    || request.nextUrl.pathname === "/api/preview/logout";
}

function isPreviewAuthProtectedHost(hostname: string): boolean {
  if (process.env.PREVIEW_AUTH_ENABLED === "true") return true;
  return hostname === PREVIEW_HOSTNAME;
}

function isExemptFromPreviewAuth(pathname: string): boolean {
  if (
    pathname === "/preview-login" ||
    pathname === "/api/preview/login" ||
    pathname === "/api/preview/logout" ||
    pathname === "/api/preview/session" ||
    pathname.startsWith("/_next/webpack-hmr") ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/fonts/")
  ) {
    return true;
  }
  return false;
}

export function proxy(request: NextRequest) {
  const hostname = requestHostname(request);
  const pathname = request.nextUrl.pathname;

  // ── 1. PREVIEW PASSWORD PROTECTION ──────────────────────────────────────────
  if (isPreviewAuthProtectedHost(hostname) && !isExemptFromPreviewAuth(pathname)) {
    const sessionCookie = request.cookies.get(PREVIEW_COOKIE_NAME)?.value;
    const isAuthenticated = verifyPreviewSessionToken(sessionCookie);

    if (!isAuthenticated) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            error: "Preview authentication required",
            code: "PREVIEW_UNAUTHENTICATED",
            loginUrl: "/preview-login",
          },
          { status: 401 }
        );
      }

      const destination = pathname + request.nextUrl.search;
      const loginUrl = new URL(
        `/preview-login?redirect=${encodeURIComponent(destination)}`,
        request.url
      );
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── 2. DEV MINIAPP & CRON ROUTE CHECKS ──────────────────────────────────────
  if (pathname.startsWith("/dev/miniapp") && !isLocalMiniappDevAllowed(request)) {
    return new NextResponse(null, { status: 404 });
  }

  const initData = request.headers.get("x-telegram-init-data") || "";
  if (initData.startsWith(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX) && !isLocalMiniappDevAllowed(request)) {
    return NextResponse.json({ error: "Local Mini App dev auth is unavailable" }, { status: 401 });
  }

  // ── 3. PREVIEW SAFETY: STRICT READ-ONLY ON SENSITIVE MUTATING ENDPOINTS ─────
  if (
    pathname.startsWith("/api/")
    && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())
    && isLocalMiniappDevAllowed(request)
    && isReadOnlyOwnerPreview(request, initData)
    && !isSafeReadOnlyPreviewPost(request)
  ) {
    return NextResponse.json(
      { error: "Preview account is read-only", code: "PREVIEW_READ_ONLY" },
      { status: 403 }
    );
  }

  // ── 4. CRON SECRET PROTECTION ───────────────────────────────────────────────
  if (pathname.startsWith("/api/cron/")) {
    const secret = clean(process.env.CRON_SECRET);
    const supplied = clean(request.headers.get("x-cron-secret"));
    if (!secret) {
      return NextResponse.json({ error: "Cron secret is not configured" }, { status: 503 });
    }
    if (!supplied || supplied !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── 5. OWNER PREVIEW HEADER INJECTION ───────────────────────────────────────
  const requestHeaders = new Headers(request.headers);
  if (
    hostname === PREVIEW_HOSTNAME
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
