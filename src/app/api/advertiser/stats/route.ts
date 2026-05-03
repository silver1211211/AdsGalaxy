import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    // 1. Get Ad Balance from user table
    const [userRows]: any = await pool.query("SELECT ad_balance FROM users WHERE id = ?", [user.id]);
    const adBalance = parseFloat(userRows[0]?.ad_balance || "0");

    // 2. Calculate Locked Balance (Sum of budgets of pending, active, and paused campaigns)
    const [lockedResult]: any = await pool.query(
      "SELECT SUM(budget) as locked FROM campaigns WHERE user_id = ? AND status IN ('pending', 'active', 'paused')",
      [user.id]
    );
    const lockedBalance = parseFloat(lockedResult[0]?.locked || "0");

    // 3. Get Active Ads count
    const [activeResult]: any = await pool.query(
      "SELECT COUNT(*) as active_count FROM campaigns WHERE user_id = ? AND status = 'active'",
      [user.id]
    );
    const activeAds = activeResult[0]?.active_count || 0;

    // 4. Get Total Campaigns count
    const [totalResult]: any = await pool.query(
      "SELECT COUNT(*) as total_count FROM campaigns WHERE user_id = ?",
      [user.id]
    );
    const totalCampaigns = totalResult[0]?.total_count || 0;

    // 5. Get Recent Campaigns
    const [recentCampaigns]: any = await pool.query(
      "SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
      [user.id]
    );

    // 6. Stats (Views, Clicks, Spent)
    // Get actual clicks from campaign_clicks table
    const [clicksResult]: any = await pool.query(
      `SELECT COUNT(cc.id) as total_clicks 
       FROM campaign_clicks cc
       JOIN campaigns c ON cc.campaign_id = c.id
       WHERE c.user_id = ?`,
      [user.id]
    );
    const totalClicks = clicksResult[0]?.total_clicks || 0;

    // Get views (from campaign_posts)
    const [viewsResult]: any = await pool.query(
      `SELECT SUM(cp.views) as total_views 
       FROM campaign_posts cp
       JOIN campaigns c ON cp.campaign_id = c.id
       WHERE c.user_id = ?`,
      [user.id]
    );
    const totalViews = viewsResult[0]?.total_views || 0;

    // Get total investment from successful deposits
    const [spentResult]: any = await pool.query(
      "SELECT SUM(amount) as total FROM deposits WHERE user_id = ? AND status = 'paid'",
      [user.id]
    );
    const totalSpent = parseFloat(spentResult[0]?.total || "0");

    return NextResponse.json({
      ad_balance: adBalance,
      ad_balance_locked: lockedBalance,
      active_ads: activeAds,
      total_campaigns: totalCampaigns,
      total_views: totalViews,
      total_clicks: totalClicks,
      total_spent: totalSpent,
      recent_campaigns: recentCampaigns
    });

  } catch (error: any) {
    console.error("Stats API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
