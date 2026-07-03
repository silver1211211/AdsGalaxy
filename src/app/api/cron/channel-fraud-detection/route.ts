import { NextRequest, NextResponse } from "next/server";
import { runChannelFraudDetection } from "@/lib/channelFraudDetection";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("channel-fraud-detection", 900);
  if (!lock) return NextResponse.json({ success: false, message: "Channel fraud detection is already running" }, { status: 409 });
  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "200", 10);
    const result = await runChannelFraudDetection(limit);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_fraud_detection_failed";
    console.error("Channel fraud detection cron failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
