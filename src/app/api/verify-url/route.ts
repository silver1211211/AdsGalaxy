import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

const BLOCKED_HOSTNAMES = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|0:0:0:0:0:0:0:1)$/i;

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    await getAuthenticatedUser(initData);

    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url")?.trim();

    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Only HTTPS URLs are allowed" }, { status: 400 });
    }

    if (BLOCKED_HOSTNAMES.test(parsed.hostname)) {
      return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
    }

    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });

    if (res.ok) {
      return NextResponse.json({ ok: true, status: res.status });
    }

    return NextResponse.json(
      { error: `URL returned ${res.status} ${res.statusText}` },
      { status: 422 }
    );
  } catch (error: any) {
    console.error("Verify URL error:", error);
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return NextResponse.json({ error: "URL timed out — check if it is reachable" }, { status: 422 });
    }
    const status = getAuthErrorStatus(error);
    if (status === 403) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not reach URL" }, { status: 422 });
  }
}
