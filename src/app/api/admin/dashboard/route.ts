import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

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

    const [channelsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM channels WHERE is_deleted = FALSE GROUP BY status");
    const channelsStats = channelsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});
    const [[activeChannels]]: any = await pool.query(`
      SELECT COUNT(*) as count
      FROM channels
      WHERE is_deleted = FALSE
        AND status = 'active'
        AND COALESCE(health_status, 'active') = 'active'
    `);

    const [withdrawalsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM withdrawals GROUP BY status");
    const withdrawalsStats = withdrawalsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});

    const [[depositsPaid]]: any = await pool.query("SELECT SUM(amount) as total FROM deposits WHERE status IN ('Paid', 'paid', 'success')");
    const [[withdrawalsPaid]]: any = await pool.query("SELECT SUM(amount) as total FROM withdrawals WHERE status = 'success'");

    const [[totalSubscribers]]: any = await pool.query(`
      SELECT COALESCE(SUM(subscriber_count), 0) as total
      FROM channels
      WHERE is_deleted = FALSE
        AND status = 'active'
        AND COALESCE(health_status, 'active') = 'active'
    `);
    
    const [[botsTotal]]: any = await pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'active' AND COALESCE(health_status, 'active') = 'active'");
    const [[botsPaused]]: any = await pool.query("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status IN ('paused', 'token_invalid', 'bot_deleted', 'unreachable')");
    const [[botUsersTotal]]: any = await pool.query("SELECT COUNT(*) as count FROM bot_users");
    const [[botUsersActive]]: any = await pool.query(`
      SELECT COUNT(*) as count
      FROM bot_users bu
      JOIN bots b ON b.id = bu.bot_id
      WHERE b.status = 'active'
        AND b.is_deleted = FALSE
        AND COALESCE(b.health_status, 'active') = 'active'
        AND bu.is_active = TRUE
        AND bu.status = 'active'
    `);
    const [[botUsersInactive]]: any = await pool.query(`
      SELECT COUNT(*) as count
      FROM bot_users bu
      JOIN bots b ON b.id = bu.bot_id
      WHERE bu.is_active = FALSE
         OR bu.status != 'active'
         OR b.status != 'active'
         OR COALESCE(b.health_status, 'active') != 'active'
         OR b.is_deleted = TRUE
    `);
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

    return NextResponse.json({
      users: {
        total: usersTotal.count,
        today: usersToday.count,
        week: usersWeek.count,
        month: usersMonth.count
      },
      campaigns: {
        pending: campaignsStats.pending || 0,
        active: campaignsStats.active || 0,
        rejected: campaignsStats.rejected || 0,
        paused: campaignsStats.paused || 0,
        total: Object.values(campaignsStats).reduce((a: any, b: any) => a + b, 0)
      },
      channels: {
        pending: channelsStats.pending || 0,
        approved: activeChannels.count || 0,
        rejected: channelsStats.rejected || 0,
        paused: (channelsStats.paused || 0) + (channelsStats.bot_removed || 0) + (channelsStats.channel_not_found || 0) + (channelsStats.permission_missing || 0) + (channelsStats.deleted || 0),
        failed: (channelsStats.bot_removed || 0) + (channelsStats.channel_not_found || 0) + (channelsStats.permission_missing || 0),
        total: activeChannels.count || 0,
        totalSubscribers: totalSubscribers.total || 0
      },
      bots: {
        total: botsTotal.count,
        totalUsers: botUsersTotal.count,
        activeUsers: botUsersActive.count,
        paused: botsPaused.count,
        inactiveUsers: botUsersInactive.count
      },
      withdrawals: {
        pending: withdrawalsStats.pending || 0,
        success: withdrawalsStats.success || 0,
        rejected: withdrawalsStats.rejected || 0,
        total: Object.values(withdrawalsStats).reduce((a: any, b: any) => a + b, 0)
      },
      financials: {
        totalDeposits: depositsPaid.total || 0,
        totalWithdrawals: withdrawalsPaid.total || 0
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
    });
  } catch (error: any) {
    console.error("Admin Dashboard API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
