import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

export type IntelligenceRange = {
  key: string;
  start: string;
  end: string;
  label: string;
};

type MetricRow = {
  campaign_type: "campaign" | "miniapp";
  campaign_id: number;
  name: string;
  type: string;
  category: string;
  status: string;
  budget: number;
  cpm: number;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversion_value: number;
  avg_traffic_quality: number;
  avg_inventory_quality: number;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sqlDate(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function resolveIntelligenceRange(params: URLSearchParams): IntelligenceRange {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const key = params.get("range") || "last_7_days";

  if (key === "today") return { key, start: sqlDate(today), end: sqlDate(tomorrow), label: "Today" };
  if (key === "yesterday") {
    const start = new Date(today);
    start.setDate(start.getDate() - 1);
    return { key, start: sqlDate(start), end: sqlDate(today), label: "Yesterday" };
  }
  if (key === "last_30_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { key, start: sqlDate(start), end: sqlDate(tomorrow), label: "Last 30 Days" };
  }
  if (key === "custom") {
    const rawStart = params.get("start");
    const rawEnd = params.get("end");
    const start = rawStart ? new Date(rawStart) : new Date(today);
    const end = rawEnd ? new Date(rawEnd) : new Date(tomorrow);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start.getTime() < end.getTime()) {
      return { key, start: sqlDate(start), end: sqlDate(end), label: "Custom Range" };
    }
  }

  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  return { key: "last_7_days", start: sqlDate(start), end: sqlDate(tomorrow), label: "Last 7 Days" };
}

export function healthTier(score: number) {
  if (score >= 81) return "Excellent";
  if (score >= 61) return "Good";
  if (score >= 31) return "Average";
  return "Poor";
}

function qualityLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Very Good";
  if (score >= 60) return "Good";
  if (score >= 40) return "Average";
  return "Poor";
}

function performanceLabel(score: number) {
  if (score >= 75) return "Excellent";
  if (score >= 55) return "Good";
  if (score >= 35) return "Average";
  return "Poor";
}

function enrichMetrics(row: MetricRow) {
  const ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
  const conversionRate = row.clicks > 0 ? row.conversions / row.clicks : 0;
  const cpa = row.conversions > 0 ? row.spend / row.conversions : 0;
  const roi = row.spend > 0 ? (row.conversion_value - row.spend) / row.spend : 0;
  const healthScore = campaignHealthScore({
    ctr,
    conversionRate,
    trafficQuality: row.avg_traffic_quality,
    inventoryQuality: row.avg_inventory_quality,
    spend: row.spend,
    impressions: row.impressions,
  });

  return {
    ...row,
    ctr,
    conversion_rate: conversionRate,
    cpa,
    roi,
    health_score: healthScore,
    health_tier: healthTier(healthScore),
    benchmark: benchmarkLabel(healthScore),
  };
}

function campaignHealthScore(input: {
  ctr: number;
  conversionRate: number;
  trafficQuality: number;
  inventoryQuality: number;
  spend: number;
  impressions: number;
}) {
  const ctrScore = clamp(input.ctr * 2500, 0, 100);
  const conversionScore = clamp(input.conversionRate * 500, 0, 100);
  const qualityScore = clamp(input.trafficQuality || 60, 0, 100);
  const inventoryScore = clamp(input.inventoryQuality || 50, 0, 100);
  const activityScore = input.impressions > 0 || input.spend > 0 ? 75 : 35;
  return Math.round(ctrScore * 0.25 + conversionScore * 0.25 + qualityScore * 0.2 + inventoryScore * 0.2 + activityScore * 0.1);
}

function benchmarkLabel(score: number) {
  if (score >= 70) return "Above Average";
  if (score >= 45) return "Average";
  return "Below Average";
}

