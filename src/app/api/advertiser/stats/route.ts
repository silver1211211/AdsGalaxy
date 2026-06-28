import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { advertiserTrustLabel } from "@/lib/advertiserTrust";
import { advertiserConversionSummary } from "@/lib/conversionTracking";
import { columnExists } from "@/lib/schemaGuards";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const hasCampaignPostViews = await columnExists(pool, "campaign_posts", "views");
    const hasBroadcastDeliveryCost = await columnExists(pool, "broadcast_deliveries", "cost");
    const hasClickSettlementAdvertiserPaid = await columnExists(pool, "ad_settlements", "advertiser_paid");
    const hasViewSettlementAdvertiserPaid = await columnExists(pool, "ad_settlements_views", "advertiser_paid");
    const hasViewSettlementCampaignId = await columnExists(pool, "ad_settlements_views", "campaign_id");
    const canUseViewSettlementSpend = hasViewSettlementAdvertiserPaid && hasViewSettlementCampaignId;
    const campaignPostImpressionsExpr = hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)"
      : "COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)";
    const campaignPostTodayImpressionsExpr = hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= CURDATE()), 0)"
      : "COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= CURDATE()), 0)";
    const campaignPostYesterdayImpressionsExpr = hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND cp.created_at < CURDATE()), 0)"
      : "COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND cp.created_at < CURDATE()), 0)";
    const totalCampaignPostViewsExpr = hasCampaignPostViews
      ? "SELECT SUM(cp.views) as total_views"
      : "SELECT COUNT(cp.id) as total_views";
    const broadcastSpendExpr = hasBroadcastDeliveryCost
      ? "COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)"
      : "0";
    const broadcastTodaySpendExpr = hasBroadcastDeliveryCost
      ? "COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= CURDATE()), 0)"
      : "0";
    const clickSettlementSpendExpr = hasClickSettlementAdvertiserPaid
      ? "COALESCE((SELECT SUM(s.advertiser_paid) FROM ad_settlements s WHERE s.campaign_id = c.id), 0)"
      : "0";
    const viewSettlementSpendExpr = canUseViewSettlementSpend
      ? "COALESCE((SELECT SUM(sv.advertiser_paid) FROM ad_settlements_views sv WHERE sv.campaign_id = c.id), 0)"
      : "0";
    const clickSettlementTodaySpendExpr = hasClickSettlementAdvertiserPaid
      ? "COALESCE((SELECT SUM(s.advertiser_paid) FROM ad_settlements s WHERE s.campaign_id = c.id AND s.created_at >= CURDATE()), 0)"
      : "0";
    const viewSettlementTodaySpendExpr = canUseViewSettlementSpend
      ? "COALESCE((SELECT SUM(sv.advertiser_paid) FROM ad_settlements_views sv WHERE sv.campaign_id = c.id AND sv.created_at >= CURDATE()), 0)"
      : "0";
    const totalClickSettlementSpendExpr = hasClickSettlementAdvertiserPaid
      ? "COALESCE((SELECT SUM(s.advertiser_paid) FROM ad_settlements s JOIN campaigns c ON s.campaign_id = c.id WHERE c.user_id = ?), 0)"
      : "0";
    const totalViewSettlementSpendExpr = canUseViewSettlementSpend
      ? "COALESCE((SELECT SUM(sv.advertiser_paid) FROM ad_settlements_views sv JOIN campaigns c ON sv.campaign_id = c.id WHERE c.user_id = ?), 0)"
      : "0";
    const totalBroadcastSpendExpr = hasBroadcastDeliveryCost
      ? "COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd JOIN campaigns c ON bd.campaign_id = c.id WHERE c.user_id = ?), 0)"
      : "0";
    const adSpendParams = [
      ...(hasClickSettlementAdvertiserPaid ? [user.id] : []),
      ...(canUseViewSettlementSpend ? [user.id] : []),
      ...(hasBroadcastDeliveryCost ? [user.id] : []),
      user.id,
    ];

    // 1. Get Ad Balance from user table
    const [userRows]: any = await pool.query("SELECT ad_balance, advertiser_trust_level FROM users WHERE id = ?", [user.id]);
    const adBalance = parseFloat(userRows[0]?.ad_balance || "0");
    const advertiserTrustLevel = userRows[0]?.advertiser_trust_level || "new";

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

    // 5. Get Recent Campaigns (channel/bot campaigns + Mini App campaigns, merged into one list)
    const [channelAndBotCampaigns]: any = await pool.query(
      `SELECT
        c.id,
        c.name,
        c.type,
        c.category,
        c.status,
        c.budget,
        c.created_at,
        COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'campaign' AND conv.campaign_id = c.id), 0) as conversions,
        COALESCE((SELECT SUM(conv.conversion_value) FROM ad_conversions conv WHERE conv.campaign_type = 'campaign' AND conv.campaign_id = c.id), 0) as conversion_value,
        CASE
          WHEN c.type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)
          ELSE ${campaignPostImpressionsExpr}
        END as impressions,
        CASE
          WHEN c.type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= CURDATE()), 0)
          ELSE ${campaignPostTodayImpressionsExpr}
        END as today_impressions,
        CASE
          WHEN c.type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND bd.created_at < CURDATE()), 0)
          ELSE ${campaignPostYesterdayImpressionsExpr}
        END as yesterday_impressions,
        CASE
          WHEN c.type = 'broadcast' THEN ${broadcastSpendExpr}
          ELSE (
            ${clickSettlementSpendExpr}
            + ${viewSettlementSpendExpr}
          )
        END as spend,
        CASE
          WHEN c.type = 'broadcast' THEN ${broadcastTodaySpendExpr}
          ELSE (
            ${clickSettlementTodaySpendExpr}
            + ${viewSettlementTodaySpendExpr}
          )
        END as today_spend,
        CASE
          WHEN c.type = 'broadcast' THEN (SELECT MAX(bd.created_at) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id)
          ELSE (SELECT MAX(cp.created_at) FROM campaign_posts cp WHERE cp.campaign_id = c.id)
        END as last_displayed_at
       FROM campaigns c
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT 5`,
      [user.id]
    );
    const [miniAppCampaigns]: any = await pool.query(
      `SELECT
        c.id,
        c.campaign_name as name,
        'miniapp' as type,
        NULL as category,
        c.status,
        c.remaining_budget as budget,
        c.remaining_budget,
        c.created_at,
        COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0) as conversions,
        COALESCE((SELECT SUM(conv.conversion_value) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0) as conversion_value,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) as today_impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND i.created_at < CURDATE()), 0) as yesterday_impressions,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as spend,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) as today_spend,
        (SELECT MAX(i.created_at) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id) as last_displayed_at
       FROM miniapp_rewarded_campaigns c
       WHERE c.advertiser_id = ?
       ORDER BY c.created_at DESC
       LIMIT 5`,
      [user.id]
    );
    const recentCampaigns = [...channelAndBotCampaigns, ...miniAppCampaigns]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

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
      `${totalCampaignPostViewsExpr}
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
    // Get total miniapp impressions for this advertiser
    const [miniappImpressionsResult]: any = await pool.query(
      `SELECT COUNT(i.id) as total
       FROM miniapp_internal_ad_impressions i
       JOIN miniapp_rewarded_campaigns mrc ON i.campaign_id = mrc.id
       WHERE mrc.advertiser_id = ?`,
      [user.id]
    );
    const miniappImpressions = Number(miniappImpressionsResult[0]?.total || 0);

    const conversionSummary = await advertiserConversionSummary(user.id);
    const conversions = Number(conversionSummary.conversions || 0);
    const trackedClicks = Number(conversionSummary.tracked_clicks || 0);
    const conversionValue = Number(conversionSummary.conversion_value || 0);
    const adSpendRows: any = await pool.query(
      `SELECT
        (
          ${totalClickSettlementSpendExpr}
          + ${totalViewSettlementSpendExpr}
          + ${totalBroadcastSpendExpr}
          + COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i JOIN miniapp_rewarded_campaigns mrc ON i.campaign_id = mrc.id WHERE mrc.advertiser_id = ?), 0)
        ) as spend`,
      adSpendParams
    );
    const adSpend = Number(adSpendRows[0]?.[0]?.spend || 0);

    return NextResponse.json({
      ad_balance: adBalance,
      ad_balance_locked: lockedBalance,
      active_ads: activeAds,
      total_campaigns: totalCampaigns,
      total_views: totalViews,
      total_clicks: totalClicks,
      total_spent: totalSpent,
      tracked_clicks: trackedClicks,
      conversions,
      conversion_rate: trackedClicks > 0 ? conversions / trackedClicks : 0,
      cost_per_conversion: conversions > 0 ? adSpend / conversions : 0,
      conversion_value: conversionValue,
      miniapp_impressions: miniappImpressions,
      advertiser_trust_level: advertiserTrustLevel,
      advertiser_trust_label: advertiserTrustLabel(advertiserTrustLevel),
      recent_campaigns: recentCampaigns
    });

  } catch (error: any) {
    console.error("Stats API Error:", error);
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}
