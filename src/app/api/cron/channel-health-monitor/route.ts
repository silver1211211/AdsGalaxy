import { NextRequest, NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { runChannelHealthMonitor } from "@/lib/channelHealthMonitor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("channel-health-monitor", 3300);
  if (!lock) return NextResponse.json({ success: false, message: "Channel health monitor is already running" }, { status: 409 });
  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "200", 10);
    return NextResponse.json({ success: true, ...(await runChannelHealthMonitor(limit)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_health_monitor_failed";
    console.error("Channel health monitor failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally { await releaseCronLock(lock); }
}
