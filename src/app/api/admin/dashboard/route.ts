/* eslint-disable @typescript-eslint/no-explicit-any -- legacy aggregate query payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getGlobalBotAudienceStats } from "@/lib/botAudience";
import { getMiniAppPlatformStats } from "@/lib/miniappReports";

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [[usersTotal]]: any = await pool.query("SELECT COUNT(*) as count FROM users");
    const [[usersToday]]: any = await pool.query("SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = CURDATE()");
    const [[usersWeek]]: any = await pool.query("SELECT COUNT(*) as count FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
    const [[usersMonth]]: any = await pool.query("SELECT COUNT(*) as count FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)");

    const [campaignsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM campaigns GROUP BY status");
    const campaignsStats = campaignsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const [[campaignTypeStats]]: any = await pool.query(`
      SELECT
        SUM(CASE WHEN status = 'pending' AND type != 'broadcast' THEN 1 ELSE 0 END) AS channel_pending,
        SUM(CASE WHEN status = 'pending' AND type = 'broadcast' THEN 1 ELSE 0 END) AS bot_pending
      FROM campaigns
    `);
    const [miniappCampaignsQuery]: any = await pool.query(
      "SELECT status, COUNT(*) as count FROM miniapp_rewarded_campaigns GROUP BY status"
    );
    const miniappCampaignsStats = miniappCampaignsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const standardCampaignTotal = Object.values(campaignsStats).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
    const miniappCampaignTotal = Object.values(miniappCampaignsStats).reduce((sum: number, value: any) => sum + Number(value || 0), 0);

    const [channelsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM channels WHERE is_deleted = FALSE GROUP BY status");
    const channelsStats = channelsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const [[approvedChannels]]: any = await pool.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(subscriber_count), 0) as subscribers
      FROM channels
      WHERE is_deleted = FALSE
        AND status = 'active'
    `);
    const [[deliveryEligibleChannels]]: any = await pool.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(subscriber_count), 0) as subscribers
      FROM channels
      WHERE is_deleted = FALSE
        AND status = 'active'
        AND COALESCE(health_status, 'healthy') IN ('healthy','warning')
    `);

    const [withdrawalsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM withdrawals GROUP BY status");
    const withdrawalsStats = withdrawalsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});

    const [[depositsPaid]]: any = await pool.query("SELECT SUM(amount) as total FROM deposits WHERE status IN ('Paid', 'paid', 'success')");
    const [[withdrawalsPaid]]: any = await pool.query("SELECT SUM(amount) as total FROM withdrawals WHERE status = 'success'");

    const [[totalSubscribers]]: any = await pool.query(`
      SELECT COALESCE(SUM(subscriber_count), 0) as total
      FROM channels
      WHERE is_deleted = FALSE
    `);
    const [audienceByCountry]: any = await pool.query(`
      SELECT
        COALESCE(NULLIF(UPPER(TRIM(marketplace_country)), ''), 'UNASSIGNED') as country,
        COUNT(*) as channels,
        COALESCE(SUM(COALESCE(subscriber_count, 0)), 0) as audience
      FROM channels
      WHERE is_deleted = FALSE
      GROUP BY COALESCE(NULLIF(UPPER(TRIM(marketplace_country)), ''), 'UNASSIGNED')
      ORDER BY audience DESC
    `);
    
    const [[botsTotal]]: any = await pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'active'");
    const [[botsDeliveryEligible]]: any = await pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') IN ('active', 'healthy')");
    const [[botsPaused]]: any = await pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status IN ('paused', 'token_invalid', 'bot_deleted', 'unreachable')");
    const botAudienceStats = await getGlobalBotAudienceStats();
    const [[conversionTotals]]: any = await pool.query(`
      SELECT
        COUNT(*) as conversions,
        COALESCE(SUM(conversion_value), 0) as conversion_value
      FROM ad_conversions
    `);
    const [topConversionCampaigns]: any = await pool.query(`
      SELECT campaign_type, campaign_id, COUNT(*) as conversions, COALESCE(SUM(conversion_value), 0) as conversion_value
      FROM ad_conversions
      GROUP BY campaign_type, campaign_id
      ORDER BY conversions DESC, conversion_value DESC
      LIMIT 5
    `);
    const [topConversionCategories]: any = await pool.query(`
      SELECT COALESCE(ac.category, 'Uncategorized') as category, COUNT(conv.id) as conversions
      FROM ad_conversions conv
      JOIN ad_click_attribution ac ON ac.click_id = conv.click_id
      GROUP BY COALESCE(ac.category, 'Uncategorized')
      ORDER BY conversions DESC
      LIMIT 5
    `);
    const [topConversionInventory]: any = await pool.query(`
      SELECT COALESCE(ac.inventory_type, 'unknown') as inventory_type, COALESCE(ac.inventory_id, 0) as inventory_id, COUNT(conv.id) as conversions
      FROM ad_conversions conv
      JOIN ad_click_attribution ac ON ac.click_id = conv.click_id
      GROUP BY COALESCE(ac.inventory_type, 'unknown'), COALESCE(ac.inventory_id, 0)
      ORDER BY conversions DESC
      LIMIT 5
    `);
    const [[conversionReviews]]: any = await pool.query("SELECT COUNT(*) as open_count FROM conversion_review_queue WHERE status IN ('open', 'monitor')");
    const [[attributionSetting]]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'conversion_attribution_window_days' LIMIT 1");

    const [[miniappsActive]]: any = await pool.query(
      "SELECT COUNT(*) as count FROM miniapps WHERE is_deleted = FALSE AND status IN ('approved', 'monetized')"
    );
    const [[impressionsToday]]: any = await pool.query(
      "SELECT COALESCE(SUM(impressions), 0) as count FROM miniapp_daily_stats WHERE date = CURDATE()"
    );
    const [[impressionsYesterday]]: any = await pool.query(
      "SELECT COALESCE(SUM(impressions), 0) as count FROM miniapp_daily_stats WHERE date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)"
    );
    const miniappStats = await getMiniAppPlatformStats();
    const [[channelPlatformStats]]: any = await pool.query(`
      SELECT
        COALESCE(SUM(views), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(spend), 0) as revenue,
        COALESCE(SUM(earnings), 0) as publisher_earnings,
        COALESCE(SUM(platform_revenue), 0) as platform_earnings,
        COALESCE(SUM(reserve_amount), 0) as reserve
      FROM channel_daily_stats
    `);
    const [[botPlatformStats]]: any = await pool.query(`
      SELECT
        FLOOR(COUNT(*) / 5) as impressions,
        COALESCE(SUM(cost), 0) as revenue,
        COALESCE(SUM(publisher_reward), 0) as publisher_earnings,
        COALESCE(SUM(platform_revenue), 0) as platform_earnings,
        COALESCE(SUM(reserve_amount), 0) as reserve
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

    return NextResponse.json({
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
        totalSubscribers: Number(totalSubscribers.total || 0),
        audienceByCountry: audienceByCountry.map((row: any) => ({
          country: row.country,
          channels: Number(row.channels || 0),
          audience: Number(row.audience || 0),
        }))
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
      }
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error: any) {
    console.error("Admin Dashboard API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
