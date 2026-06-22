import pool from "@/lib/db";

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

export async function getMiniAppGlobalRevenueSummary() {
  const [rows]: any = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN ds.network_name <> 'AdsGalaxyInternal' THEN ds.impressions ELSE 0 END), 0) as external_impressions,
      COALESCE(SUM(CASE WHEN ds.network_name <> 'AdsGalaxyInternal' THEN ds.gross_revenue ELSE 0 END), 0) as external_ad_revenue,
      COALESCE(SUM(CASE WHEN ds.network_name <> 'AdsGalaxyInternal' THEN ds.ads_galaxy_fee ELSE 0 END), 0) as platform_fee_revenue,
      COALESCE(SUM(CASE WHEN ds.network_name <> 'AdsGalaxyInternal' THEN ds.publisher_revenue ELSE 0 END), 0) as external_publisher_revenue,
      COALESCE(SUM(CASE WHEN ds.network_name = 'AdsGalaxyInternal' THEN ds.impressions ELSE 0 END), 0) as internal_impressions,
      COALESCE(SUM(CASE WHEN ds.network_name = 'AdsGalaxyInternal' THEN ds.publisher_revenue ELSE 0 END), 0) as internal_ad_revenue,
      COALESCE(SUM(ds.impressions), 0) as total_impressions,
      COALESCE(SUM(ds.publisher_revenue), 0) as publisher_revenue,
      CASE WHEN COALESCE(SUM(ds.impressions), 0) > 0 THEN (SUM(ds.publisher_revenue) / SUM(ds.impressions)) * 1000 ELSE 0 END as blended_cpm
    FROM miniapp_daily_stats ds
  `);

  const row = rows[0] || {};
  return {
    external_impressions: toNumber(row.external_impressions),
    external_ad_revenue: toNumber(row.external_ad_revenue),
    platform_fee_revenue: toNumber(row.platform_fee_revenue),
    external_publisher_revenue: toNumber(row.external_publisher_revenue),
    internal_impressions: toNumber(row.internal_impressions),
    internal_ad_revenue: toNumber(row.internal_ad_revenue),
    total_impressions: toNumber(row.total_impressions),
    publisher_revenue: toNumber(row.publisher_revenue),
    blended_cpm: toNumber(row.blended_cpm),
  };
}

export async function getMiniAppPublisherRevenueSummary(userId: number | string) {
  const [rows]: any = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN ds.network_name <> 'AdsGalaxyInternal' THEN ds.publisher_revenue ELSE 0 END), 0) as external_publisher_revenue,
      COALESCE(SUM(CASE WHEN ds.network_name = 'AdsGalaxyInternal' THEN ds.publisher_revenue ELSE 0 END), 0) as internal_ad_revenue,
      COALESCE(SUM(ds.publisher_revenue), 0) as total_revenue,
      COALESCE(SUM(ds.impressions), 0) as total_impressions,
      CASE WHEN COALESCE(SUM(ds.impressions), 0) > 0 THEN (SUM(ds.publisher_revenue) / SUM(ds.impressions)) * 1000 ELSE 0 END as blended_cpm
    FROM miniapp_daily_stats ds
    JOIN miniapps m ON ds.miniapp_id = m.id
    WHERE m.user_id = ?
  `, [userId]);

  const row = rows[0] || {};
  return {
    external_publisher_revenue: toNumber(row.external_publisher_revenue),
    internal_ad_revenue: toNumber(row.internal_ad_revenue),
    total_revenue: toNumber(row.total_revenue),
    total_impressions: toNumber(row.total_impressions),
    blended_cpm: toNumber(row.blended_cpm),
  };
}
