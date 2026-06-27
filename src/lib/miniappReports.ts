import pool from "@/lib/db";
import { getInternalAdCompletionAnalytics } from "@/lib/internalAdCompletionQuality";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizeDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function reconcileRevenue(row: Record<string, unknown>) {
  const externalNetRevenue = toNumber(row.external_net_revenue);
  const internalRevenue = toNumber(row.internal_revenue);
  const totalRevenue = toNumber(row.total_revenue);
  const expected = externalNetRevenue + internalRevenue;
  const drift = Math.abs(expected - totalRevenue);

  if (drift > 0.000001) {
    console.warn("Mini App revenue reconciliation mismatch", {
      miniapp_id: row.miniapp_id,
      date: row.date,
      external_net_revenue: externalNetRevenue,
      internal_revenue: internalRevenue,
      total_revenue: totalRevenue,
      drift,
    });
  }

  return {
    reconciliation_ok: drift <= 0.000001,
    reconciliation_drift: drift,
  };
}

export function getMiniAppReportParams(url: string) {
  const { searchParams } = new URL(url);
  const range = searchParams.get("range") || "";
  const fallbackDays = range === "last7" ? 6 : range === "last30" ? 29 : 9;
  return {
    startDate: normalizeDate(searchParams.get("start"), daysAgoDate(fallbackDays)),
    endDate: normalizeDate(searchParams.get("end"), todayDate()),
    dateSearch: (searchParams.get("date") || "").trim(),
    range,
  };
}

