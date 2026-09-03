import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|0:0:0:0:0:0:0:1)$/i;
const VALID_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function validPublicHttpsUrl(parsed: URL) {
  const hostname = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:"
    && !parsed.username
    && !parsed.password
    && (!parsed.port || parsed.port === "443")
    && !hostname.endsWith(".")
    && VALID_HOSTNAME.test(hostname)
    && !BLOCKED_HOSTNAMES.test(hostname);
}

async function resolvesToPublicAddress(hostname: string) {
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS_TIMEOUT")), 2_000)),
  ]);
  if (addresses.length === 0) return false;
  return addresses.every(({ address }) => !BLOCKED_HOSTNAMES.test(address)
    && !/^fc|^fd|^fe8|^fe9|^fea|^feb/i.test(address.replaceAll(":", "")));
}

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

    if (!validPublicHttpsUrl(parsed)) {
      return NextResponse.json({ error: "Enter a valid public HTTPS URL" }, { status: 400 });
    }

    if (!(await resolvesToPublicAddress(parsed.hostname))) {
      return NextResponse.json({ error: "URL host is not publicly reachable" }, { status: 422 });
    }

    const res = await fetch(parsed.toString(), {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
      redirect: "manual",
    });

    if (res.ok) {
      return NextResponse.json({ ok: true, status: res.status });
    }

    return NextResponse.json(
      { error: `URL returned ${res.status} ${res.statusText}` },
      { status: 422 }
    );
  } catch (error: any) {
    const authStatus = getAuthErrorStatus(error);
    if (authStatus === 403) {
      return NextResponse.json({ error: "Unauthorized" }, { status: authStatus });
    }
    console.warn("Verify URL validation failed", {
      code: "URL_VERIFICATION_FAILED",
      reason: String(error?.name || "FETCH_FAILED"),
    });
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return NextResponse.json({ error: "URL timed out — check if it is reachable" }, { status: 422 });
    }
    return NextResponse.json({ error: "Could not reach URL" }, { status: 422 });
  }
}
