import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function clean(value: unknown) {
  return String(value || "").trim();
}

export function proxy(request: NextRequest) {
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