function campaignAutoInsight(row: ReturnType<typeof enrichMetrics>) {
  const changed = row.impressions === 0
    ? "Delivery has not started in this range."
    : row.health_score >= 70
      ? "Performance is trending healthy."
      : row.health_score < 40
        ? "Performance is below the healthy range."
        : "Performance is stable but can improve.";
  const why = row.impressions === 0
    ? "The campaign may be limited by CPM, targeting, approval status, or eligible inventory."
    : row.ctr < 0.005
      ? "Engagement is weak compared with recent delivery volume."
      : row.conversion_rate < 0.02 && row.clicks > 20
        ? "Clicks are arriving but conversion follow-through is low."
        : row.avg_traffic_quality < 45
          ? "Traffic quality signals are lower than recommended."
          : "Delivery, engagement, and quality signals are balanced.";
  const next = row.impressions === 0
    ? "Review CPM, targeting breadth, and approval state."
    : row.ctr < 0.005
      ? "Refresh creative, shorten the title, and use a clearer CTA."
      : row.conversion_rate < 0.02 && row.clicks > 20
        ? "Review landing page speed, offer clarity, and postback setup."
        : row.avg_inventory_quality >= 70
          ? "Consider increasing budget while monitoring conversion quality."
          : "Shift delivery toward stronger inventory and review targeting.";
  return { changed, why, next };
}

function aggregate(rows: ReturnType<typeof enrichMetrics>[]) {
  const totals = rows.reduce((acc, row) => {
    acc.impressions += row.impressions;
    acc.clicks += row.clicks;
    acc.spend += row.spend;
    acc.conversions += row.conversions;
    acc.conversion_value += row.conversion_value;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversion_value: 0 });

  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const conversionRate = totals.clicks > 0 ? totals.conversions / totals.clicks : 0;
  const cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
  const roi = totals.spend > 0 ? (totals.conversion_value - totals.spend) / totals.spend : 0;
  const healthScore = rows.length > 0
    ? Math.round(rows.reduce((sum, row) => sum + row.health_score, 0) / rows.length)
    : 0;

  return {
    ...totals,
    ctr,
    conversion_rate: conversionRate,
    cpa,
    estimated_roi: roi,
    health_score: healthScore,
    health_tier: healthTier(healthScore),
    benchmark: benchmarkLabel(healthScore),
  };
}

