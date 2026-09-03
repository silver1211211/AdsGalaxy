/* eslint-disable @typescript-eslint/no-explicit-any -- legacy aggregate query payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getGlobalBotAudienceStats } from "@/lib/botAudience";
import { getMiniAppPlatformStats } from "@/lib/miniappReports";
import { columnExists } from "@/lib/schemaGuards";
import { getAdminChannelSafetyMetrics } from "@/lib/channelSafety";

const DASHBOARD_CACHE_MS = 60_000;
const DASHBOARD_STALE_MS = 24 * 60 * 60 * 1000;
let dashboardCache: { expiresAt: number; payload: Record<string, unknown> } | null = null;

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (dashboardCache && dashboardCache.expiresAt > Date.now()) {
    return NextResponse.json(dashboardCache.payload, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300", "X-AdsGalaxy-Cache": "HIT" },
    });
  }

  try {
    const [
      [[usersAggregate]], [campaignsQuery], [[campaignTypeStats]], [miniappCampaignsQuery],
      [channelsQuery], [[approvedChannels]], [[deliveryEligibleChannels]], [withdrawalsQuery],
      [[depositsPaid]], [[withdrawalsPaid]], [[totalSubscribers]], [[botsTotal]],
      [[botsDeliveryEligible]], [[botsPaused]], botAudienceStats, [[conversionTotals]],
      [topConversionCampaigns], [topConversionCategories], [topConversionInventory],
      [[conversionReviews]], [[attributionSetting]], [[miniappsActive]], [[impressionsToday]],
      [[impressionsYesterday]], miniappStats, [[channelPlatformStats]],
      hasBotPlatformRevenue, hasBotReserveAmount, safetyMetrics,
    ]: any = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total,
        SUM(created_at >= CURDATE()) AS today,
        SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS week,
        SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS month FROM users`),
      pool.query("SELECT status, COUNT(*) as count FROM campaigns GROUP BY status"),
      pool.query("SELECT SUM(status = 'pending' AND type != 'broadcast') AS channel_pending, SUM(status = 'pending' AND type = 'broadcast') AS bot_pending FROM campaigns"),
      pool.query("SELECT status, COUNT(*) as count FROM miniapp_rewarded_campaigns GROUP BY status"),
      pool.query("SELECT status, COUNT(*) as count FROM channels WHERE is_deleted = FALSE GROUP BY status"),
      pool.query("SELECT COUNT(*) as count, COALESCE(SUM(subscriber_count), 0) as subscribers FROM channels WHERE is_deleted = FALSE AND status = 'active'"),
      pool.query("SELECT COUNT(*) as count, COALESCE(SUM(subscriber_count), 0) as subscribers FROM channels WHERE is_deleted = FALSE AND status = 'active'"),
      pool.query("SELECT status, COUNT(*) as count FROM withdrawals GROUP BY status"),
      pool.query("SELECT SUM(amount) as total FROM deposits WHERE status IN ('Paid', 'paid', 'success')"),
      pool.query("SELECT SUM(amount) as total FROM withdrawals WHERE status = 'success'"),
      pool.query("SELECT COALESCE(SUM(subscriber_count), 0) as total FROM channels WHERE is_deleted = FALSE"),
      pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'active'"),
      pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') IN ('active', 'healthy')"),
      pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status IN ('paused', 'token_invalid', 'bot_deleted', 'unreachable')"),
      getGlobalBotAudienceStats(),
      pool.query("SELECT COUNT(*) as conversions, COALESCE(SUM(conversion_value), 0) as conversion_value FROM ad_conversions"),
      pool.query(`SELECT campaign_type, campaign_id, COUNT(*) as conversions, COALESCE(SUM(conversion_value), 0) as conversion_value
        FROM ad_conversions GROUP BY campaign_type, campaign_id ORDER BY conversions DESC, conversion_value DESC LIMIT 5`),
      pool.query(`SELECT COALESCE(ac.category, 'Uncategorized') as category, COUNT(conv.id) as conversions
        FROM ad_conversions conv JOIN ad_click_attribution ac ON ac.click_id = conv.click_id
        GROUP BY COALESCE(ac.category, 'Uncategorized') ORDER BY conversions DESC LIMIT 5`),
      pool.query(`SELECT COALESCE(ac.inventory_type, 'unknown') as inventory_type, COALESCE(ac.inventory_id, 0) as inventory_id, COUNT(conv.id) as conversions
        FROM ad_conversions conv JOIN ad_click_attribution ac ON ac.click_id = conv.click_id
        GROUP BY COALESCE(ac.inventory_type, 'unknown'), COALESCE(ac.inventory_id, 0) ORDER BY conversions DESC LIMIT 5`),
      pool.query("SELECT COUNT(*) as open_count FROM conversion_review_queue WHERE status IN ('open', 'monitor')"),
      pool.query("SELECT value FROM settings WHERE `key` = 'conversion_attribution_window_days' LIMIT 1"),
      pool.query("SELECT COUNT(*) as count FROM miniapps WHERE is_deleted = FALSE AND status IN ('approved', 'monetized')"),
      pool.query("SELECT COALESCE(SUM(impressions), 0) as count FROM miniapp_daily_stats WHERE date = CURDATE()"),
      pool.query("SELECT COALESCE(SUM(impressions), 0) as count FROM miniapp_daily_stats WHERE date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)"),
      getMiniAppPlatformStats(),
      pool.query(`SELECT COALESCE(SUM(views), 0) as impressions, COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(spend), 0) as revenue, COALESCE(SUM(earnings), 0) as publisher_earnings,
        COALESCE(SUM(platform_revenue), 0) as platform_earnings, COALESCE(SUM(reserve_amount), 0) as reserve
        FROM channel_daily_stats`),
      columnExists(pool, "broadcast_deliveries", "platform_revenue"),
      columnExists(pool, "broadcast_deliveries", "reserve_amount"),
      getAdminChannelSafetyMetrics(),
    ]);
    const usersTotal = { count: Number(usersAggregate.total || 0) };
    const usersToday = { count: Number(usersAggregate.today || 0) };
    const usersWeek = { count: Number(usersAggregate.week || 0) };
    const usersMonth = { count: Number(usersAggregate.month || 0) };
    const campaignsStats = campaignsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const miniappCampaignsStats = miniappCampaignsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const standardCampaignTotal = Object.values(campaignsStats).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
    const miniappCampaignTotal = Object.values(miniappCampaignsStats).reduce((sum: number, value: any) => sum + Number(value || 0), 0);

    const channelsStats = channelsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const withdrawalsStats = withdrawalsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const [[botPlatformStats]]: any = await pool.query(`
      SELECT
        COUNT(*) as impressions,
        COALESCE(SUM(cost), 0) as revenue,
        COALESCE(SUM(publisher_reward), 0) as publisher_earnings,
        ${hasBotPlatformRevenue ? "COALESCE(SUM(platform_revenue), 0)" : "0"} as platform_earnings,
        ${hasBotReserveAmount ? "COALESCE(SUM(reserve_amount), 0)" : "0"} as reserve
      FROM broadcast_deliveries
      WHERE status = 'sent'
    `);
    const platformRevenue = Number(channelPlatformStats?.revenue || 0)
      + Number(botPlatformStats?.revenue || 0)
      + Number(miniappStats.lifetime.gross_revenue || 0);
    const publisherEarnings = Number(channelPlatformStats?.publisher_earnings || 0)
      + Number(botPlatformStats?.publisher_earnings || 0)
      + Number(miniappStats.lifetime.publisher_revenue || 0);
    const platformEarnings = Number(channelPlatformStats?.platform_earnings || 0)
      + Number(botPlatformStats?.platform_earnings || 0)
      + Number(miniappStats.lifetime.ads_galaxy_revenue || 0);
    const reserve = Number(channelPlatformStats?.reserve || 0)
      + Number(botPlatformStats?.reserve || 0)
      + Number(miniappStats.lifetime.reserve_revenue || 0);
    const platformImpressions = Number(channelPlatformStats?.impressions || 0)
      + Number(botPlatformStats?.impressions || 0)
      + Number(miniappStats.lifetime.total_impressions || 0);
    const platformClicks = Number(channelPlatformStats?.clicks || 0) + Number(miniappStats.lifetime.total_clicks || 0);

    const payload = {
      users: {
        total: usersTotal.count,
        today: usersToday.count,
        week: usersWeek.count,
        month: usersMonth.count
      },
      campaigns: {
        pending: Number(campaignsStats.pending || 0) + Number(miniappCampaignsStats.pending || 0),
        pending_by_type: {
          channel: Number(campaignTypeStats.channel_pending || 0),
          bot: Number(campaignTypeStats.bot_pending || 0),
          miniapp: Number(miniappCampaignsStats.pending || 0),
        },
        active: Number(campaignsStats.active || 0) + Number(miniappCampaignsStats.approved || 0) + Number(miniappCampaignsStats.monetized || 0),
        rejected: Number(campaignsStats.rejected || 0) + Number(miniappCampaignsStats.rejected || 0),
        paused: Number(campaignsStats.paused || 0) + Number(miniappCampaignsStats.paused || 0),
        total: standardCampaignTotal + miniappCampaignTotal
      },
      channels: {
        pending: channelsStats.pending || 0,
        approved: approvedChannels.count || 0,
        rejected: channelsStats.rejected || 0,
        paused: (channelsStats.paused || 0) + (channelsStats.bot_removed || 0) + (channelsStats.channel_not_found || 0) + (channelsStats.permission_missing || 0) + (channelsStats.deleted || 0),
        failed: (channelsStats.bot_removed || 0) + (channelsStats.channel_not_found || 0) + (channelsStats.permission_missing || 0),
        total: approvedChannels.count || 0,
        approvedSubscribers: Number(approvedChannels.subscribers || 0),
        deliveryEligible: deliveryEligibleChannels.count || 0,
        deliveryEligibleSubscribers: Number(deliveryEligibleChannels.subscribers || 0),
        totalSubscribers: Number(totalSubscribers.total || 0)
      },
      bots: {
        total: botsTotal.count,
        deliveryEligible: botsDeliveryEligible.count,
        totalUsers: botAudienceStats.total_users,
        activeUsers: botAudienceStats.active_users,
        deliveryEligibleUsers: botAudienceStats.delivery_eligible_users,
        paused: botsPaused.count,
        inactiveUsers: botAudienceStats.inactive_users
      },
      miniapps: {
        active: miniappsActive.count || 0,
        impressionsToday: impressionsToday.count || 0,
        impressionsYesterday: impressionsYesterday.count || 0,
        today: miniappStats.today,
        yesterday: miniappStats.yesterday,
        lifetime: miniappStats.lifetime,
        total_impressions: miniappStats.lifetime.total_impressions,
        total_revenue: miniappStats.lifetime.total_revenue,
        gross_revenue: miniappStats.lifetime.gross_revenue,
        ads_galaxy_revenue: miniappStats.lifetime.ads_galaxy_revenue,
        reserve_revenue: miniappStats.lifetime.reserve_revenue,
        publisher_revenue: miniappStats.lifetime.publisher_revenue,
        fill_rate: miniappStats.lifetime.fill_rate
      },
      withdrawals: {
        pending: withdrawalsStats.pending || 0,
        success: withdrawalsStats.success || 0,
        rejected: withdrawalsStats.rejected || 0,
        total: Object.values(withdrawalsStats).reduce((a: any, b: any) => a + b, 0)
      },
      financials: {
        totalDeposits: depositsPaid.total || 0,
        totalWithdrawals: withdrawalsPaid.total || 0,
        revenue: platformRevenue,
        publisherEarnings,
        platformEarnings,
        reserve
      },
      platform_totals: {
        revenue: platformRevenue,
        publisher_earnings: publisherEarnings,
        platform_earnings: platformEarnings,
        reserve,
        impressions: platformImpressions,
        views: platformImpressions,
        clicks: platformClicks,
        ctr: platformImpressions > 0 ? (platformClicks / platformImpressions) * 100 : 0,
        cpm: platformImpressions > 0 ? (platformRevenue / platformImpressions) * 1000 : 0,
        cpc: platformClicks > 0 ? platformRevenue / platformClicks : 0,
        fill_rate: miniappStats.lifetime.fill_rate
      },
      conversions: {
        total: conversionTotals.conversions || 0,
        value: conversionTotals.conversion_value || 0,
        open_reviews: conversionReviews.open_count || 0,
        attribution_window_days: Number(attributionSetting?.value || 7),
        top_campaigns: topConversionCampaigns,
        top_categories: topConversionCategories,
        top_inventory: topConversionInventory
      },
      trust_safety: safetyMetrics,
    };
    dashboardCache = { expiresAt: Date.now() + DASHBOARD_CACHE_MS, payload };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300", "X-AdsGalaxy-Cache": "MISS" },
    });
  } catch (error: any) {
    console.error("Admin Dashboard API Error:", error);
    if (dashboardCache && dashboardCache.expiresAt + DASHBOARD_STALE_MS > Date.now()) {
      return NextResponse.json(dashboardCache.payload, {
        headers: { "Cache-Control": "private, no-store", "X-AdsGalaxy-Cache": "STALE" },
      });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
