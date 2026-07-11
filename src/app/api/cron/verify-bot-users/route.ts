import { NextRequest, NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { processPendingBotUserVerifications } from "@/lib/botUserVerification";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("verify-bot-users", 300);
  if (!lock) return NextResponse.json({ success: false, message: "Bot user verification is already running" }, { status: 409 });
  try {
    const result = await processPendingBotUserVerifications(50);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Bot user verification cron failed", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