async function queryCampaignRows(advertiserId: number, range: IntelligenceRange, conn: PoolConnection | typeof pool) {
  const [campaignRows]: any = await conn.query(
    `SELECT
      'campaign' as campaign_type,
      c.id as campaign_id,
      c.name,
      c.type,
      COALESCE(c.category, 'General') as category,
      c.status,
      COALESCE(c.budget, 0) as budget,
      COALESCE(c.cpm, 0) as cpm,
      CASE
        WHEN c.type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= ? AND bd.created_at < ?), 0)
        ELSE COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= ? AND cp.created_at < ?), 0)
      END as impressions,
      COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id AND cc.created_at >= ? AND cc.created_at < ?), 0)
        + COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'campaign' AND ac.campaign_id = c.id AND ac.created_at >= ? AND ac.created_at < ?), 0) as clicks,
      CASE
        WHEN c.type = 'broadcast' THEN COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= ? AND bd.created_at < ?), 0)
        ELSE (
          COALESCE((SELECT SUM(s.advertiser_paid) FROM ad_settlements s WHERE s.campaign_id = c.id AND s.created_at >= ? AND s.created_at < ?), 0)
          + COALESCE((SELECT SUM(sv.advertiser_paid) FROM ad_settlements_views sv WHERE sv.campaign_id = c.id AND sv.created_at >= ? AND sv.created_at < ?), 0)
        )
      END as spend,
      COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'campaign' AND conv.campaign_id = c.id AND conv.created_at >= ? AND conv.created_at < ?), 0) as conversions,
      COALESCE((SELECT SUM(conv.conversion_value) FROM ad_conversions conv WHERE conv.campaign_type = 'campaign' AND conv.campaign_id = c.id AND conv.created_at >= ? AND conv.created_at < ?), 0) as conversion_value,
      CASE
        WHEN c.type = 'broadcast' THEN COALESCE((SELECT AVG(b.traffic_quality_score) FROM broadcast_deliveries bd JOIN bots b ON b.id = bd.bot_id WHERE bd.campaign_id = c.id AND bd.created_at >= ? AND bd.created_at < ?), 60)
        ELSE COALESCE((SELECT AVG(ch.traffic_quality_score) FROM campaign_posts cp JOIN channels ch ON ch.id = cp.channel_id WHERE cp.campaign_id = c.id AND cp.created_at >= ? AND cp.created_at < ?), 60)
      END as avg_traffic_quality,
      CASE
        WHEN c.type = 'broadcast' THEN COALESCE((SELECT AVG(b.inventory_score) FROM broadcast_deliveries bd JOIN bots b ON b.id = bd.bot_id WHERE bd.campaign_id = c.id AND bd.created_at >= ? AND bd.created_at < ?), 50)
        ELSE COALESCE((SELECT AVG(ch.inventory_score) FROM campaign_posts cp JOIN channels ch ON ch.id = cp.channel_id WHERE cp.campaign_id = c.id AND cp.created_at >= ? AND cp.created_at < ?), 50)
      END as avg_inventory_quality
    FROM campaigns c
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC`,
    [
      range.start, range.end, range.start, range.end,
      range.start, range.end, range.start, range.end,
      range.start, range.end, range.start, range.end, range.start, range.end,
      range.start, range.end, range.start, range.end,
      range.start, range.end, range.start, range.end,
      range.start, range.end, range.start, range.end,
      advertiserId,
    ]
  );

  const [miniRows]: any = await conn.query(
    `SELECT
      'miniapp' as campaign_type,
      c.id as campaign_id,
      c.campaign_name as name,
      'miniapp' as type,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.categories, '$[0]')), 'Mini App') as category,
      c.status,
      COALESCE(c.remaining_budget, c.budget, 0) as budget,
      COALESCE(c.advertiser_cpm_bid, c.admin_cpm, 0) as cpm,
      COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= ? AND i.created_at < ?), 0) as impressions,
      COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id AND ac.created_at >= ? AND ac.created_at < ?), 0) as clicks,
      COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= ? AND i.created_at < ?), 0) as spend,
      COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id AND conv.created_at >= ? AND conv.created_at < ?), 0) as conversions,
      COALESCE((SELECT SUM(conv.conversion_value) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id AND conv.created_at >= ? AND conv.created_at < ?), 0) as conversion_value,
      COALESCE((SELECT AVG(m.traffic_quality_score) FROM miniapp_internal_ad_impressions i JOIN miniapps m ON m.id = i.miniapp_id WHERE i.campaign_id = c.id AND i.created_at >= ? AND i.created_at < ?), 60) as avg_traffic_quality,
      COALESCE((SELECT AVG(m.inventory_score) FROM miniapp_internal_ad_impressions i JOIN miniapps m ON m.id = i.miniapp_id WHERE i.campaign_id = c.id AND i.created_at >= ? AND i.created_at < ?), 50) as avg_inventory_quality
    FROM miniapp_rewarded_campaigns c
    WHERE c.advertiser_id = ?
    ORDER BY c.created_at DESC`,
    [
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      advertiserId,
    ]
  );

  return [...campaignRows, ...miniRows].map((row) => {
    const enriched = enrichMetrics({
    ...row,
    campaign_id: Number(row.campaign_id),
    budget: toNumber(row.budget),
    cpm: toNumber(row.cpm),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    spend: toNumber(row.spend),
    conversions: toNumber(row.conversions),
    conversion_value: toNumber(row.conversion_value),
    avg_traffic_quality: toNumber(row.avg_traffic_quality || 60),
    avg_inventory_quality: toNumber(row.avg_inventory_quality || 50),
    });
    return {
      ...enriched,
      auto_insight: campaignAutoInsight(enriched),
      health_explanation: campaignAutoInsight(enriched).why,
    };
  });
}

function summarizeGroups(rows: Array<Record<string, unknown>>, keyField: string) {
  return rows.map((row) => {
    const impressions = toNumber(row.impressions);
    const clicks = toNumber(row.clicks);
    const conversions = toNumber(row.conversions);
    const spend = toNumber(row.spend);
    const conversionValue = toNumber(row.conversion_value);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const conversionRate = clicks > 0 ? conversions / clicks : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const roi = spend > 0 ? (conversionValue - spend) / spend : 0;
    const score = Math.round(clamp(ctr * 2000, 0, 50) + clamp(conversionRate * 500, 0, 35) + clamp(roi * 20 + 15, 0, 15));
    return {
      key: String(row[keyField] || "Unknown"),
      impressions,
      clicks,
      conversions,
      spend,
      conversion_value: conversionValue,
      ctr,
      conversion_rate: conversionRate,
      cpa,
      roi,
      rating: performanceLabel(score),
    };
  });
}

