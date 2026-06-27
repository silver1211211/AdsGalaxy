import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getReferralGrowthSummary } from "@/lib/referralSprint";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    return NextResponse.json(await getReferralGrowthSummary(Number(user.id)));
  } catch (error: any) {
    console.error("Referrals Fetch Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch referral data" }, { status: getAuthErrorStatus(error) });
  }
}
