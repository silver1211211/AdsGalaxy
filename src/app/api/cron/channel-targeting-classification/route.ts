import { NextRequest, NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { classifyChannelTargetingBatch } from "@/lib/channelTargetingClassification";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request); if (denied) return denied;
  const lock = await acquireCronLock("channel-targeting-classification", 240);
  if (!lock) return NextResponse.json({ ok: true, skipped: "locked" });
  try { return NextResponse.json({ ok: true, ...(await classifyChannelTargetingBatch()) }); }
  finally { await releaseCronLock(lock); }
}
