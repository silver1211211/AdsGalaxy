export function metricNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fixedMetric(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export function safeRate(numerator: unknown, denominator: unknown, multiplier = 1, digits = 6) {
  const top = metricNumber(numerator);
  const bottom = metricNumber(denominator);
  return bottom > 0 ? fixedMetric((top / bottom) * multiplier, digits) : 0;
}

export function ctr(clicks: unknown, impressions: unknown) {
  return safeRate(clicks, impressions, 100);
}

export function cpm(revenue: unknown, impressions: unknown, digits = 8) {
  return safeRate(revenue, impressions, 1000, digits);
}

export function cpc(spend: unknown, clicks: unknown, digits = 8) {
  return safeRate(spend, clicks, 1, digits);
}

// Publisher rates become meaningful as soon as the underlying billable event
// exists. View campaigns need one impression; click campaigns need one click.
export const MIN_CPM_SAMPLE_SIZE = 1;
export const MIN_CPC_SAMPLE_SIZE = 1;

export function hasMinimumCpmSample(impressions: unknown) {
  return metricNumber(impressions) >= MIN_CPM_SAMPLE_SIZE;
}

export function hasMinimumCpcSample(clicks: unknown) {
  return metricNumber(clicks) >= MIN_CPC_SAMPLE_SIZE;
}

/**
 * AdsGalaxy V1.01 Dynamic Effective CPM helper.
 * Derives effective CPM dynamically from legitimate cumulative publisher earnings and valid views.
 * Reusable across publisher statistics, channel reports, and analytics endpoints.
 */
export function calculateEffectivePublisherCpm(cumulativeEarnings: unknown, validViews: unknown, digits = 8) {
  const earnings = metricNumber(cumulativeEarnings);
  const views = metricNumber(validViews);
  return views > 0 ? fixedMetric((earnings / views) * 1000, digits) : 0;
}

/**
 * Formats a monetary balance to 6 decimal places for publisher UI display,
 * ensuring small balances (such as 0.001200 USDT from 1 view) are clearly visible.
 */
export function formatPublisherEarningsDisplay(amount: unknown, digits = 6): string {
  const val = metricNumber(amount);
  return val.toFixed(digits);
}
