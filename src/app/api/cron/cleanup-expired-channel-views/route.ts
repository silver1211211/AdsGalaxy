import { NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { cleanupExpiredChannelViewRuns } from "@/lib/expiredChannelCleanup";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("cleanup-expired-channel-views", 1800);
  if (!lock) return NextResponse.json({ success: false, message: "Expired channel view cleanup is already running" }, { status: 409 });
  try {
    const result = await cleanupExpiredChannelViewRuns();
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "cleanup_expired_channel_views_failed";
    console.error("Expired channel view cleanup failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