async function queryBreakdowns(advertiserId: number, range: IntelligenceRange, conn: PoolConnection | typeof pool) {
  const [categoryRows]: any = await conn.query(
    `SELECT category, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spend) as spend, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
     FROM (
       SELECT COALESCE(c.category, 'General') as category, COALESCE(SUM(cp.views), 0) as impressions, 0 as clicks, COALESCE(SUM(sv.advertiser_paid), 0) as spend, 0 as conversions, 0 as conversion_value
       FROM campaigns c
       LEFT JOIN campaign_posts cp ON cp.campaign_id = c.id AND cp.created_at >= ? AND cp.created_at < ?
       LEFT JOIN ad_settlements_views sv ON sv.campaign_id = c.id AND sv.created_at >= ? AND sv.created_at < ?
       WHERE c.user_id = ?
       GROUP BY COALESCE(c.category, 'General')
       UNION ALL
       SELECT COALESCE(ac.category, c.category, 'General') as category, 0, COUNT(*), 0, 0, 0
       FROM ad_click_attribution ac JOIN campaigns c ON c.id = ac.campaign_id
       WHERE ac.campaign_type = 'campaign' AND ac.advertiser_id = ? AND ac.created_at >= ? AND ac.created_at < ?
       GROUP BY COALESCE(ac.category, c.category, 'General')
       UNION ALL
       SELECT COALESCE(conv.event_type, 'Conversion') as category, 0, 0, 0, COUNT(*), SUM(conv.conversion_value)
       FROM ad_conversions conv
       WHERE conv.advertiser_id = ? AND conv.created_at >= ? AND conv.created_at < ?
       GROUP BY COALESCE(conv.event_type, 'Conversion')
     ) x
     GROUP BY category`,
    [range.start, range.end, range.start, range.end, advertiserId, advertiserId, range.start, range.end, advertiserId, range.start, range.end]
  );

  const [countryRows]: any = await conn.query(
    `SELECT country, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spend) as spend, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
     FROM (
       SELECT COALESCE(i.country, m.marketplace_country, 'Global') as country, COUNT(*) as impressions, 0 as clicks, SUM(i.cost) as spend, 0 as conversions, 0 as conversion_value
       FROM miniapp_internal_ad_impressions i
       JOIN miniapp_rewarded_campaigns c ON c.id = i.campaign_id
       LEFT JOIN miniapps m ON m.id = i.miniapp_id
       WHERE c.advertiser_id = ? AND i.created_at >= ? AND i.created_at < ?
       GROUP BY COALESCE(i.country, m.marketplace_country, 'Global')
       UNION ALL
       SELECT COALESCE(ch.marketplace_country, 'Global') as country, SUM(cp.views), 0, 0, 0, 0
       FROM campaign_posts cp JOIN campaigns c ON c.id = cp.campaign_id LEFT JOIN channels ch ON ch.id = cp.channel_id
       WHERE c.user_id = ? AND cp.created_at >= ? AND cp.created_at < ?
       GROUP BY COALESCE(ch.marketplace_country, 'Global')
       UNION ALL
       SELECT COALESCE(b.marketplace_country, 'Global') as country, COUNT(*), 0, SUM(bd.cost), 0, 0
       FROM broadcast_deliveries bd JOIN campaigns c ON c.id = bd.campaign_id LEFT JOIN bots b ON b.id = bd.bot_id
       WHERE c.user_id = ? AND bd.created_at >= ? AND bd.created_at < ?
       GROUP BY COALESCE(b.marketplace_country, 'Global')
       UNION ALL
       SELECT 'Tracked Clicks' as country, 0, COUNT(*), 0, 0, 0
       FROM ad_click_attribution ac WHERE ac.advertiser_id = ? AND ac.created_at >= ? AND ac.created_at < ?
       UNION ALL
       SELECT 'Conversions' as country, 0, 0, 0, COUNT(*), SUM(conversion_value)
       FROM ad_conversions conv WHERE conv.advertiser_id = ? AND conv.created_at >= ? AND conv.created_at < ?
     ) x
     GROUP BY country`,
    [advertiserId, range.start, range.end, advertiserId, range.start, range.end, advertiserId, range.start, range.end, advertiserId, range.start, range.end, advertiserId, range.start, range.end]
  );

  const [languageRows]: any = await conn.query(
    `SELECT language, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spend) as spend, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
     FROM (
       SELECT COALESCE(m.marketplace_language, 'All') as language, COUNT(*) as impressions, 0 as clicks, SUM(i.cost) as spend, 0 as conversions, 0 as conversion_value
       FROM miniapp_internal_ad_impressions i JOIN miniapp_rewarded_campaigns c ON c.id = i.campaign_id LEFT JOIN miniapps m ON m.id = i.miniapp_id
       WHERE c.advertiser_id = ? AND i.created_at >= ? AND i.created_at < ?
       GROUP BY COALESCE(m.marketplace_language, 'All')
       UNION ALL
       SELECT COALESCE(ch.marketplace_language, 'All') as language, SUM(cp.views), 0, 0, 0, 0
       FROM campaign_posts cp JOIN campaigns c ON c.id = cp.campaign_id LEFT JOIN channels ch ON ch.id = cp.channel_id
       WHERE c.user_id = ? AND cp.created_at >= ? AND cp.created_at < ?
       GROUP BY COALESCE(ch.marketplace_language, 'All')
       UNION ALL
       SELECT COALESCE(b.marketplace_language, 'All') as language, COUNT(*), 0, SUM(bd.cost), 0, 0
       FROM broadcast_deliveries bd JOIN campaigns c ON c.id = bd.campaign_id LEFT JOIN bots b ON b.id = bd.bot_id
       WHERE c.user_id = ? AND bd.created_at >= ? AND bd.created_at < ?
       GROUP BY COALESCE(b.marketplace_language, 'All')
     ) x
     GROUP BY language`,
    [advertiserId, range.start, range.end, advertiserId, range.start, range.end, advertiserId, range.start, range.end]
  );

  const [inventoryRows]: any = await conn.query(
    `SELECT inventory_type, inventory_id, name, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spend) as spend, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
     FROM (
       SELECT 'Mini App' as inventory_type, m.id as inventory_id, m.miniapp_name as name, COUNT(*) as impressions, 0 as clicks, SUM(i.cost) as spend, 0 as conversions, 0 as conversion_value
       FROM miniapp_internal_ad_impressions i JOIN miniapp_rewarded_campaigns c ON c.id = i.campaign_id LEFT JOIN miniapps m ON m.id = i.miniapp_id
       WHERE c.advertiser_id = ? AND i.created_at >= ? AND i.created_at < ?
       GROUP BY m.id, m.miniapp_name
       UNION ALL
       SELECT 'Channel', ch.id, ch.title, SUM(cp.views), 0, 0, 0, 0
       FROM campaign_posts cp JOIN campaigns c ON c.id = cp.campaign_id LEFT JOIN channels ch ON ch.id = cp.channel_id
       WHERE c.user_id = ? AND cp.created_at >= ? AND cp.created_at < ?
       GROUP BY ch.id, ch.title
       UNION ALL
       SELECT 'Bot', b.id, b.bot_name, COUNT(*), 0, SUM(bd.cost), 0, 0
       FROM broadcast_deliveries bd JOIN campaigns c ON c.id = bd.campaign_id LEFT JOIN bots b ON b.id = bd.bot_id
       WHERE c.user_id = ? AND bd.created_at >= ? AND bd.created_at < ?
       GROUP BY b.id, b.bot_name
       UNION ALL
       SELECT CONCAT(UCASE(LEFT(ac.inventory_type, 1)), SUBSTRING(ac.inventory_type, 2)), ac.inventory_id, CONCAT('Inventory #', ac.inventory_id), 0, COUNT(*), 0, 0, 0
       FROM ad_click_attribution ac WHERE ac.advertiser_id = ? AND ac.created_at >= ? AND ac.created_at < ? AND ac.inventory_id IS NOT NULL
       GROUP BY ac.inventory_type, ac.inventory_id
     ) x
     GROUP BY inventory_type, inventory_id, name`,
    [advertiserId, range.start, range.end, advertiserId, range.start, range.end, advertiserId, range.start, range.end, advertiserId, range.start, range.end]
  );

  const [creativeRows]: any = await conn.query(
    `SELECT creative, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spend) as spend, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
     FROM (
       SELECT c.name as creative, CASE WHEN c.type = 'broadcast' THEN COUNT(bd.id) ELSE COALESCE(SUM(cp.views), 0) END as impressions, 0 as clicks,
        CASE WHEN c.type = 'broadcast' THEN COALESCE(SUM(bd.cost), 0) ELSE 0 END as spend, 0 as conversions, 0 as conversion_value
       FROM campaigns c
       LEFT JOIN campaign_posts cp ON cp.campaign_id = c.id AND cp.created_at >= ? AND cp.created_at < ?
       LEFT JOIN broadcast_deliveries bd ON bd.campaign_id = c.id AND bd.created_at >= ? AND bd.created_at < ?
       WHERE c.user_id = ?
       GROUP BY c.id, c.name, c.type
       UNION ALL
       SELECT c.campaign_name as creative, COUNT(i.id), 0, COALESCE(SUM(i.cost), 0), 0, 0
       FROM miniapp_rewarded_campaigns c LEFT JOIN miniapp_internal_ad_impressions i ON i.campaign_id = c.id AND i.created_at >= ? AND i.created_at < ?
       WHERE c.advertiser_id = ?
       GROUP BY c.id, c.campaign_name
       UNION ALL
       SELECT COALESCE(ac.creative_id, CONCAT(ac.campaign_type, '#', ac.campaign_id)) as creative, 0, COUNT(*), 0, 0, 0
       FROM ad_click_attribution ac WHERE ac.advertiser_id = ? AND ac.created_at >= ? AND ac.created_at < ?
       GROUP BY COALESCE(ac.creative_id, CONCAT(ac.campaign_type, '#', ac.campaign_id))
       UNION ALL
       SELECT CONCAT(conv.campaign_type, '#', conv.campaign_id) as creative, 0, 0, 0, COUNT(*), SUM(conv.conversion_value)
       FROM ad_conversions conv WHERE conv.advertiser_id = ? AND conv.created_at >= ? AND conv.created_at < ?
       GROUP BY CONCAT(conv.campaign_type, '#', conv.campaign_id)
     ) x
     GROUP BY creative`,
    [range.start, range.end, range.start, range.end, advertiserId, range.start, range.end, advertiserId, advertiserId, range.start, range.end, advertiserId, range.start, range.end]
  );

  const category = summarizeGroups(categoryRows, "category");
  const country = summarizeGroups(countryRows, "country");
  const language = summarizeGroups(languageRows, "language");
  const inventory = summarizeGroups(inventoryRows, "name").map((item, index) => ({ ...item, inventory_type: inventoryRows[index]?.inventory_type || "Inventory" }));
  const creative = summarizeGroups(creativeRows, "creative");

  return {
    category,
    country,
    language,
    inventory,
    creative,
    top_categories: [...category].sort((a, b) => b.conversions - a.conversions || b.ctr - a.ctr).slice(0, 5),
    worst_categories: [...category].sort((a, b) => a.conversions - b.conversions || a.ctr - b.ctr).slice(0, 5),
    top_countries: [...country].sort((a, b) => b.conversions - a.conversions || b.impressions - a.impressions).slice(0, 5),
    worst_countries: [...country].sort((a, b) => a.conversions - b.conversions || a.ctr - b.ctr).slice(0, 5),
    highest_ctr_countries: [...country].sort((a, b) => b.ctr - a.ctr).slice(0, 5),
    highest_conversion_countries: [...country].sort((a, b) => b.conversion_rate - a.conversion_rate).slice(0, 5),
    top_languages: [...language].sort((a, b) => b.conversions - a.conversions || b.ctr - a.ctr).slice(0, 5),
    worst_languages: [...language].sort((a, b) => a.conversions - b.conversions || a.ctr - b.ctr).slice(0, 5),
    best_miniapps: inventory.filter((item) => item.inventory_type === "Mini App").sort((a, b) => b.conversions - a.conversions || b.ctr - a.ctr).slice(0, 5),
    best_channels: inventory.filter((item) => item.inventory_type === "Channel").sort((a, b) => b.conversions - a.conversions || b.ctr - a.ctr).slice(0, 5),
    best_bots: inventory.filter((item) => item.inventory_type === "Bot").sort((a, b) => b.conversions - a.conversions || b.ctr - a.ctr).slice(0, 5),
  };
}

