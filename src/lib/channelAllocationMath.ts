export const CHANNEL_POLICY_VERSION = "channel-v1-margin40-pool-reserve10-quality-v1-round8";
export const CHANNEL_ALLOCATION_SCALE = 8;
const SCALE = BigInt(100_000_000);
export type DecimalInput = string | number | bigint;

export function decimalToUnits(value: DecimalInput): bigint {
  const raw = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error("invalid_decimal");
  const negative = raw.startsWith("-");
  const [wholeRaw, fractionRaw = ""] = (negative ? raw.slice(1) : raw).split(".");
  const padded = `${fractionRaw}00000000`;
  const base = BigInt(wholeRaw) * SCALE + BigInt(padded.slice(0, 8));
  const rounded = fractionRaw.length > 8 && fractionRaw[8] >= "5" ? base + BigInt(1) : base;
  return negative ? -rounded : rounded;
}

export function unitsToDecimal(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(8, "0")}`;
}

export function percentOf(amount: bigint, percent: DecimalInput): bigint {
  const percentUnits = decimalToUnits(percent);
  const denominator = BigInt(100) * SCALE;
  return (amount * percentUnits + denominator / BigInt(2)) / denominator;
}

export function calculateCurrentCanonicalAllocation(input: {
  advertiserDebit: DecimalInput; platformMarginPercent: DecimalInput;
  safetyReservePercent: DecimalInput; qualityWeight: DecimalInput;
}) {
  const debit = decimalToUnits(input.advertiserDebit);
  const platform = percentOf(debit, input.platformMarginPercent);
  const publisherPool = debit - platform;
  const reserve = percentOf(publisherPool, input.safetyReservePercent);
  const publisherBeforeQuality = publisherPool - reserve;
  const publisher = (publisherBeforeQuality * decimalToUnits(input.qualityWeight) + SCALE / BigInt(2)) / SCALE;
  const qualityAdjustment = publisherBeforeQuality - publisher;
  if (publisher < BigInt(0) || qualityAdjustment < BigInt(0) || publisher + platform + reserve + qualityAdjustment !== debit) {
    throw new Error("invalid_canonical_allocation");
  }
  return { debit, publisher, platform, reserve, qualityAdjustment };
}
