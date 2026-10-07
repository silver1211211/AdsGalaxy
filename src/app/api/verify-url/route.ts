import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { authenticatePublisherAsset, PublisherAssetError, publisherAssetErrorResponse } from "@/lib/publisherAssetOnboarding";

const BLOCKED = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe[89ab])/i;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_REDIRECTS = 3;

function safeUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new PublisherAssetError("INVALID_URL", "Enter a valid public HTTPS URL."); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443") || !HOST.test(hostname) || BLOCKED.test(hostname)) throw new PublisherAssetError("INVALID_URL", "Enter a valid public HTTPS URL.");
  return parsed;
}

async function assertPublicDns(hostname: string) {
  let addresses: Array<{ address: string }>;
  try { addresses = await Promise.race([lookup(hostname, { all: true, verbatim: true }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("dns_timeout")), 2_000))]); }
  catch { throw new PublisherAssetError("URL_TEMPORARILY_UNAVAILABLE", "URL host lookup is temporarily unavailable. Retry shortly.", 503); }
  if (!addresses.length || addresses.some(({ address }) => BLOCKED.test(address) || /^f[cd]|^fe[89ab]/i.test(address.replaceAll(":", "")))) throw new PublisherAssetError("URL_NOT_PUBLIC", "URL host is not publicly reachable.", 422);
}

async function checkReachability(initial: URL) {
  let current = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicDns(current.hostname);
    let response: Response;
    try { response = await fetch(current, { method: "HEAD", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(6_000) }); }
    catch { throw new PublisherAssetError("URL_TEMPORARILY_UNAVAILABLE", "URL is temporarily unreachable. Retry shortly.", 503); }
    if (response.status === 405) {
      try { response = await fetch(current, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(6_000), headers: { Range: "bytes=0-0" } }); }
      catch { throw new PublisherAssetError("URL_TEMPORARILY_UNAVAILABLE", "URL is temporarily unreachable. Retry shortly.", 503); }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) throw new PublisherAssetError("URL_REDIRECT_INVALID", "URL redirects too many times.", 422);
      current = safeUrl(new URL(location, current).toString());
      continue;
    }
    if (response.ok) return { status: response.status };
    throw new PublisherAssetError("URL_UNREACHABLE", "URL is not reachable.", 422);
  }
  throw new PublisherAssetError("URL_REDIRECT_INVALID", "URL redirects too many times.", 422);
}

export async function GET(request: Request) {
  try {
    await authenticatePublisherAsset(request);
    const value = new URL(request.url).searchParams.get("url")?.trim();
    if (!value) throw new PublisherAssetError("URL_REQUIRED", "URL is required.");
    const result = await checkReachability(safeUrl(value));
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error: unknown) {
    if (error instanceof PublisherAssetError) return publisherAssetErrorResponse(error);
    return NextResponse.json({ error: "URL verification is temporarily unavailable.", code: "URL_TEMPORARILY_UNAVAILABLE", retryable: true }, { status: 503 });
  }
}
