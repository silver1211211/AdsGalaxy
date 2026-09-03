import { NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { processPromoteCampaign } from "@/lib/promoteAdsGalaxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("promote-ads-galaxy", 900);
  if (!lock) return NextResponse.json({ error: "Campaign processor already running" }, { status: 409 });
  try {
    return NextResponse.json({ success: true, result: await processPromoteCampaign() });
  } catch (error) {
    console.error("Promote AdsGalaxy processor failed", error);
    return NextResponse.json({ error: "Campaign processor failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
