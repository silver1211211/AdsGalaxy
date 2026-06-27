import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    // Fetch total channels count
    const [channelCountRows]: any = await pool.query(
      "SELECT COUNT(*) as total FROM channels WHERE user_id = ? AND is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') = 'active'",
      [user.id]
    );

    // Fetch 3 most recent channels
    const [recentChannels]: any = await pool.query(
      "SELECT id, title, username, status, created_at FROM channels WHERE user_id = ? AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 3",
      [user.id]
    );

    // Fetch referral percentage from settings
    const [settingRows]: any = await pool.query(
      "SELECT value FROM settings WHERE `key` = 'referral_reward_percentage'"
    );
    const referralPercent = settingRows[0]?.value || "5";
    const [[referralRewardSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_reward_amount' LIMIT 1"
    );
    const [[referralSprintSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_sprint_enabled' LIMIT 1"
    );
    const [[referralPromotionSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_dashboard_promotion_enabled' LIMIT 1"
    );

    // Fetch total successful withdrawals sum
    const [withdrawalSumRows]: any = await pool.query(
      "SELECT SUM(amount) as total FROM withdrawals WHERE user_id = ? AND status = 'success'",
      [user.id]
    );
    const totalWithdrawn = withdrawalSumRows[0]?.total || 0;

    // Stats from user profile
    return NextResponse.json({
      balance_locked: user.balance_locked,
      balance_available: user.balance_available,
      total_withdrawn: totalWithdrawn,
      total_channels: channelCountRows[0].total,
      recent_channels: recentChannels,
      referral_percent: referralPercent,
      referral_reward_amount: referralRewardSetting?.value || "0.015",
      referral_sprint_enabled: referralSprintSetting?.value !== "0",
      referral_dashboard_promotion_enabled: referralPromotionSetting?.value !== "0",
      join_rewarded: user.join_rewarded
    });
  } catch (error: any) {
    console.error("Stats API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch stats" }, { status: getAuthErrorStatus(error) === 403 ? 403 : 401 });
  }
}
