import { NextRequest, NextResponse } from "next/server";
import { settleChannelCampaigns } from "@/lib/channelSettlement";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("channel-settlement", 1800);
  if (!lock) return NextResponse.json({ success: false, message: "Channel settlement is already running" }, { status: 409 });

  try {
    const result = await settleChannelCampaigns();
    console.info("Channel settlement batch complete", result);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_settlement_failed";
    console.error("Channel settlement cron failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
