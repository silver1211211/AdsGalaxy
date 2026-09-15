/* eslint-disable @typescript-eslint/no-explicit-any -- aggregate rows are dynamically shaped */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { logSlowRequest } from "@/lib/performanceTiming";
import { CACHE_TTL_SECONDS, cacheGetOrSet, redisKeys } from "@/lib/redisCache";
import { getMiniAppCampaignMetricsByAdvertiser } from "@/lib/miniappCampaignMetrics";

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const user = await getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
    const userId = Number(user.id);
    const payload = await cacheGetOrSet(redisKeys.advertiserStats(userId), CACHE_TTL_SECONDS.ADVERTISER_ANALYTICS, async () => {
      const [campaignResult, deliveryResult, miniappCampaignResult, miniappMetrics, accountResult, conversionResult, recentResult] = await Promise.all([
        pool.query(`SELECT COUNT(*) total_campaigns,SUM(status='active') active_ads,COALESCE(SUM(channel_spend),0) channel_spend FROM campaigns WHERE user_id=?`, [userId]),
        pool.query(`SELECT
          (SELECT COALESCE(COUNT(*),0) FROM broadcast_deliveries bd JOIN campaigns c ON c.id=bd.campaign_id WHERE c.user_id=? AND bd.status='sent') broadcast_views,
          (SELECT COALESCE(SUM(cp.views),0) FROM campaign_posts cp JOIN campaigns c ON c.id=cp.campaign_id WHERE c.user_id=? AND c.type<>'broadcast') channel_views,
          (SELECT COALESCE(COUNT(*),0) FROM campaign_clicks cc JOIN campaigns c ON c.id=cc.campaign_id WHERE c.user_id=? AND c.type<>'broadcast') channel_clicks,
          (SELECT COALESCE(SUM(bd.cost),0) FROM broadcast_deliveries bd JOIN campaigns c ON c.id=bd.campaign_id WHERE c.user_id=? AND bd.status='sent') broadcast_spend`, [userId, userId, userId, userId]),
        pool.query(`SELECT COUNT(*) total_campaigns,
          COALESCE(SUM(status IN ('approved','active')),0) active_ads
          FROM miniapp_rewarded_campaigns WHERE advertiser_id=?`, [userId]),
        getMiniAppCampaignMetricsByAdvertiser(userId),
        pool.query("SELECT COALESCE(SUM(amount),0) total_deposited FROM deposits WHERE user_id=? AND status='paid'", [userId]),
        pool.query(`SELECT COUNT(*) conversions,COALESCE(SUM(conversion_value),0) conversion_value,
          COUNT(DISTINCT click_id) tracked_clicks FROM ad_conversions WHERE advertiser_id=?`, [userId]),
        pool.query(`(SELECT 'regular' source,id,name,type,campaign_kind,status,created_at,
          CASE WHEN type='broadcast' THEN (SELECT COALESCE(SUM(cost),0) FROM broadcast_deliveries WHERE campaign_id=campaigns.id AND status='sent') ELSE channel_spend END spend
          FROM campaigns WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1)
          UNION ALL (SELECT 'miniapp' source,id,campaign_name name,'miniapp' type,NULL campaign_kind,status,created_at,total_spend spend
          FROM miniapp_rewarded_campaigns WHERE advertiser_id=? ORDER BY created_at DESC,id DESC LIMIT 1)
          ORDER BY created_at DESC,id DESC,source ASC LIMIT 1`, [userId, userId]),
      ]);
      const campaign: any = (campaignResult[0] as any[])[0] || {};
      const delivery: any = (deliveryResult[0] as any[])[0] || {};
      const miniappCampaign: any = (miniappCampaignResult[0] as any[])[0] || {};
      const miniapp = [...miniappMetrics.values()].reduce((totals, metric) => ({
        views: totals.views + Number(metric.impressions || 0),
        clicks: totals.clicks + Number(metric.clicks || 0),
        spend: totals.spend + Number(metric.spend || 0),
      }), { views: 0, clicks: 0, spend: 0 });
      const account: any = (accountResult[0] as any[])[0] || {};
      const conversion: any = (conversionResult[0] as any[])[0] || {};
      const totalSpent = Number(campaign.channel_spend || 0) + Number(delivery.broadcast_spend || 0) + Number(miniapp.spend || 0);
      const trackedClicks = Number(conversion.tracked_clicks || 0);
      const conversions = Number(conversion.conversions || 0);
      return {
        active_ads: Number(campaign.active_ads || 0) + Number(miniappCampaign.active_ads || 0), total_campaigns: Number(campaign.total_campaigns || 0) + Number(miniappCampaign.total_campaigns || 0),
        total_views: Number(delivery.channel_views || 0) + Number(delivery.broadcast_views || 0) + Number(miniapp.views || 0), total_clicks: Number(delivery.channel_clicks || 0) + Number(miniapp.clicks || 0), total_spent: totalSpent,
        total_deposited: Number(account.total_deposited || 0), tracked_clicks: trackedClicks, conversions,
        conversion_rate: trackedClicks > 0 ? conversions / trackedClicks : 0, cost_per_conversion: conversions > 0 ? totalSpent / conversions : 0,
        conversion_value: Number(conversion.conversion_value || 0), miniapp_impressions: Number(miniapp.views || 0), recent_campaigns: recentResult[0],
      };
    });
    return NextResponse.json({ ...payload, ad_balance: Number(user.ad_balance || 0), ad_balance_locked: Number(user.advertiser_balance_locked || 0) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const status = getAuthErrorStatus(error);
    console.error("Stats API Error:", error);
    return NextResponse.json({ error: status === 500 ? "Failed to load advertiser stats" : "Unauthorized" }, { status });
  } finally { logSlowRequest("/api/advertiser/stats", startedAt); }
}
