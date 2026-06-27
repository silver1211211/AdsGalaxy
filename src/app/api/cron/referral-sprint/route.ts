import { NextResponse } from "next/server";
import { ensureActiveReferralSprint, finalizeExpiredReferralSprints, notifyReferralSprintEndingSoon } from "@/lib/referralSprint";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("referral-sprint", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Referral sprint cron is already running" }, { status: 409 });
  }

  try {
    const result = await finalizeExpiredReferralSprints();
    const endingSoon = await notifyReferralSprintEndingSoon();
    const active = await ensureActiveReferralSprint();
    return NextResponse.json({ success: true, result, endingSoon, active_sprint_id: active.id });
  } catch (error: any) {
    console.error("Referral Sprint Cron Error:", error);
    return NextResponse.json({ error: error.message || "Referral sprint cron failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
