import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- authenticated referral summary is dynamically shaped */
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getReferralGrowthSummary } from "@/lib/referralSprint";
import pool from "@/lib/db";

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

export async function PATCH(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const body = await request.json().catch(() => ({}));
    const notificationId = Number(body.notification_id || 0);
    if (notificationId <= 0) {
      return NextResponse.json({ error: "notification_id is required" }, { status: 400 });
    }

    await pool.query(
      `UPDATE referral_growth_notifications
       SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ?`,
      [notificationId, user.id]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Referral Notification Update Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update referral notification" }, { status: getAuthErrorStatus(error) });
  }
}
