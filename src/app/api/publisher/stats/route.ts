import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy publisher stats payloads are not schema-generated */
import pool from "@/lib/db";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import {
  getReferralJoinRewardAmount,
  getReferralTotalRewardAmount,
  getReferralVerificationRewardAmount,
} from "@/lib/referralSprint";
import { cpc, cpm, ctr, fixedMetric, metricNumber } from "@/lib/statFormulas";
import { botUserCountExpressions } from "@/lib/botAudience";
import { logSlowRequest } from "@/lib/performanceTiming";
import { CACHE_TTL_SECONDS, cacheGetOrSet, redisKeys } from "@/lib/redisCache";

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });
    const payload = await cacheGetOrSet(
      redisKeys.publisherStats(Number(user.id)),
      CACHE_TTL_SECONDS.PUBLISHER_ANALYTICS,
      async () => {

    const [[assetCounts]]: any = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM channels WHERE user_id=? AND is_deleted=FALSE AND status='active') total_channels,
        (SELECT COUNT(*) FROM bots WHERE user_id=? AND is_deleted=FALSE AND status IN ('active','approved')) total_bots,
        (SELECT COUNT(*) FROM miniapps WHERE user_id=? AND is_deleted=FALSE AND status IN ('active','approved','monetized')) total_miniapps`,
      [user.id, user.id, user.id]
    );

    // Fetch 3 most recent channels
    const [recentChannels]: any = await pool.query(
      "SELECT id, title, username, status, created_at FROM channels WHERE user_id = ? AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 3",
      [user.id]
    );

    // Fetch recent assets per inventory type so a newer bot/mini app cannot crowd
    // channels out of the publisher dashboard's monetized section.
    const [recentMonetizedChannels]: any = await pool.query(
      `SELECT 'channel' AS type, id, title AS name, username, status, created_at,
          posts_per_day, audience_continents, categories, channel_type
       FROM channels
       WHERE user_id = ? AND is_deleted = FALSE AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 3`,
      [user.id]
    );
    const [recentMonetizedBots]: any = await pool.query(
      `SELECT 'bot' AS type, id, bot_name AS name, bot_username AS username, status, created_at,
          posts_per_day, continents AS audience_continents, categories, NULL AS channel_type
       FROM bots
       WHERE user_id = ? AND is_deleted = FALSE AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 3`,
      [user.id]
    );
    const [recentMonetizedMiniapps]: any = await pool.query(
      `SELECT 'miniapp' AS type, id, miniapp_name AS name, miniapp_username AS username,
          CASE WHEN status = 'monetized' THEN 'approved' ELSE status END AS status,
          created_at, NULL AS posts_per_day, NULL AS audience_continents, NULL AS categories, NULL AS channel_type
       FROM miniapps
       WHERE user_id = ? AND is_deleted = FALSE AND status IN ('approved', 'monetized')
       ORDER BY created_at DESC
       LIMIT 3`,
      [user.id]
    );
    const recentMonetized = [
      ...recentMonetizedChannels,
      ...recentMonetizedBots,
      ...recentMonetizedMiniapps,
    ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Fetch referral percentage from settings
    const [settingRows]: any = await pool.query(
      "SELECT value FROM settings WHERE `key` = 'referral_reward_percentage'"
    );
    const referralPercent = settingRows[0]?.value || "5";
    const [[referralSprintSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_sprint_enabled' LIMIT 1"
    );
    const [[referralPromotionSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'referral_dashboard_promotion_enabled' LIMIT 1"
    );
    const [[promoteCampaign]]: any = await pool.query(
      `SELECT CASE WHEN status='paid' AND completion_expires_at IS NOT NULL AND completion_expires_at<=UTC_TIMESTAMP(6) THEN NULL
                   WHEN status='paid' AND payment_confirmed_at IS NOT NULL THEN 'paid'
                   WHEN ends_at IS NOT NULL AND ends_at<=NOW(6) THEN 'closed'
                   WHEN status='scheduled' AND starts_at<=NOW(6) THEN 'active'
                   ELSE status END status
       FROM publisher_promotion_campaigns WHERE slug = 'promote-ads-galaxy' LIMIT 1`
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
    const rangeSql = `
      SELECT 'today' as range_key, CURDATE() as start_date, CURDATE() as end_date
      UNION ALL SELECT 'yesterday', DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY)
      UNION ALL SELECT 'last7', DATE_SUB(CURDATE(), INTERVAL 6 DAY), CURDATE()
      UNION ALL SELECT 'last30', DATE_SUB(CURDATE(), INTERVAL 29 DAY), CURDATE()
      UNION ALL SELECT 'lifetime', DATE('1970-01-01'), CURDATE()
    `;
    const [channelRangeRows]: any = await pool.query(
      `SELECT ranges.range_key,
        COALESCE(SUM(cds.views), 0) as impressions,
        COALESCE(SUM(cds.clicks), 0) as clicks,
        COALESCE(SUM(cds.earnings), 0) as earnings,
        COALESCE(SUM(cds.spend), 0) as gross_revenue
       FROM (${rangeSql}) ranges
       LEFT JOIN channels ch ON ch.user_id = ? AND ch.is_deleted = FALSE
       LEFT JOIN channel_daily_stats cds ON cds.channel_id = ch.id AND cds.stat_date BETWEEN ranges.start_date AND ranges.end_date
       GROUP BY ranges.range_key`,
      [user.id]
    );
    const [miniappRevenueRows]: any = await pool.query(
      `SELECT ranges.range_key,
        COALESCE(SUM(mds.impressions), 0) as impressions,
        COALESCE(SUM(mds.publisher_revenue), 0) as earnings,
        COALESCE(SUM(mds.gross_revenue), 0) as gross_revenue
       FROM (${rangeSql}) ranges
       LEFT JOIN miniapps ma ON ma.user_id = ? AND ma.is_deleted = FALSE
       LEFT JOIN miniapp_daily_stats mds ON mds.miniapp_id = ma.id AND mds.date BETWEEN ranges.start_date AND ranges.end_date
       GROUP BY ranges.range_key`,
      [user.id]
    );
    const [miniappClickRows]: any = await pool.query(
      `SELECT ranges.range_key, COUNT(ac.id) as clicks
       FROM (${rangeSql}) ranges
       LEFT JOIN miniapps ma ON ma.user_id = ? AND ma.is_deleted = FALSE
       LEFT JOIN ad_click_attribution ac ON ac.campaign_type = 'miniapp' AND ac.miniapp_id = ma.id AND DATE(ac.created_at) BETWEEN ranges.start_date AND ranges.end_date
       GROUP BY ranges.range_key`,
      [user.id]
    );
    const [miniappRequestRows]: any = await pool.query(
      `SELECT ranges.range_key,
        COUNT(mr.id) as requests,
        COALESCE(SUM(CASE WHEN mr.impression_confirmed = 1 OR mr.final_result IN ('completed', 'impression_confirmed', 'displayed') THEN 1 ELSE 0 END), 0) as fills
       FROM (${rangeSql}) ranges
       LEFT JOIN miniapps ma ON ma.user_id = ? AND ma.is_deleted = FALSE
       LEFT JOIN miniapp_mediation_requests mr ON mr.miniapp_id = ma.id AND mr.parent_request_id IS NULL AND DATE(mr.created_at) BETWEEN ranges.start_date AND ranges.end_date
       GROUP BY ranges.range_key`,
      [user.id]
    );
    const [botRangeRows]: any = await pool.query(
      `SELECT ranges.range_key,
        FLOOR(COALESCE(SUM(CASE WHEN bd.status = 'sent' THEN 1 ELSE 0 END), 0) / 5) as impressions,
        COALESCE(SUM(CASE WHEN bd.status = 'sent' THEN bd.publisher_reward ELSE 0 END), 0) as earnings,
        COALESCE(SUM(CASE WHEN bd.status = 'sent' THEN bd.cost ELSE 0 END), 0) as gross_revenue,
        COALESCE(SUM(CASE WHEN bd.status IN ('failed','failed_final') THEN 1 ELSE 0 END), 0) as failed_sends
       FROM (${rangeSql}) ranges
       LEFT JOIN bots b ON b.user_id = ? AND b.is_deleted = FALSE
       LEFT JOIN broadcast_deliveries bd ON bd.bot_id = b.id AND DATE(bd.created_at) BETWEEN ranges.start_date AND ranges.end_date
       GROUP BY ranges.range_key`,
      [user.id]
    );
    const rowsByRange = new Map<string, any>();
    for (const row of [...channelRangeRows, ...miniappRevenueRows, ...miniappClickRows, ...miniappRequestRows, ...botRangeRows]) {
      const rangeKey = String(row.range_key);
      const current = rowsByRange.get(rangeKey) || { range_key: rangeKey };
      rowsByRange.set(rangeKey, {
        ...current,
        impressions: metricNumber(current.impressions) + metricNumber(row.impressions),
        clicks: metricNumber(current.clicks) + metricNumber(row.clicks),
        earnings: metricNumber(current.earnings) + metricNumber(row.earnings),
        gross_revenue: metricNumber(current.gross_revenue) + metricNumber(row.gross_revenue),
        requests: metricNumber(current.requests) + metricNumber(row.requests),
        fills: metricNumber(current.fills) + metricNumber(row.fills),
        failed_sends: metricNumber(current.failed_sends) + metricNumber(row.failed_sends),
      });
    }
    const publisherSummary = Object.fromEntries([...rowsByRange.values()].map((row: any) => {
      const impressions = metricNumber(row.impressions);
      const clicks = metricNumber(row.clicks);
      const earnings = metricNumber(row.earnings);
      const grossRevenue = metricNumber(row.gross_revenue);
      const requests = metricNumber(row.requests);
      const fills = metricNumber(row.fills);
      return [row.range_key, {
        impressions,
        views: impressions,
        clicks,
        earnings: fixedMetric(earnings, 8),
        publisher_revenue: fixedMetric(earnings, 8),
        gross_revenue: fixedMetric(grossRevenue, 8),
        ctr: ctr(clicks, impressions),
        cpm: cpm(earnings, impressions),
        average_cpm: cpm(earnings, impressions),
        advertiser_average_cpm: cpm(grossRevenue, impressions),
        cpc: cpc(earnings, clicks),
        publisher_cpc: cpc(earnings, clicks),
        advertiser_cpc: cpc(grossRevenue, clicks),
        fill_rate: requests > 0 ? fixedMetric((fills / requests) * 100) : null,
        requests,
        fills,
        failed_sends: metricNumber(row.failed_sends),
      }];
    }));
    const botCounts = botUserCountExpressions("b", { publisherVisible: true });
    const [[botAudienceRow]]: any = await pool.query(
      `SELECT
        COALESCE(SUM(${botCounts.active}), 0) as active_users,
        COALESCE(SUM(${botCounts.blocked}), 0) as blocked_users,
        COALESCE(SUM(${botCounts.deliveryEligible}), 0) as delivery_eligible_users
       FROM bots b
       WHERE b.user_id = ? AND b.is_deleted = FALSE`,
      [user.id]
    );

    // Stats from user profile
    return {
      total_withdrawn: totalWithdrawn,
      earnings_summary: publisherSummary,
      today_earnings: publisherSummary.today?.earnings || 0,
      yesterday_earnings: publisherSummary.yesterday?.earnings || 0,
      last7_earnings: publisherSummary.last7?.earnings || 0,
      last30_earnings: publisherSummary.last30?.earnings || 0,
      lifetime_earnings: publisherSummary.lifetime?.earnings || 0,
      bot_active_users: metricNumber(botAudienceRow?.active_users),
      bot_blocked_users: metricNumber(botAudienceRow?.blocked_users),
      bot_delivery_eligible_users: metricNumber(botAudienceRow?.delivery_eligible_users),
      total_channels: assetCounts.total_channels,
      total_bots: assetCounts.total_bots,
      total_miniapps: assetCounts.total_miniapps,
      delivery_eligible_channels: assetCounts.total_channels,
      total_monetized: Number(assetCounts.total_channels || 0) + Number(assetCounts.total_bots || 0) + Number(assetCounts.total_miniapps || 0),
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
      promote_ads_galaxy_status: promoteCampaign?.status || null,
    };
      },
    );
    return NextResponse.json({
      ...payload,
      // These values come from the authenticated MariaDB lookup on every request.
      balance_locked: user.balance_locked,
      balance_available: user.balance_available,
      balance_pending: user.balance_locked,
      join_rewarded: user.join_rewarded,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error: any) {
    console.error("Stats API Error:", error);
    const authStatus = getAuthErrorStatus(error);
    return NextResponse.json(
      { error: authStatus === 401 || authStatus === 403 ? "Authentication required" : "Failed to fetch publisher stats" },
      { status: authStatus === 403 ? 403 : authStatus === 401 ? 401 : 500 },
    );
  } finally {
    logSlowRequest("/api/publisher/stats", startedAt);
  }
}
