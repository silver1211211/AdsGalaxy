function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(numerator: number, denominator: number, multiplier = 1) {
  return denominator > 0 ? Number((numerator / denominator * multiplier).toFixed(8)) : 0;
}

export function combineMiniAppCampaignMetricSources(source: Record<string, unknown>) {
  const platformImpressions = number(source.platform_impressions);
  const externalImpressions = number(source.external_impressions);
  const platformClicks = number(source.platform_clicks);
  const externalClicks = number(source.external_clicks);
  const platformSpend = number(source.platform_spend);
  const externalSpend = number(source.external_spend);
  const impressions = platformImpressions + externalImpressions;
  const clicks = platformClicks + externalClicks;
  const spend = platformSpend + externalSpend;
  const dates = [source.last_platform_delivery_at, source.last_external_delivery_at]
    .filter(Boolean)
    .map((value) => new Date(String(value)))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return {
    platform_impressions: platformImpressions,
    external_impressions: externalImpressions,
    impressions,
    platform_clicks: platformClicks,
    external_clicks: externalClicks,
    clicks,
    platform_spend: platformSpend,
    external_spend: externalSpend,
    spend,
    today_impressions: number(source.today_platform_impressions) + number(source.today_external_impressions),
    yesterday_impressions: number(source.yesterday_platform_impressions) + number(source.yesterday_external_impressions),
    today_clicks: number(source.today_platform_clicks) + number(source.today_external_clicks),
    today_spend: number(source.today_platform_spend) + number(source.today_external_spend),
    ctr: rate(clicks, impressions, 100),
    average_cpm: rate(spend, impressions, 1000),
    average_cpc: rate(spend, clicks),
    last_displayed_at: dates[0] || null,
  };
}