function buildRecommendations(summary: ReturnType<typeof aggregate>, campaigns: ReturnType<typeof enrichMetrics>[], breakdowns: any) {
  const recommendations = [];
  if (summary.ctr < 0.005 && summary.impressions > 100) {
    recommendations.push({ type: "creative", severity: "high", title: "Improve creatives to raise CTR", detail: "CTR is below the expected range. Test clearer copy, stronger CTA text, or fresher creative variants." });
  }
  if (summary.conversion_rate < 0.02 && summary.clicks > 25) {
    recommendations.push({ type: "landing", severity: "medium", title: "Review post-click experience", detail: "Clicks are arriving, but conversion rate is low. Check landing speed, offer fit, and postback setup." });
  }
  if (campaigns.some((campaign) => campaign.cpm > 0 && campaign.impressions === 0 && ["active", "approved"].includes(campaign.status))) {
    recommendations.push({ type: "cpm", severity: "medium", title: "Increase CPM to unlock more delivery", detail: "One or more active campaigns have little delivery. Raising CPM can help reach more eligible inventory." });
  }
  if (breakdowns.worst_countries?.length > 0 && breakdowns.worst_countries[0].impressions > 100) {
    recommendations.push({ type: "country", severity: "info", title: "Remove low-performing countries", detail: `Consider excluding or lowering focus on ${breakdowns.worst_countries[0].key}.` });
  }
  if (breakdowns.top_categories?.length > 0) {
    recommendations.push({ type: "category", severity: "info", title: "Focus on top-performing categories", detail: `${breakdowns.top_categories[0].key} is currently your strongest category signal.` });
  }
  if (summary.spend > 0 && summary.estimated_roi > 0.2) {
    recommendations.push({ type: "budget", severity: "info", title: "Increase budget on profitable campaigns", detail: "Estimated ROI is positive. Consider increasing budget on campaigns with Good or Excellent health." });
  }
  if (breakdowns.creative?.some((creative: any) => creative.impressions > 200 && creative.ctr < 0.003)) {
    recommendations.push({ type: "creative_fatigue", severity: "medium", title: "Pause poor-performing creatives", detail: "At least one creative has delivery but very low engagement. Rotate it out or refresh the message." });
  }
  return recommendations;
}

