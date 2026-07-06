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

export const MIN_CPM_SAMPLE_SIZE = 100;
export const MIN_CPC_SAMPLE_SIZE = 10;

export function hasMinimumCpmSample(impressions: unknown) {
  return metricNumber(impressions) >= MIN_CPM_SAMPLE_SIZE;
}

export function hasMinimumCpcSample(clicks: unknown) {
  return metricNumber(clicks) >= MIN_CPC_SAMPLE_SIZE;
}
