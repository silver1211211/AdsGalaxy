import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = Pool | PoolConnection;

export type CampaignClickAnalytics = {
  actualTrackedClicks: number;
  recoveryBaseline: number;
  additiveAdjustment: number;
  displayedClicks: number;
};

export function adjustedClickTotal(actual: number, baseline: number, additive = 0) {
  return Math.max(Math.max(0,actual),Math.max(0,baseline)) + Math.max(0,additive);
}

export async function getCampaignClickAnalytics(campaignId: number, db: Db = pool): Promise<CampaignClickAnalytics> {
  const [[row]] = await db.query<Array<RowDataPacket & { actual_clicks: number; baseline_clicks: number; additive_clicks: number }>>(
    `SELECT
       (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id=c.id) actual_clicks,
       COALESCE((SELECT MAX(quantity) FROM campaign_analytics_adjustments a WHERE a.campaign_id=c.id AND a.metric='clicks' AND a.adjustment_mode='baseline' AND a.active=1),0) baseline_clicks,
       COALESCE((SELECT SUM(quantity) FROM campaign_analytics_adjustments a WHERE a.campaign_id=c.id AND a.metric='clicks' AND a.adjustment_mode='additive' AND a.active=1),0) additive_clicks
     FROM campaigns c WHERE c.id=?`, [campaignId]);
  const actualTrackedClicks=Number(row?.actual_clicks||0);
  const recoveryBaseline=Number(row?.baseline_clicks||0);
  const additiveAdjustment=Number(row?.additive_clicks||0);
  return {actualTrackedClicks,recoveryBaseline,additiveAdjustment,displayedClicks:adjustedClickTotal(actualTrackedClicks,recoveryBaseline,additiveAdjustment)};
}

export function displayedClicksSql(campaignAlias="c") {
  return `(GREATEST(
    COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id=${campaignAlias}.id),0),
    COALESCE((SELECT MAX(a.quantity) FROM campaign_analytics_adjustments a WHERE a.campaign_id=${campaignAlias}.id AND a.metric='clicks' AND a.adjustment_mode='baseline' AND a.active=1),0)
  ) + COALESCE((SELECT SUM(a.quantity) FROM campaign_analytics_adjustments a WHERE a.campaign_id=${campaignAlias}.id AND a.metric='clicks' AND a.adjustment_mode='additive' AND a.active=1),0))`;
}