function buildAlerts(summary: ReturnType<typeof aggregate>, campaigns: ReturnType<typeof enrichMetrics>[]) {
  const alerts = [];
  if (summary.health_score > 0 && summary.health_score <= 30) {
    alerts.push({ type: "underperforming", severity: "high", title: "Campaigns underperforming", detail: "Overall campaign health is Poor. Review targeting, creative, and inventory mix." });
  }
  for (const campaign of campaigns.slice(0, 20)) {
    if (campaign.budget > 0 && campaign.spend / campaign.budget >= 0.85) {
      alerts.push({ type: "budget_nearly_exhausted", severity: "medium", title: `${campaign.name} budget nearly exhausted`, detail: "Budget usage is above 85% for this campaign." });
    }
    if (campaign.impressions > 200 && campaign.ctr < 0.003) {
      alerts.push({ type: "creative_fatigue", severity: "medium", title: `${campaign.name} may have creative fatigue`, detail: "The campaign has meaningful impressions but low CTR." });
    }
    if (campaign.avg_traffic_quality < 45) {
      alerts.push({ type: "traffic_quality", severity: "medium", title: `${campaign.name} has traffic quality concerns`, detail: "Public traffic quality labels suggest delivery quality should be reviewed." });
    }
    if (["active", "approved"].includes(campaign.status) && campaign.cpm > 0 && campaign.impressions === 0) {
      alerts.push({ type: "cpm_too_low", severity: "info", title: `${campaign.name} has low delivery`, detail: "CPM or targeting may be limiting inventory access." });
    }
  }
  return alerts.slice(0, 12);
}

