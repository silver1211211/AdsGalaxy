export type RevenueSplit = {
  publisher_percent: number;
  reserve_percent: number;
  platform_percent: number;
};

function numeric(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bounded(value: unknown, fallback: number) {
  return Math.min(100, Math.max(0, numeric(value, fallback)));
}

function rounded(value: number) {
  return Number(value.toFixed(8));
}

export function assertDirectRevenueSplit(publisherValue: unknown, reserveValue: unknown, label: string) {
  const publisher = Number(publisherValue);
  const reserve = Number(reserveValue);
  if (![publisher, reserve].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
    throw new Error(`${label} publisher share and reserve must be numbers between 0 and 100`);
  }
  if (publisher + reserve > 100) {
    throw new Error(`${label} publisher share plus reserve cannot exceed 100%`);
  }
  return { publisher, reserve, platform: 100 - publisher - reserve };
}

export function channelRevenueSplitFromStored(platformMarginValue: unknown, poolReserveValue: unknown): RevenueSplit {
  const platform = bounded(platformMarginValue, 40);
  const poolReserve = bounded(poolReserveValue, 10);
  const remaining = 100 - platform;
  const reserve = remaining * poolReserve / 100;
  return {
    publisher_percent: rounded(remaining - reserve),
    reserve_percent: rounded(reserve),
    platform_percent: rounded(platform),
  };
}

export function channelStoredPolicyFromRevenueSplit(publisherValue: unknown, reserveValue: unknown) {
  const split = assertDirectRevenueSplit(publisherValue, reserveValue, "Channel");
  const publisherPool = split.publisher + split.reserve;
  return {
    split,
    platform_margin_percent: rounded(split.platform),
    safety_reserve_percent: rounded(publisherPool > 0 ? split.reserve / publisherPool * 100 : 0),
  };
}

export function miniAppRevenueSplitFromStored(maxShareValue: unknown, reserveShareValue: unknown): RevenueSplit {
  const storedMax = numeric(maxShareValue, 0.5);
  const storedReserve = numeric(reserveShareValue, 0.1);
  const publisher = bounded(storedMax > 1 ? storedMax : storedMax * 100, 50);
  const reserve = bounded(storedReserve > 1 ? storedReserve : storedReserve * 100, 10);
  const safePublisher = Math.min(publisher, 100 - reserve);
  return {
    publisher_percent: rounded(safePublisher),
    reserve_percent: rounded(reserve),
    platform_percent: rounded(100 - safePublisher - reserve),
  };
}