export async function buildMiniAppReport(miniappId: number | string, startDate: string, endDate: string, dateSearch = "") {
  const dateFilter = dateSearch ? `${dateSearch}%` : "%";
  const params = [miniappId, startDate, endDate, dateFilter];

  const [dailyRows]: any = await pool.query(
    `SELECT
       ? as miniapp_id,
       date,
       SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN impressions ELSE 0 END) as external_impressions,
       SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN gross_revenue ELSE 0 END) as external_gross_revenue,
       SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN ads_galaxy_fee ELSE 0 END) as external_fee,
       SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN publisher_revenue ELSE 0 END) as external_net_revenue,
       SUM(CASE WHEN network_name = 'AdsGalaxyInternal' THEN impressions ELSE 0 END) as internal_impressions,
       SUM(CASE WHEN network_name = 'AdsGalaxyInternal' THEN publisher_revenue ELSE 0 END) as internal_revenue,
       SUM(impressions) as total_impressions,
       SUM(publisher_revenue) as total_revenue,
       CASE WHEN SUM(impressions) > 0 THEN (SUM(publisher_revenue) / SUM(impressions)) * 1000 ELSE 0 END as blended_cpm
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?
     GROUP BY date
     ORDER BY date DESC`,
    [miniappId, ...params]
  );

  const [totalRows]: any = await pool.query(
    `SELECT
       ? as miniapp_id,
       COALESCE(SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN impressions ELSE 0 END), 0) as external_impressions,
       COALESCE(SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN gross_revenue ELSE 0 END), 0) as external_gross_revenue,
       COALESCE(SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN ads_galaxy_fee ELSE 0 END), 0) as external_fee,
       COALESCE(SUM(CASE WHEN network_name <> 'AdsGalaxyInternal' THEN publisher_revenue ELSE 0 END), 0) as external_net_revenue,
       COALESCE(SUM(CASE WHEN network_name = 'AdsGalaxyInternal' THEN impressions ELSE 0 END), 0) as internal_impressions,
       COALESCE(SUM(CASE WHEN network_name = 'AdsGalaxyInternal' THEN publisher_revenue ELSE 0 END), 0) as internal_revenue,
       COALESCE(SUM(impressions), 0) as total_impressions,
       COALESCE(SUM(publisher_revenue), 0) as total_revenue,
       CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN (SUM(publisher_revenue) / SUM(impressions)) * 1000 ELSE 0 END as blended_cpm
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?`,
    [miniappId, ...params]
  );

  const [todayRows]: any = await pool.query(
    `SELECT
       COALESCE(SUM(impressions), 0) as today_impressions,
       COALESCE(SUM(publisher_revenue), 0) as today_earnings
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date = CURDATE()`,
    [miniappId]
  );

  const [yesterdayRows]: any = await pool.query(
    `SELECT
       COALESCE(SUM(impressions), 0) as yesterday_impressions,
       COALESCE(SUM(publisher_revenue), 0) as yesterday_earnings
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`,
    [miniappId]
  );

  const [lifetimeRows]: any = await pool.query(
    `SELECT
       COALESCE(SUM(impressions), 0) as lifetime_impressions,
       COALESCE(SUM(publisher_revenue), 0) as lifetime_revenue
     FROM miniapp_daily_stats
     WHERE miniapp_id = ?`,
    [miniappId]
  );

  const [internalSourceRows]: any = await pool.query(
    `SELECT
       COALESCE(COUNT(*), 0) as source_internal_impressions,
       COALESCE(SUM(cost), 0) as source_internal_cost
     FROM miniapp_internal_ad_impressions
     WHERE miniapp_id = ? AND created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
    [miniappId, startDate, endDate]
  );
  const completionAnalytics = await getInternalAdCompletionAnalytics({
    conn: pool,
    miniappId,
    startDate,
    endDate,
  });

  const [countryRows]: any = await pool.query(
    `SELECT country, SUM(impressions) as impressions
     FROM miniapp_country_stats
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?
     GROUP BY country
     ORDER BY impressions DESC, country ASC`,
    params
  );

  const [settlementRows]: any = await pool.query(
    `SELECT
       COALESCE(SUM(publisher_revenue), 0) as total_settled_earnings,
       COALESCE(SUM(CASE WHEN status = 'locked' THEN publisher_revenue ELSE 0 END), 0) as locked_earnings,
       COALESCE(SUM(CASE WHEN status = 'unlocked' THEN publisher_revenue ELSE 0 END), 0) as unlocked_earnings
     FROM miniapp_earnings_settlements
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?`,
    params
  );

  const totalRevenue = toNumber(totalRows[0]?.total_revenue);
  const totalSettledEarnings = toNumber(settlementRows[0]?.total_settled_earnings);
  const reconciliation = reconcileRevenue(totalRows[0] || {});

  return {
    range: { startDate, endDate, dateSearch },
    summary: {
      today_impressions: toNumber(todayRows[0]?.today_impressions),
      yesterday_impressions: toNumber(yesterdayRows[0]?.yesterday_impressions),
      today_earnings: toNumber(todayRows[0]?.today_earnings),
      today_revenue: toNumber(todayRows[0]?.today_earnings),
      yesterday_revenue: toNumber(yesterdayRows[0]?.yesterday_earnings),
      total_earnings: totalRevenue,
      total_impressions: toNumber(totalRows[0]?.total_impressions),
      lifetime_impressions: toNumber(lifetimeRows[0]?.lifetime_impressions),
      lifetime_revenue: toNumber(lifetimeRows[0]?.lifetime_revenue),
      external_impressions: toNumber(totalRows[0]?.external_impressions),
      external_revenue: toNumber(totalRows[0]?.external_gross_revenue),
      external_gross_revenue: toNumber(totalRows[0]?.external_gross_revenue),
      ads_galaxy_fee: toNumber(totalRows[0]?.external_fee),
      external_net_revenue: toNumber(totalRows[0]?.external_net_revenue),
      internal_impressions: toNumber(totalRows[0]?.internal_impressions),
      internal_revenue: toNumber(totalRows[0]?.internal_revenue),
      net_revenue: totalRevenue,
      blended_cpm: toNumber(totalRows[0]?.blended_cpm),
      average_cpm: toNumber(totalRows[0]?.blended_cpm),
      net_cpm: toNumber(totalRows[0]?.blended_cpm),
      gross_revenue: toNumber(totalRows[0]?.external_gross_revenue) + toNumber(totalRows[0]?.internal_revenue),
      publisher_revenue: totalRevenue,
      total_settled_earnings: totalSettledEarnings,
      locked_earnings: toNumber(settlementRows[0]?.locked_earnings),
      unlocked_earnings: toNumber(settlementRows[0]?.unlocked_earnings),
      unsettled_earnings: Math.max(totalRevenue - totalSettledEarnings, 0),
      source_internal_impressions: toNumber(internalSourceRows[0]?.source_internal_impressions),
      source_internal_cost: toNumber(internalSourceRows[0]?.source_internal_cost),
      completion_rate: completionAnalytics.completion_rate,
      average_watch_duration: completionAnalytics.average_watch_duration,
      incomplete_rate: completionAnalytics.incomplete_rate,
      ...reconciliation,
    },
    daily: dailyRows.map((row: any) => {
      const dailyReconciliation = reconcileRevenue(row);
      return {
        date: row.date,
        impressions: toNumber(row.total_impressions),
        external_impressions: toNumber(row.external_impressions),
        external_revenue: toNumber(row.external_gross_revenue),
        external_gross_revenue: toNumber(row.external_gross_revenue),
        ads_galaxy_fee: toNumber(row.external_fee),
        external_net_revenue: toNumber(row.external_net_revenue),
        internal_impressions: toNumber(row.internal_impressions),
        internal_revenue: toNumber(row.internal_revenue),
        total_revenue: toNumber(row.total_revenue),
        gross_revenue: toNumber(row.external_gross_revenue) + toNumber(row.internal_revenue),
        publisher_revenue: toNumber(row.total_revenue),
        blended_cpm: toNumber(row.blended_cpm),
        net_cpm: toNumber(row.blended_cpm),
        ...dailyReconciliation,
      };
    }),
    countries: countryRows.map((row: any) => ({
      country: row.country,
      impressions: toNumber(row.impressions),
    })),
  };
}

export async function buildMiniAppAdminBreakdown(miniappId: number | string, startDate: string, endDate: string, dateSearch = "") {
  const params = [miniappId, startDate, endDate, dateSearch ? `${dateSearch}%` : "%"];

  const [networkRows]: any = await pool.query(
    `SELECT
       network_name,
       SUM(impressions) as impressions,
       SUM(gross_revenue) as gross_revenue,
       SUM(ads_galaxy_fee) as ads_galaxy_fee,
       SUM(reserve_revenue) as reserve_revenue,
       SUM(publisher_revenue) as publisher_revenue,
       CASE WHEN SUM(impressions) > 0 THEN (SUM(gross_revenue) / SUM(impressions)) * 1000 ELSE 0 END as gross_cpm,
       CASE WHEN SUM(impressions) > 0 THEN (SUM(publisher_revenue) / SUM(impressions)) * 1000 ELSE 0 END as net_cpm
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?
     GROUP BY network_name
     ORDER BY gross_revenue DESC, network_name ASC`,
    params
  );

  const [enabledRows]: any = await pool.query(
    `SELECT network_name, enabled, network_placement_id
     FROM miniapp_ad_networks
     WHERE miniapp_id = ?
     ORDER BY FIELD(network_name, 'AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub', 'AdsGalaxyInternal'), network_name`,
    [miniappId]
  );

  return {
    networks: networkRows.map((row: any) => ({
      network_name: row.network_name,
      impressions: toNumber(row.impressions),
      gross_revenue: toNumber(row.gross_revenue),
      ads_galaxy_fee: toNumber(row.ads_galaxy_fee),
      reserve_revenue: toNumber(row.reserve_revenue),
      publisher_revenue: toNumber(row.publisher_revenue),
      gross_cpm: toNumber(row.gross_cpm),
      net_cpm: toNumber(row.net_cpm),
    })),
    enabled_networks: enabledRows.map((row: any) => ({
      network_name: row.network_name,
      enabled: Boolean(row.enabled),
      network_placement_id: row.network_placement_id || "",
    })),
  };
}
