import { NextRequest, NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { processSupportMessageQueue } from "@/lib/supportMessages";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("process-support-messages", 600);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Support message worker is already running" }, { status: 409 });
  }

  try {
    const result = await processSupportMessageQueue();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Support message cron error", { error: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ success: false, error: "Support message worker failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
