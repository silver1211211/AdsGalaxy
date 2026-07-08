/* eslint-disable @typescript-eslint/no-explicit-any -- legacy Mini App aggregate payloads are not schema-generated */
import "server-only";
import pool from "@/lib/db";
import { getInternalAdCompletionAnalytics } from "@/lib/internalAdCompletionQuality";
import { cpc, cpm, ctr, fixedMetric, metricNumber } from "@/lib/statFormulas";

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

function reconcileRevenue(row: Record<string, unknown>) {
  const externalNetRevenue = metricNumber(row.external_net_revenue);
  const internalRevenue = metricNumber(row.internal_revenue);
  const totalRevenue = metricNumber(row.total_revenue);
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

function aggregateSelect(prefix = "") {
  const source = prefix ? `${prefix}.` : "";
  return `
    COALESCE(SUM(CASE WHEN ${source}network_name <> 'AdsGalaxyInternal' THEN ${source}impressions ELSE 0 END), 0) as external_impressions,
    COALESCE(SUM(CASE WHEN ${source}network_name <> 'AdsGalaxyInternal' THEN ${source}gross_revenue ELSE 0 END), 0) as external_gross_revenue,
    COALESCE(SUM(CASE WHEN ${source}network_name <> 'AdsGalaxyInternal' THEN ${source}ads_galaxy_fee ELSE 0 END), 0) as external_fee,
    COALESCE(SUM(CASE WHEN ${source}network_name <> 'AdsGalaxyInternal' THEN ${source}reserve_revenue ELSE 0 END), 0) as external_reserve_revenue,
    COALESCE(SUM(CASE WHEN ${source}network_name <> 'AdsGalaxyInternal' THEN ${source}publisher_revenue ELSE 0 END), 0) as external_net_revenue,
    COALESCE(SUM(CASE WHEN ${source}network_name = 'AdsGalaxyInternal' THEN ${source}impressions ELSE 0 END), 0) as internal_impressions,
    COALESCE(SUM(CASE WHEN ${source}network_name = 'AdsGalaxyInternal' THEN ${source}gross_revenue ELSE 0 END), 0) as internal_gross_revenue,
    COALESCE(SUM(CASE WHEN ${source}network_name = 'AdsGalaxyInternal' THEN ${source}ads_galaxy_fee ELSE 0 END), 0) as internal_fee,
    COALESCE(SUM(CASE WHEN ${source}network_name = 'AdsGalaxyInternal' THEN ${source}reserve_revenue ELSE 0 END), 0) as internal_reserve_revenue,
    COALESCE(SUM(CASE WHEN ${source}network_name = 'AdsGalaxyInternal' THEN ${source}publisher_revenue ELSE 0 END), 0) as internal_revenue,
    COALESCE(SUM(${source}impressions), 0) as total_impressions,
    COALESCE(SUM(${source}gross_revenue), 0) as gross_revenue,
    COALESCE(SUM(${source}ads_galaxy_fee), 0) as ads_galaxy_fee,
    COALESCE(SUM(${source}reserve_revenue), 0) as reserve_revenue,
    COALESCE(SUM(${source}publisher_revenue), 0) as total_revenue
  `;
}

function aggregateSummary(row: Record<string, unknown>, clicks = 0, requests = 0, successfulFills = 0, noFills = 0) {
  const totalImpressions = metricNumber(row.total_impressions);
  const publisherRevenue = metricNumber(row.total_revenue);
  const grossRevenue = metricNumber(row.gross_revenue);
  const totalClicks = metricNumber(clicks);
  return {
    external_impressions: metricNumber(row.external_impressions),
    external_revenue: metricNumber(row.external_gross_revenue),
    external_gross_revenue: metricNumber(row.external_gross_revenue),
    external_net_revenue: metricNumber(row.external_net_revenue),
    internal_impressions: metricNumber(row.internal_impressions),
    internal_gross_revenue: metricNumber(row.internal_gross_revenue),
    internal_revenue: metricNumber(row.internal_revenue),
    gross_revenue: grossRevenue,
    ads_galaxy_fee: metricNumber(row.ads_galaxy_fee),
    ads_galaxy_revenue: metricNumber(row.ads_galaxy_fee),
    reserve_revenue: metricNumber(row.reserve_revenue),
    publisher_revenue: publisherRevenue,
    total_revenue: publisherRevenue,
    net_revenue: publisherRevenue,
    total_earnings: publisherRevenue,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    clicks: totalClicks,
    requests,
    total_requests: requests,
    successful_fills: successfulFills,
    failed_fills: Math.max(requests - successfulFills, 0),
    no_fill_count: noFills,
    fill_rate: requests > 0 ? fixedMetric((successfulFills / requests) * 100) : null,
    ctr: ctr(totalClicks, totalImpressions),
    cpc: cpc(publisherRevenue, totalClicks),
    publisher_cpc: cpc(publisherRevenue, totalClicks),
    advertiser_cpc: cpc(grossRevenue, totalClicks),
    blended_cpm: cpm(publisherRevenue, totalImpressions),
    average_cpm: cpm(publisherRevenue, totalImpressions),
    gross_cpm: cpm(grossRevenue, totalImpressions),
    net_cpm: cpm(publisherRevenue, totalImpressions),
  };
}

export function averageSelectedDailyCpm(rows: Array<{ total_impressions?: unknown; total_revenue?: unknown; net_cpm?: unknown }>) {
  const selectedDailyCpms = rows
    .filter((row) => metricNumber(row.total_impressions) > 0 && metricNumber(row.total_revenue) > 0)
    .map((row) => metricNumber(row.net_cpm));
  if (selectedDailyCpms.length === 0) return 0;
  return fixedMetric(selectedDailyCpms.reduce((sum, value) => sum + value, 0) / selectedDailyCpms.length, 8);
}

export async function getMiniAppAggregateStatsByIds(miniappIds: Array<number | string>) {
  const ids = [...new Set(miniappIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return new Map<number, ReturnType<typeof aggregateSummary> & { last_activity_at: unknown }>();

  const placeholders = ids.map(() => "?").join(",");
  const [rows]: any = await pool.query(
    `SELECT ds.miniapp_id, ${aggregateSelect("ds")},
       NULLIF(GREATEST(
         COALESCE((SELECT MAX(mr.created_at) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = ds.miniapp_id), '1970-01-01 00:00:00'),
         COALESCE(MAX(ds.updated_at), '1970-01-01 00:00:00'),
         COALESCE((SELECT MAX(iai.created_at) FROM miniapp_internal_ad_impressions iai WHERE iai.miniapp_id = ds.miniapp_id), '1970-01-01 00:00:00')
       ), '1970-01-01 00:00:00') as last_activity_at
     FROM miniapp_daily_stats ds
     WHERE ds.miniapp_id IN (${placeholders})
     GROUP BY ds.miniapp_id`,
    ids
  );
  const [requestRows]: any = await pool.query(
    `SELECT miniapp_id,
       COUNT(CASE WHEN parent_request_id IS NULL THEN 1 END) as requests,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND (impression_confirmed = 1 OR final_result IN ('completed', 'impression_confirmed', 'displayed')) THEN 1 ELSE 0 END), 0) as successful_fills,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills,
       MAX(created_at) as last_mediation_request_at
     FROM miniapp_mediation_requests
     WHERE miniapp_id IN (${placeholders})
     GROUP BY miniapp_id`,
    ids
  );
  const [clickRows]: any = await pool.query(
    `SELECT miniapp_id, COUNT(*) as clicks
     FROM ad_click_attribution
     WHERE campaign_type = 'miniapp' AND miniapp_id IN (${placeholders})
     GROUP BY miniapp_id`,
    ids
  );

  const byId = new Map<number, any>();
  for (const id of ids) byId.set(id, {});
  for (const row of rows) byId.set(Number(row.miniapp_id), { ...byId.get(Number(row.miniapp_id)), ...row });
  for (const row of requestRows) byId.set(Number(row.miniapp_id), { ...byId.get(Number(row.miniapp_id)), ...row });
  for (const row of clickRows) byId.set(Number(row.miniapp_id), { ...byId.get(Number(row.miniapp_id)), clicks: row.clicks });

  const result = new Map<number, ReturnType<typeof aggregateSummary> & { last_activity_at: unknown }>();
  for (const [id, row] of byId.entries()) {
    const summary = aggregateSummary(row, metricNumber(row.clicks), metricNumber(row.requests), metricNumber(row.successful_fills), metricNumber(row.no_fills));
    result.set(id, {
      ...summary,
      last_activity_at: row.last_activity_at || row.last_mediation_request_at || null,
    });
  }
  return result;
}

export async function getMiniAppPlatformStats() {
  const [[today]]: any = await pool.query(`SELECT ${aggregateSelect()} FROM miniapp_daily_stats WHERE date = CURDATE()`);
  const [[yesterday]]: any = await pool.query(`SELECT ${aggregateSelect()} FROM miniapp_daily_stats WHERE date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`);
  const [[lifetime]]: any = await pool.query(`SELECT ${aggregateSelect()} FROM miniapp_daily_stats`);
  const [[todayRequests]]: any = await pool.query(
    `SELECT
       COUNT(CASE WHEN parent_request_id IS NULL THEN 1 END) as requests,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND (impression_confirmed = 1 OR final_result IN ('completed', 'impression_confirmed', 'displayed')) THEN 1 ELSE 0 END), 0) as successful_fills,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills
     FROM miniapp_mediation_requests
     WHERE created_at >= CURDATE()`
  );
  const [[yesterdayRequests]]: any = await pool.query(
    `SELECT
       COUNT(CASE WHEN parent_request_id IS NULL THEN 1 END) as requests,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND (impression_confirmed = 1 OR final_result IN ('completed', 'impression_confirmed', 'displayed')) THEN 1 ELSE 0 END), 0) as successful_fills,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills
     FROM miniapp_mediation_requests
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE()`
  );
  const [[lifetimeRequests]]: any = await pool.query(
    `SELECT
       COUNT(CASE WHEN parent_request_id IS NULL THEN 1 END) as requests,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND (impression_confirmed = 1 OR final_result IN ('completed', 'impression_confirmed', 'displayed')) THEN 1 ELSE 0 END), 0) as successful_fills,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills
     FROM miniapp_mediation_requests`
  );
  const [[todayClicks]]: any = await pool.query(
    "SELECT COUNT(*) as clicks FROM ad_click_attribution WHERE campaign_type = 'miniapp' AND created_at >= CURDATE()"
  );
  const [[yesterdayClicks]]: any = await pool.query(
    "SELECT COUNT(*) as clicks FROM ad_click_attribution WHERE campaign_type = 'miniapp' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE()"
  );
  const [[lifetimeClicks]]: any = await pool.query(
    "SELECT COUNT(*) as clicks FROM ad_click_attribution WHERE campaign_type = 'miniapp'"
  );
  return {
    today: aggregateSummary(today || {}, metricNumber(todayClicks?.clicks), metricNumber(todayRequests?.requests), metricNumber(todayRequests?.successful_fills), metricNumber(todayRequests?.no_fills)),
    yesterday: aggregateSummary(yesterday || {}, metricNumber(yesterdayClicks?.clicks), metricNumber(yesterdayRequests?.requests), metricNumber(yesterdayRequests?.successful_fills), metricNumber(yesterdayRequests?.no_fills)),
    lifetime: aggregateSummary(lifetime || {}, metricNumber(lifetimeClicks?.clicks), metricNumber(lifetimeRequests?.requests), metricNumber(lifetimeRequests?.successful_fills), metricNumber(lifetimeRequests?.no_fills)),
  };
}

export async function buildMiniAppReport(miniappId: number | string, startDate: string, endDate: string, dateSearch = "") {
  const dateFilter = dateSearch ? `${dateSearch}%` : "%";
  const params = [miniappId, startDate, endDate, dateFilter];

  const [dailyRows]: any = await pool.query(
    `SELECT
       ? as miniapp_id,
       DATE_FORMAT(date, '%Y-%m-%d') as date,
       ${aggregateSelect()}
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?
     GROUP BY date
     ORDER BY date DESC`,
    [miniappId, ...params]
  );

  const [fillRows]: any = await pool.query(
    `SELECT
       DATE_FORMAT(created_at, '%Y-%m-%d') as date,
       COUNT(CASE WHEN parent_request_id IS NULL THEN 1 END) as requests,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND (impression_confirmed = 1 OR final_result IN ('completed', 'impression_confirmed', 'displayed')) THEN 1 ELSE 0 END), 0) as successful_fills,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills
     FROM miniapp_mediation_requests
     WHERE miniapp_id = ? AND DATE(created_at) BETWEEN ? AND ? AND CAST(DATE(created_at) AS CHAR) LIKE ?
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')`,
    params
  );

  const [clickRows]: any = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as clicks
     FROM ad_click_attribution
     WHERE campaign_type = 'miniapp'
       AND miniapp_id = ?
       AND DATE(created_at) BETWEEN ? AND ?
       AND CAST(DATE(created_at) AS CHAR) LIKE ?
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')`,
    params
  );

  const [completionRows]: any = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date,
       COUNT(*) as triggered_ads,
       COALESCE(SUM(CASE WHEN completion_status = 'completed' THEN 1 ELSE 0 END), 0) as completed_ads,
       COALESCE(AVG(watch_duration_seconds), 0) as average_watch_duration,
       COALESCE(SUM(CASE WHEN completion_status <> 'completed' THEN 1 ELSE 0 END), 0) as incomplete_ads
     FROM miniapp_internal_ad_impressions
     WHERE miniapp_id = ? AND DATE(created_at) BETWEEN ? AND ? AND CAST(DATE(created_at) AS CHAR) LIKE ?
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')`,
    params
  );

  const [totalRows]: any = await pool.query(
    `SELECT ? as miniapp_id, ${aggregateSelect()}
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date BETWEEN ? AND ? AND CAST(date AS CHAR) LIKE ?`,
    [miniappId, ...params]
  );

  const [[totalClickRow]]: any = await pool.query(
    `SELECT COUNT(*) as total_clicks
     FROM ad_click_attribution
     WHERE campaign_type = 'miniapp'
       AND miniapp_id = ?
       AND DATE(created_at) BETWEEN ? AND ?
       AND CAST(DATE(created_at) AS CHAR) LIKE ?`,
    params
  );

  const [[requestTotals]]: any = await pool.query(
    `SELECT
       COUNT(CASE WHEN parent_request_id IS NULL THEN 1 END) as requests,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND (impression_confirmed = 1 OR final_result IN ('completed', 'impression_confirmed', 'displayed')) THEN 1 ELSE 0 END), 0) as successful_fills,
       COALESCE(SUM(CASE WHEN parent_request_id IS NULL AND final_result = 'no_fill' THEN 1 ELSE 0 END), 0) as no_fills
     FROM miniapp_mediation_requests
     WHERE miniapp_id = ? AND DATE(created_at) BETWEEN ? AND ? AND CAST(DATE(created_at) AS CHAR) LIKE ?`,
    params
  );

  const [todayRows]: any = await pool.query(
    `SELECT COALESCE(SUM(impressions), 0) as today_impressions, COALESCE(SUM(publisher_revenue), 0) as today_earnings
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date = CURDATE()`,
    [miniappId]
  );

  const [yesterdayRows]: any = await pool.query(
    `SELECT COALESCE(SUM(impressions), 0) as yesterday_impressions, COALESCE(SUM(publisher_revenue), 0) as yesterday_earnings
     FROM miniapp_daily_stats
     WHERE miniapp_id = ? AND date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`,
    [miniappId]
  );

  const [lifetimeRows]: any = await pool.query(
    `SELECT COALESCE(SUM(impressions), 0) as lifetime_impressions, COALESCE(SUM(publisher_revenue), 0) as lifetime_revenue
     FROM miniapp_daily_stats
     WHERE miniapp_id = ?`,
    [miniappId]
  );

  const [internalSourceRows]: any = await pool.query(
    `SELECT COALESCE(COUNT(*), 0) as source_internal_impressions, COALESCE(SUM(cost), 0) as source_internal_cost
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

  const totalRevenue = metricNumber(totalRows[0]?.total_revenue);
  const totalSettledEarnings = metricNumber(settlementRows[0]?.total_settled_earnings);
  const totalSummary = aggregateSummary(
    totalRows[0] || {},
    metricNumber(totalClickRow?.total_clicks),
    metricNumber(requestTotals?.requests),
    metricNumber(requestTotals?.successful_fills),
    metricNumber(requestTotals?.no_fills)
  );

  const dailyByDate = new Map<string, any>();
  for (const row of dailyRows) dailyByDate.set(String(row.date), row);
  const fillByDate = new Map<string, any>();
  for (const row of fillRows) fillByDate.set(String(row.date), row);
  const clicksByDate = new Map<string, number>();
  for (const row of clickRows) clicksByDate.set(String(row.date), metricNumber(row.clicks));
  const completionByDate = new Map<string, any>();
  for (const row of completionRows) completionByDate.set(String(row.date), row);
  const allDates = new Set<string>([...dailyByDate.keys(), ...fillByDate.keys(), ...clicksByDate.keys(), ...completionByDate.keys()]);
  const daily = Array.from(allDates)
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const row = dailyByDate.get(date) || {};
      const fills = fillByDate.get(date) || {};
      const completion = completionByDate.get(date) || {};
      const dailySummary = aggregateSummary(row, clicksByDate.get(date) || 0, metricNumber(fills.requests), metricNumber(fills.successful_fills), metricNumber(fills.no_fills));
      const triggeredAds = metricNumber(completion.triggered_ads);
      const completedAds = metricNumber(completion.completed_ads);
      return {
        date,
        impressions: dailySummary.total_impressions,
        ...dailySummary,
        total_settled_earnings: 0,
        completion_rate: triggeredAds > 0 ? completedAds / triggeredAds : null,
        average_watch_duration: triggeredAds > 0 ? metricNumber(completion.average_watch_duration) : null,
        incomplete_rate: triggeredAds > 0 ? metricNumber(completion.incomplete_ads) / triggeredAds : null,
        ...reconcileRevenue({ ...row, miniapp_id: miniappId, date }),
      };
    });
  const selectedAverageCpm = averageSelectedDailyCpm(daily);

  return {
    range: { startDate, endDate, dateSearch },
    summary: {
      today_impressions: metricNumber(todayRows[0]?.today_impressions),
      yesterday_impressions: metricNumber(yesterdayRows[0]?.yesterday_impressions),
      today_earnings: metricNumber(todayRows[0]?.today_earnings),
      today_revenue: metricNumber(todayRows[0]?.today_earnings),
      yesterday_revenue: metricNumber(yesterdayRows[0]?.yesterday_earnings),
      ...totalSummary,
      average_cpm: selectedAverageCpm,
      lifetime_impressions: metricNumber(lifetimeRows[0]?.lifetime_impressions),
      lifetime_revenue: metricNumber(lifetimeRows[0]?.lifetime_revenue),
      total_settled_earnings: totalSettledEarnings,
      locked_earnings: metricNumber(settlementRows[0]?.locked_earnings),
      unlocked_earnings: metricNumber(settlementRows[0]?.unlocked_earnings),
      unsettled_earnings: Math.max(totalRevenue - totalSettledEarnings, 0),
      source_internal_impressions: metricNumber(internalSourceRows[0]?.source_internal_impressions),
      source_internal_cost: metricNumber(internalSourceRows[0]?.source_internal_cost),
      completion_rate: completionAnalytics.completion_rate,
      average_watch_duration: completionAnalytics.average_watch_duration,
      incomplete_rate: completionAnalytics.incomplete_rate,
      ...reconcileRevenue(totalRows[0] || {}),
    },
    trends: {
      labels: [...daily].reverse().map((row) => row.date),
      impressions: [...daily].reverse().map((row) => row.impressions),
      clicks: [...daily].reverse().map((row) => row.clicks),
      revenue: [...daily].reverse().map((row) => row.publisher_revenue),
      gross_revenue: [...daily].reverse().map((row) => row.gross_revenue),
      fill_rate: [...daily].reverse().map((row) => row.fill_rate),
      ctr: [...daily].reverse().map((row) => row.ctr),
      cpm: [...daily].reverse().map((row) => row.net_cpm),
    },
    daily,
    countries: countryRows.map((row: any) => ({
      country: row.country,
      impressions: metricNumber(row.impressions),
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
    `SELECT network_name, enabled, CASE WHEN network_name='RichAds' THEN NULL ELSE network_placement_id END network_placement_id
     FROM miniapp_ad_networks
     WHERE miniapp_id = ?
     ORDER BY FIELD(network_name, 'AdsGalaxyInternal', 'AdsGram', 'GigaPub', 'AdExium', 'Monetag', 'RichAds'), network_name`,
    [miniappId]
  );

  return {
    networks: networkRows.map((row: any) => ({
      network_name: row.network_name,
      impressions: metricNumber(row.impressions),
      gross_revenue: metricNumber(row.gross_revenue),
      ads_galaxy_fee: metricNumber(row.ads_galaxy_fee),
      reserve_revenue: metricNumber(row.reserve_revenue),
      publisher_revenue: metricNumber(row.publisher_revenue),
      gross_cpm: metricNumber(row.gross_cpm),
      net_cpm: metricNumber(row.net_cpm),
    })),
    enabled_networks: enabledRows.map((row: any) => ({
      network_name: row.network_name,
      enabled: Boolean(row.enabled),
      network_placement_id: row.network_placement_id || "",
    })),
  };
}
