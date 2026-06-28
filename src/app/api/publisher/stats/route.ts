import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  ensureReferralGrowthSettingDefaults,
  getReferralJoinRewardAmount,
  getReferralTotalRewardAmount,
  getReferralVerificationRewardAmount,
} from "@/lib/referralSprint";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    // Fetch total channels count
    const [channelCountRows]: any = await pool.query(
      "SELECT COUNT(*) as total FROM channels WHERE user_id = ? AND is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') = 'active'",
      [user.id]
    );

    // Fetch monetized bots and mini apps counts
    const [botCountRows]: any = await pool.query(
      "SELECT COUNT(*) as total FROM bots WHERE user_id = ? AND is_deleted = FALSE AND status IN ('active', 'approved')",
      [user.id]
    );
    const [miniappCountRows]: any = await pool.query(
      "SELECT COUNT(*) as total FROM miniapps WHERE user_id = ? AND is_deleted = FALSE AND status IN ('active', 'approved')",
      [user.id]
    );

    // Fetch 3 most recent channels
    const [recentChannels]: any = await pool.query(
      "SELECT id, title, username, status, created_at FROM channels WHERE user_id = ? AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 3",
      [user.id]
    );

    // Fetch last 3 added monetized items across channels, bots, mini apps
    const [recentMonetized]: any = await pool.query(
      `(SELECT 'channel' AS type, id, title AS name, username, status, created_at FROM channels WHERE user_id = ? AND is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') = 'active')
       UNION ALL
       (SELECT 'bot' AS type, id, bot_name AS name, bot_username AS username, status, created_at FROM bots WHERE user_id = ? AND is_deleted = FALSE AND status IN ('active', 'approved'))
       UNION ALL
       (SELECT 'miniapp' AS type, id, miniapp_name AS name, miniapp_username AS username, status, created_at FROM miniapps WHERE user_id = ? AND is_deleted = FALSE AND status IN ('active', 'approved'))
       ORDER BY created_at DESC LIMIT 3`,
      [user.id, user.id, user.id]
    );

    // Fetch referral percentage from settings
    const [settingRows]: any = await pool.query(
      "SELECT value FROM settings WHERE `key` = 'referral_reward_percentage'"
    );
    const referralPercent = settingRows[0]?.value || "5";
    await ensureReferralGrowthSettingDefaults(pool, false);
    const [[referralSprintSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_sprint_enabled' LIMIT 1"
    );
    const [[referralPromotionSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_dashboard_promotion_enabled' LIMIT 1"
    );
    const [referralGrowthSettings]: any = await pool.query(
      "SELECT `key`, value FROM referral_growth_settings WHERE `key` IN ('referral_join_reward_amount', 'referral_verification_reward_amount', 'referral_sprint_popup_interval_seconds', 'referral_sprint_popup_interval_hours')"
    );
    const referralSettingsMap = new Map<string, string>(
      referralGrowthSettings.map((row: any) => [String(row.key), String(row.value)])
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
      total_monetized: (channelCountRows[0].total || 0) + (botCountRows[0].total || 0) + (miniappCountRows[0].total || 0),
      recent_channels: recentChannels,
      recent_monetized: recentMonetized,
      referral_percent: referralPercent,
      referral_reward_amount: getReferralTotalRewardAmount(referralSettingsMap),
      referral_join_reward_amount: getReferralJoinRewardAmount(referralSettingsMap),
      referral_verification_reward_amount: getReferralVerificationRewardAmount(referralSettingsMap),
      referral_sprint_popup_interval_seconds: Number(referralSettingsMap.get("referral_sprint_popup_interval_seconds") || (Number(referralSettingsMap.get("referral_sprint_popup_interval_hours") || 24) * 3600)),
      referral_sprint_popup_interval_hours: Number(referralSettingsMap.get("referral_sprint_popup_interval_hours") || 24),
      referral_sprint_enabled: referralSprintSetting?.value === "1",
      referral_dashboard_promotion_enabled: referralPromotionSetting?.value !== "0",
      join_rewarded: user.join_rewarded
    });
  } catch (error: any) {
    console.error("Stats API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch stats" }, { status: getAuthErrorStatus(error) === 403 ? 403 : 401 });
  }
}
