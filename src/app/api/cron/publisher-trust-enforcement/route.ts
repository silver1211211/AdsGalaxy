import { NextRequest, NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { enforcePublisherTrust } from "@/lib/publisherTrustEnforcement";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("publisher-trust-enforcement", 840);
  if (!lock) return NextResponse.json({ success: false, message: "Publisher trust enforcement is already running" }, { status: 409 });
  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "500", 10);
    const result = await enforcePublisherTrust(limit);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "publisher_trust_enforcement_failed";
    console.error("Publisher trust enforcement cron failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