export function forecastFromInput(input: {
  budget: number;
  cpm: number;
  historicalCtr: number;
  historicalConversionRate: number;
}) {
  const impressions = input.cpm > 0 ? input.budget / input.cpm * 1000 : 0;
  const clicks = impressions * (input.historicalCtr || 0.01);
  const conversions = clicks * (input.historicalConversionRate || 0.03);
  return {
    expected_reach: Math.round(impressions * 0.75),
    expected_impressions: Math.round(impressions),
    expected_clicks: Math.round(clicks),
    expected_conversions: Math.round(conversions),
  };
}

export async function getAdvertiserIntelligence(advertiserId: number, range: IntelligenceRange, conn?: PoolConnection) {
  const db = conn || pool;
  const campaigns = await queryCampaignRows(advertiserId, range, db);
  const summary = aggregate(campaigns);
  const breakdowns = await queryBreakdowns(advertiserId, range, db);
  const recommendations = buildRecommendations(summary, campaigns, breakdowns);
  const alerts = buildAlerts(summary, campaigns);
  const forecast = forecastFromInput({
    budget: campaigns.reduce((sum, campaign) => sum + Math.max(campaign.budget - campaign.spend, 0), 0) || 100,
    cpm: campaigns.find((campaign) => campaign.cpm > 0)?.cpm || 1,
    historicalCtr: summary.ctr,
    historicalConversionRate: summary.conversion_rate,
  });

  return {
    range,
    summary,
    campaigns,
    breakdowns,
    recommendations,
    alerts,
    forecast,
  };
}

