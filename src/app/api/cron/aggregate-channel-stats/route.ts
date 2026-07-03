import { NextRequest, NextResponse } from "next/server";
import { aggregateChannelStatistics } from "@/lib/channelStatistics";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("aggregate-channel-stats", 900);
  if (!lock) return NextResponse.json({ success: false, message: "Channel statistics aggregation is already running" }, { status: 409 });

  try {
    const date = request.nextUrl.searchParams.get("date") || undefined;
    const result = await aggregateChannelStatistics(date);
    console.info("Channel statistics aggregation complete", result);
    return NextResponse.json({ success: true, stat_date: result.statDate, post_rows: result.postRows, channel_rows: result.channelRows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_statistics_aggregation_failed";
    console.error("Channel statistics aggregation failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