export async function getAdminAdvertiserAnalytics(range: IntelligenceRange, conn?: PoolConnection) {
  const db = conn || pool;
  const [topAdvertisers]: any = await db.query(
    `SELECT u.id, COALESCE(u.username, CONCAT(u.first_name, ' ', u.last_name), CONCAT('User #', u.id)) as name,
      COALESCE((SELECT SUM(s.advertiser_paid) FROM ad_settlements s JOIN campaigns c ON c.id = s.campaign_id WHERE c.user_id = u.id AND s.created_at >= ? AND s.created_at < ?), 0)
      + COALESCE((SELECT SUM(sv.advertiser_paid) FROM ad_settlements_views sv JOIN campaigns c ON c.id = sv.campaign_id WHERE c.user_id = u.id AND sv.created_at >= ? AND sv.created_at < ?), 0)
      + COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i JOIN miniapp_rewarded_campaigns m ON m.id = i.campaign_id WHERE m.advertiser_id = u.id AND i.created_at >= ? AND i.created_at < ?), 0) as spend
     FROM users u
     ORDER BY spend DESC
     LIMIT 10`,
    [range.start, range.end, range.start, range.end, range.start, range.end]
  );

  const [topCampaigns]: any = await db.query(
    `SELECT 'campaign' as campaign_type, c.id, c.name, COALESCE(SUM(sv.advertiser_paid), 0) + COALESCE(SUM(s.advertiser_paid), 0) as spend
     FROM campaigns c
     LEFT JOIN ad_settlements_views sv ON sv.campaign_id = c.id AND sv.created_at >= ? AND sv.created_at < ?
     LEFT JOIN ad_settlements s ON s.campaign_id = c.id AND s.created_at >= ? AND s.created_at < ?
     GROUP BY c.id, c.name
     UNION ALL
     SELECT 'miniapp', m.id, m.campaign_name, COALESCE(SUM(i.cost), 0)
     FROM miniapp_rewarded_campaigns m
     LEFT JOIN miniapp_internal_ad_impressions i ON i.campaign_id = m.id AND i.created_at >= ? AND i.created_at < ?
     GROUP BY m.id, m.campaign_name
     ORDER BY spend DESC
     LIMIT 10`,
    [range.start, range.end, range.start, range.end, range.start, range.end]
  );

  const [highestRoiCampaigns]: any = await db.query(
    `SELECT campaign_type, campaign_id, SUM(conversion_value) as conversion_value, COUNT(*) as conversions
     FROM ad_conversions
     WHERE created_at >= ? AND created_at < ?
     GROUP BY campaign_type, campaign_id
     ORDER BY conversion_value DESC
     LIMIT 10`,
    [range.start, range.end]
  );

  const [topCategories]: any = await db.query(
    `SELECT COALESCE(category, 'General') as category, COUNT(*) as clicks
     FROM ad_click_attribution
     WHERE created_at >= ? AND created_at < ?
     GROUP BY COALESCE(category, 'General')
     ORDER BY clicks DESC
     LIMIT 10`,
    [range.start, range.end]
  );

  const [topCountries]: any = await db.query(
    `SELECT COALESCE(country, 'Global') as country, COUNT(*) as impressions
     FROM miniapp_internal_ad_impressions
     WHERE created_at >= ? AND created_at < ?
     GROUP BY COALESCE(country, 'Global')
     ORDER BY impressions DESC
     LIMIT 10`,
    [range.start, range.end]
  );

  return { range, top_advertisers: topAdvertisers, top_campaigns: topCampaigns, highest_roi_campaigns: highestRoiCampaigns, top_categories: topCategories, top_countries: topCountries };
}
