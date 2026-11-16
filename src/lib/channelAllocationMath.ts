export const CHANNEL_POLICY_VERSION = "channel-v1-margin40-pool-reserve10-quality-v1-round8";
export const CHANNEL_DEBIT_SNAPSHOT_POLICY_VERSION = "channel-v1-snapshot-margin-pool-reserve-quality-round8";
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

// ---------------------------------------------------------------------------
// AdsGalaxy V1.01 financial foundation (Phase 2).
//
// Everything below is PURE (no database, network, or process side effects) and
// is NOT called by any live settlement path yet. The legacy functions above
// (calculateCurrentCanonicalAllocation, CHANNEL_POLICY_VERSION) are unchanged
// and remain the policy used by Fast Billing and Incremental Settlement until
// the owner explicitly opts in with CHANNEL_V101_ALLOCATION_ENABLED=true AND a
// later phase wires these helpers into the settlement paths.
// ---------------------------------------------------------------------------

/** Distinct policy identifier so V1.01 rows never masquerade as legacy rows. */
export const CHANNEL_V101_POLICY_VERSION = "adsgalaxy-v1.01-direct-gross-split-quality-pm5-round8";
/** Opt-in switch. Disabled unless the environment value is exactly "true". */
export const CHANNEL_V101_ALLOCATION_ENV_FLAG = "CHANNEL_V101_ALLOCATION_ENABLED";
export const CHANNEL_V101_MIN_QUALITY_MULTIPLIER = "0.95000000";
export const CHANNEL_V101_NEUTRAL_QUALITY_MULTIPLIER = "1.00000000";
export const CHANNEL_V101_MAX_QUALITY_MULTIPLIER = "1.05000000";
/** Legacy stored-policy fallbacks, identical to the live readers (40 margin / 10 pool reserve). */
export const CHANNEL_LEGACY_DEFAULT_MARGIN_PERCENT = "40";
export const CHANNEL_LEGACY_DEFAULT_POOL_RESERVE_PERCENT = "10";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED_PERCENT_UNITS = BigInt(100) * SCALE;

export type ChannelBillingKind = "view" | "click";

export function isChannelV101AllocationEnabled(env: Record<string, string | undefined> = process.env) {
  return env[CHANNEL_V101_ALLOCATION_ENV_FLAG] === "true";
}

/** Strict fixed-point parse: rejects null, blanks, NaN/Infinity, exponents and junk. */
function strictUnits(value: unknown, label: string): bigint {
  if (value === null || value === undefined) throw new Error(`${label}_missing`);
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label}_not_finite`);
    raw = value.toFixed(8);
  } else if (typeof value === "bigint") {
    raw = value.toString();
  } else if (typeof value === "string") {
    raw = value.trim();
    if (raw === "") throw new Error(`${label}_missing`);
  } else {
    throw new Error(`${label}_invalid`);
  }
  try {
    return decimalToUnits(raw);
  } catch {
    throw new Error(`${label}_invalid`);
  }
}

function strictMoneyUnits(value: unknown, label: string): bigint {
  const units = strictUnits(value, label);
  if (units < ZERO) throw new Error(`${label}_negative`);
  return units;
}

export type DirectSplitPercentInput = {
  publisherPercent: DecimalInput;
  platformPercent: DecimalInput;
  reservePercent: DecimalInput;
};

/** Validates publisher/platform/reserve percentages against ONE gross amount; must total exactly 100. */
export function validateDirectSplitPercents(input: DirectSplitPercentInput) {
  const publisher = strictUnits(input?.publisherPercent, "publisher_percent");
  const platform = strictUnits(input?.platformPercent, "platform_percent");
  const reserve = strictUnits(input?.reservePercent, "reserve_percent");
  for (const value of [publisher, platform, reserve]) {
    if (value < ZERO || value > HUNDRED_PERCENT_UNITS) throw new Error("split_percent_out_of_range");
  }
  if (publisher + platform + reserve !== HUNDRED_PERCENT_UNITS) throw new Error("split_percent_total_not_100");
  return { publisher, platform, reserve };
}

export type DirectGrossSplit = { debit: bigint; publisherBase: bigint; platform: bigint; reserveBase: bigint };

/**
 * Canonical direct three-way split of the SAME gross advertiser debit.
 * Largest-remainder rounding: each share is floored exactly, then the 0..2
 * leftover units go to the largest fractional remainders (ties: publisher,
 * platform, reserve). The three shares therefore always sum to the debit.
 */
export function calculateDirectGrossSplit(input: { grossDebit: DecimalInput } & DirectSplitPercentInput): DirectGrossSplit {
  const debit = strictMoneyUnits(input?.grossDebit, "gross_debit");
  const pct = validateDirectSplitPercents(input);
  const shares = [pct.publisher, pct.platform, pct.reserve].map((percentUnits) => {
    const numerator = debit * percentUnits;
    return { floor: numerator / HUNDRED_PERCENT_UNITS, remainder: numerator % HUNDRED_PERCENT_UNITS };
  });
  let leftover = debit - shares.reduce((sum, share) => sum + share.floor, ZERO);
  const order = [0, 1, 2].sort((a, b) => {
    if (shares[a].remainder === shares[b].remainder) return a - b;
    return shares[a].remainder > shares[b].remainder ? -1 : 1;
  });
  for (const index of order) {
    if (leftover <= ZERO) break;
    shares[index].floor += ONE;
    leftover -= ONE;
  }
  const result = { debit, publisherBase: shares[0].floor, platform: shares[1].floor, reserveBase: shares[2].floor };
  if (leftover !== ZERO || result.publisherBase < ZERO || result.platform < ZERO || result.reserveBase < ZERO
    || result.publisherBase + result.platform + result.reserveBase !== debit) {
    throw new Error("invalid_direct_gross_split");
  }
  return result;
}

/**
 * Exact (BigInt) interpretation of the legacy stored policy as direct gross
 * percentages. platform = margin; reserve = (100-margin) * poolReserve / 100
 * rounded to 8 decimals; publisher = remainder, so the trio totals exactly 100.
 * Missing values use the legacy defaults (40 / 10). Present-but-invalid values throw.
 */
export function resolveDirectSplitFromStoredPolicy(platformMarginValue: unknown, poolReserveValue: unknown) {
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const margin = strictUnits(blank(platformMarginValue) ? CHANNEL_LEGACY_DEFAULT_MARGIN_PERCENT : platformMarginValue, "platform_margin_percent");
  const poolReserve = strictUnits(blank(poolReserveValue) ? CHANNEL_LEGACY_DEFAULT_POOL_RESERVE_PERCENT : poolReserveValue, "safety_reserve_percent");
  if (margin < ZERO || margin > HUNDRED_PERCENT_UNITS || poolReserve < ZERO || poolReserve > HUNDRED_PERCENT_UNITS) {
    throw new Error("stored_revenue_policy_out_of_range");
  }
  const remaining = HUNDRED_PERCENT_UNITS - margin;
  const reserve = (remaining * poolReserve + HUNDRED_PERCENT_UNITS / TWO) / HUNDRED_PERCENT_UNITS;
  const publisher = remaining - reserve;
  return {
    publisherPercent: unitsToDecimal(publisher),
    platformPercent: unitsToDecimal(margin),
    reservePercent: unitsToDecimal(reserve),
  };
}

/**
 * Policy selector. With the opt-in flag absent/false it reports the LEGACY
 * policy so nothing changes. It never reads the database or writes settings.
 */
export function resolveChannelAllocationPolicy(input: {
  platformMarginValue?: unknown;
  poolReserveValue?: unknown;
  env?: Record<string, string | undefined>;
}) {
  const split = resolveDirectSplitFromStoredPolicy(input.platformMarginValue, input.poolReserveValue);
  if (isChannelV101AllocationEnabled(input.env ?? process.env)) {
    return { policy: "v101" as const, policyVersion: CHANNEL_V101_POLICY_VERSION, split };
  }
  return { policy: "legacy" as const, policyVersion: CHANNEL_POLICY_VERSION, split };
}

/** Clamps a single combined quality multiplier into [0.95, 1.05]; rejects non-finite input. */
export function constrainQualityMultiplier(value: DecimalInput): bigint {
  const units = strictUnits(value, "quality_multiplier");
  const min = decimalToUnits(CHANNEL_V101_MIN_QUALITY_MULTIPLIER);
  const max = decimalToUnits(CHANNEL_V101_MAX_QUALITY_MULTIPLIER);
  return units < min ? min : units > max ? max : units;
}

/**
 * Combines several quality factors into ONE bounded multiplier. Deviations from
 * 1.00 are summed (not multiplied) and the total is limited to +/-5%, so
 * factors can never stack beyond the combined limit.
 */
export function combineQualityMultipliers(factors: DecimalInput[]): bigint {
  const neutral = decimalToUnits(CHANNEL_V101_NEUTRAL_QUALITY_MULTIPLIER);
  let deviation = ZERO;
  for (const factor of factors) {
    const units = strictUnits(factor, "quality_factor");
    if (units <= ZERO) throw new Error("quality_factor_invalid");
    deviation += units - neutral;
  }
  return constrainQualityMultiplier(unitsToDecimal(neutral + deviation));
}

export type QualityAdjustedAllocation = {
  debit: bigint;
  publisherBase: bigint;
  publisherFinal: bigint;
  platform: bigint;
  reserveBase: bigint;
  reserveFinal: bigint;
  /** publisherFinal - publisherBase. Negative = holdback, positive = funded bonus. */
  qualityAdjustmentSigned: bigint;
  bonusRequested: bigint;
  bonusGranted: bigint;
  bonusDenied: bigint;
};

/**
 * Applies ONE combined multiplier (strictly within [0.95, 1.05]) to the base
 * publisher allocation. Out-of-range multipliers are REJECTED.
 *  - Negative adjustment: the holdback moves to the reserve allocation.
 *  - Positive adjustment: granted only up to `authorizedBonusFunding` (default 0)
 *    and never beyond this event's own base reserve; platform revenue and other
 *    publishers are never touched. With no authorization the bonus is denied
 *    and the publisher receives the base allocation.
 * publisherFinal + platform + reserveFinal === debit always holds.
 */
export function calculateQualityAdjustedAllocation(
  base: DirectGrossSplit,
  options: { qualityMultiplier: DecimalInput; authorizedBonusFunding?: DecimalInput },
): QualityAdjustedAllocation {
  const multiplier = strictUnits(options?.qualityMultiplier, "quality_multiplier");
  if (multiplier < decimalToUnits(CHANNEL_V101_MIN_QUALITY_MULTIPLIER) || multiplier > decimalToUnits(CHANNEL_V101_MAX_QUALITY_MULTIPLIER)) {
    throw new Error("quality_multiplier_out_of_bounds");
  }
  if (base.publisherBase < ZERO || base.platform < ZERO || base.reserveBase < ZERO
    || base.publisherBase + base.platform + base.reserveBase !== base.debit) {
    throw new Error("invalid_base_allocation");
  }
  const authorized = options.authorizedBonusFunding === undefined
    ? ZERO : strictMoneyUnits(options.authorizedBonusFunding, "authorized_bonus_funding");
  const desired = (base.publisherBase * multiplier + SCALE / TWO) / SCALE;
  const delta = desired - base.publisherBase;
  let adjustment = delta;
  let bonusRequested = ZERO;
  let bonusGranted = ZERO;
  if (delta > ZERO) {
    bonusRequested = delta;
    bonusGranted = delta < authorized ? delta : authorized;
    if (bonusGranted > base.reserveBase) bonusGranted = base.reserveBase;
    adjustment = bonusGranted;
  }
  const result: QualityAdjustedAllocation = {
    debit: base.debit,
    publisherBase: base.publisherBase,
    publisherFinal: base.publisherBase + adjustment,
    platform: base.platform,
    reserveBase: base.reserveBase,
    reserveFinal: base.reserveBase - adjustment,
    qualityAdjustmentSigned: adjustment,
    bonusRequested,
    bonusGranted,
    bonusDenied: bonusRequested - bonusGranted,
  };
  if (result.publisherFinal < ZERO || result.reserveFinal < ZERO
    || result.publisherFinal + result.platform + result.reserveFinal !== result.debit) {
    throw new Error("invalid_quality_adjusted_allocation");
  }
  return result;
}

/**
 * Advertiser debit for CPC (click) or CPM/Views (view) at the campaign's ACTUAL
 * rate per 1,000 units, in exact fixed point (half-up at the 8th decimal).
 * No reserve advance is ever part of this calculation.
 */
export function calculateChannelEngagementDebit(input: {
  billingKind: ChannelBillingKind;
  units: number | bigint;
  ratePerThousand: DecimalInput;
}) {
  if (input?.billingKind !== "view" && input?.billingKind !== "click") throw new Error("invalid_billing_kind");
  let units: bigint;
  if (typeof input.units === "bigint") units = input.units;
  else if (Number.isSafeInteger(input.units)) units = BigInt(input.units);
  else throw new Error("invalid_units");
  if (units < ZERO) throw new Error("invalid_units");
  const rate = strictMoneyUnits(input.ratePerThousand, "rate_per_thousand");
  if (rate <= ZERO) throw new Error("invalid_rate_per_thousand");
  const thousand = BigInt(1000);
  return {
    billingKind: input.billingKind,
    units,
    debit: (units * rate + thousand / TWO) / thousand,
    unitPrice: unitsToDecimal((rate + thousand / TWO) / thousand),
    reserveAdvanceApplied: false as const,
  };
}

/**
 * One-call V1.01 allocation for an engagement batch, returned as 8-decimal
 * strings shaped for the canonical ledger. Pure: it writes nothing.
 * Ledger compatibility: the legacy `quality_adjustment` bucket is ALWAYS zero
 * for V1.01 (adjustments live inside publisher/reserve), so the existing
 * invariant debit = publisher + platform + reserve + quality_adjustment and
 * the existing CHECK constraints keep holding. The signed adjustment travels
 * in `qualityAdjustmentSigned` for the additive V1.01 columns.
 */
export function calculateV101ChannelAllocation(input: {
  billingKind: ChannelBillingKind;
  units: number | bigint;
  ratePerThousand: DecimalInput;
  split: DirectSplitPercentInput;
  qualityMultiplier?: DecimalInput;
  authorizedBonusFunding?: DecimalInput;
}) {
  const engagement = calculateChannelEngagementDebit(input);
  const percents = validateDirectSplitPercents(input.split);
  const split = calculateDirectGrossSplit({
    grossDebit: unitsToDecimal(engagement.debit),
    publisherPercent: unitsToDecimal(percents.publisher),
    platformPercent: unitsToDecimal(percents.platform),
    reservePercent: unitsToDecimal(percents.reserve),
  });
  const adjusted = calculateQualityAdjustedAllocation(split, {
    qualityMultiplier: input.qualityMultiplier ?? CHANNEL_V101_NEUTRAL_QUALITY_MULTIPLIER,
    authorizedBonusFunding: input.authorizedBonusFunding,
  });
  return {
    policyVersion: CHANNEL_V101_POLICY_VERSION,
    billingKind: engagement.billingKind,
    units: engagement.units.toString(),
    unitPrice: engagement.unitPrice,
    advertiserDebit: unitsToDecimal(adjusted.debit),
    publisherBaseAllocation: unitsToDecimal(adjusted.publisherBase),
    publisherAllocation: unitsToDecimal(adjusted.publisherFinal),
    platformAllocation: unitsToDecimal(adjusted.platform),
    reserveBaseAllocation: unitsToDecimal(adjusted.reserveBase),
    reserveAllocation: unitsToDecimal(adjusted.reserveFinal),
    qualityAdjustment: unitsToDecimal(ZERO),
    qualityAdjustmentSigned: unitsToDecimal(adjusted.qualityAdjustmentSigned),
    bonusRequested: unitsToDecimal(adjusted.bonusRequested),
    bonusGranted: unitsToDecimal(adjusted.bonusGranted),
    bonusDenied: unitsToDecimal(adjusted.bonusDenied),
    reserveAdvanceApplied: engagement.reserveAdvanceApplied,
    splitPercents: {
      publisherPercent: unitsToDecimal(percents.publisher),
      platformPercent: unitsToDecimal(percents.platform),
      reservePercent: unitsToDecimal(percents.reserve),
    },
  };
}

// ---------------------------------------------------------------------------
// AdsGalaxy V1.01 Dynamic Publisher CPM, Zero-Click CPC Curve & Quality Adjustments (Phase 3).
//
// Pure calculations: no database, network, or process side effects.
// Inert and uncalled by live settlement jobs until authorized and wired.
// ---------------------------------------------------------------------------

export const CHANNEL_V101_CPC_ZERO_CLICK_MAX_ENTITLEMENT = "0.10000000";
export const CHANNEL_V101_CPC_ZERO_CLICK_MAX_VIEWS = BigInt(1000);

// Approved initial piecewise-linear milestones: [views, cumulative_entitlement_units (in 1e8 scale)]
const ZERO_CLICK_MILESTONES: Array<[bigint, bigint]> = [
  [BigInt(0), BigInt(0)],             // 0 views: 0.00000000 USDT
  [BigInt(1), BigInt(120_000)],       // 1 view: 0.00120000 USDT
  [BigInt(10), BigInt(900_000)],      // 10 views: 0.00900000 USDT
  [BigInt(20), BigInt(1_500_000)],    // 20 views: 0.01500000 USDT
  [BigInt(50), BigInt(2_500_000)],    // 50 views: 0.02500000 USDT
  [BigInt(100), BigInt(4_000_000)],   // 100 views: 0.04000000 USDT
  [BigInt(200), BigInt(5_500_000)],   // 200 views: 0.05500000 USDT
  [BigInt(500), BigInt(8_000_000)],   // 500 views: 0.08000000 USDT
  [BigInt(750), BigInt(9_200_000)],   // 750 views: 0.09200000 USDT
  [BigInt(1000), BigInt(10_000_000)], // 1,000 views: 0.10000000 USDT
];

/**
 * Calculates the cumulative maximum reserve-supported entitlement for eligible
 * views on a CPC campaign before valid clicks arrive.
 * Piecewise-linear monotonic interpolation between approved milestones.
 * Guaranteed capped at 0.10000000 USDT at >= 1,000 views.
 */
export function calculateCpcZeroClickEntitlementUnits(eligibleViews: number | bigint): bigint {
  let views: bigint;
  if (typeof eligibleViews === "bigint") views = eligibleViews;
  else if (Number.isSafeInteger(eligibleViews)) views = BigInt(eligibleViews);
  else throw new Error("invalid_eligible_views");

  if (views < ZERO) throw new Error("invalid_eligible_views");
  if (views === ZERO) return ZERO;
  const maxCap = decimalToUnits(CHANNEL_V101_CPC_ZERO_CLICK_MAX_ENTITLEMENT);
  if (views >= CHANNEL_V101_CPC_ZERO_CLICK_MAX_VIEWS) return maxCap;

  for (let i = 0; i < ZERO_CLICK_MILESTONES.length - 1; i++) {
    const [v0, a0] = ZERO_CLICK_MILESTONES[i];
    const [v1, a1] = ZERO_CLICK_MILESTONES[i + 1];
    if (views >= v0 && views <= v1) {
      const dv = v1 - v0;
      const da = a1 - a0;
      // Integer half-up rounding in 1e8 units
      return a0 + ((views - v0) * da + dv / TWO) / dv;
    }
  }

  return maxCap;
}

export function calculateCpcZeroClickEntitlementDecimal(eligibleViews: number | bigint): string {
  return unitsToDecimal(calculateCpcZeroClickEntitlementUnits(eligibleViews));
}

export type DynamicEffectiveCpmResult = {
  effectiveCpmUnits: bigint;
  effectiveCpmDecimal: string;
  effectiveCpmDisplay6: string;
  views: bigint;
  cumulativeEarningsUnits: bigint;
};

/**
 * Derives publisher effective CPM dynamically from actual legitimate cumulative earnings.
 * Formula: eCPM = (cumulativeEarnings / validViews) * 1,000.
 * Safely handles 0 views, tiny earnings, and outputs both 8-decimal exact and 6-decimal display strings.
 */
export function calculateDynamicEffectiveCpm(input: {
  cumulativeEarnings: DecimalInput;
  validViews: number | bigint;
}): DynamicEffectiveCpmResult {
  const earningsUnits = strictMoneyUnits(input.cumulativeEarnings, "cumulative_earnings");
  let views: bigint;
  if (typeof input.validViews === "bigint") views = input.validViews;
  else if (Number.isSafeInteger(input.validViews)) views = BigInt(input.validViews);
  else throw new Error("invalid_valid_views");

  if (views < ZERO) throw new Error("valid_views_negative");

  if (views === ZERO || earningsUnits === ZERO) {
    return {
      effectiveCpmUnits: ZERO,
      effectiveCpmDecimal: "0.00000000",
      effectiveCpmDisplay6: "0.000000",
      views: ZERO,
      cumulativeEarningsUnits: earningsUnits,
    };
  }

  const thousand = BigInt(1000);
  // earningsUnits is scaled by 1e8. To compute (earnings * 1000 / views) in 1e8 units:
  // resultUnits = (earningsUnits * 1000 + views / 2) / views
  const cpmUnits = (earningsUnits * thousand + views / TWO) / views;
  const dec8 = unitsToDecimal(cpmUnits);

  return {
    effectiveCpmUnits: cpmUnits,
    effectiveCpmDecimal: dec8,
    effectiveCpmDisplay6: formatSixDecimalDisplay(dec8),
    views,
    cumulativeEarningsUnits: earningsUnits,
  };
}

export type ArrTransitionResult = {
  views: bigint;
  clicks: bigint;
  grossClickEntitlement: bigint;
  fundedAdvance: bigint;
  cumulativePublisherEarnings: bigint;
  outstandingAdvance: bigint;
  recoveredAmount: bigint;
  additionalCashPayout: bigint;
  effectiveCpmDecimal: string;
  effectiveCpmDisplay6: string;
};

/**
 * Models Automatic Reserve Recovery (ARR) transitions when valid clicks arrive
 * on a CPC campaign that received zero-click reserve support.
 * Invariant: Cumulative publisher earnings = max(actual funded reserve advance, cumulative legitimate click entitlement).
 * Outstanding advance = max(0, funded advance - gross click entitlement).
 * Recovered to reserve = funded advance - outstanding advance.
 * Additional cash payout = max(0, gross click entitlement - funded advance).
 */
export function calculateArrTransition(input: {
  eligibleViews: number | bigint;
  validClicks: number | bigint;
  clickPublisherUnitPrice: DecimalInput; // publisher base credit per click
  actualFundedAdvance: DecimalInput;     // reserve advance actually credited
}): ArrTransitionResult {
  let views: bigint;
  if (typeof input.eligibleViews === "bigint") views = input.eligibleViews;
  else if (Number.isSafeInteger(input.eligibleViews)) views = BigInt(input.eligibleViews);
  else throw new Error("invalid_eligible_views");

  let clicks: bigint;
  if (typeof input.validClicks === "bigint") clicks = input.validClicks;
  else if (Number.isSafeInteger(input.validClicks)) clicks = BigInt(input.validClicks);
  else throw new Error("invalid_valid_clicks");

  if (views < ZERO || clicks < ZERO) throw new Error("negative_engagement_units");

  const clickPriceUnits = strictMoneyUnits(input.clickPublisherUnitPrice, "click_publisher_unit_price");
  const fundedAdvanceUnits = strictMoneyUnits(input.actualFundedAdvance, "actual_funded_advance");

  const grossClickEntitlement = clicks * clickPriceUnits;
  const cumulativePublisherEarnings = fundedAdvanceUnits > grossClickEntitlement
    ? fundedAdvanceUnits
    : grossClickEntitlement;

  const outstandingAdvance = fundedAdvanceUnits > grossClickEntitlement
    ? fundedAdvanceUnits - grossClickEntitlement
    : ZERO;

  const recoveredAmount = fundedAdvanceUnits - outstandingAdvance;
  const additionalCashPayout = grossClickEntitlement > fundedAdvanceUnits
    ? grossClickEntitlement - fundedAdvanceUnits
    : ZERO;

  const cpm = calculateDynamicEffectiveCpm({
    cumulativeEarnings: unitsToDecimal(cumulativePublisherEarnings),
    validViews: views,
  });

  return {
    views,
    clicks,
    grossClickEntitlement,
    fundedAdvance: fundedAdvanceUnits,
    cumulativePublisherEarnings,
    outstandingAdvance,
    recoveredAmount,
    additionalCashPayout,
    effectiveCpmDecimal: cpm.effectiveCpmDecimal,
    effectiveCpmDisplay6: cpm.effectiveCpmDisplay6,
  };
}

export type V101QualityScoreBreakdown = {
  trustScore: number;
  trafficQualityScore: number;
  ctrScore: number;
  consistencyScore: number;
  retentionScore: number;
};

/**
 * Calculates the V1.01 publisher quality multiplier bounded strictly to [0.95, 1.05].
 * Trust score is limited to at most 20% of the total +/-5% range (+/-1.0% max standalone effect).
 * Other quality metrics contribute the remaining 80% (+/-4.0% max effect).
 * All factors combined are clamped strictly into [0.95000000, 1.05000000].
 */
export function calculateV101QualityMultiplier(scores: V101QualityScoreBreakdown): {
  multiplierUnits: bigint;
  multiplierDecimal: string;
  trustAdjustmentPercent: string;
  trafficAdjustmentPercent: string;
  totalAdjustmentPercent: string;
} {
  const neutral = decimalToUnits(CHANNEL_V101_NEUTRAL_QUALITY_MULTIPLIER); // 1.00000000
  const clampScore = (v: number) => Math.min(100, Math.max(0, Number.isFinite(v) ? v : 50));

  const trust = clampScore(scores.trustScore);
  const traffic = clampScore(scores.trafficQualityScore);
  const ctr = clampScore(scores.ctrScore);
  const consistency = clampScore(scores.consistencyScore);
  const retention = clampScore(scores.retentionScore);

  // Trust component: baseline 60, range +/-40 maps to +/-1.0% (+/-0.01000000)
  // deviationTrust = ((trust - 60) / 40) * 0.01
  const trustDelta = (trust - 60) / 40;
  const trustAdjNum = Math.min(0.01, Math.max(-0.01, trustDelta * 0.01));

  // Traffic / Engagement component: weighted average of remaining scores
  // CTR: 35%, Traffic: 25%, Consistency: 20%, Retention: 20%
  const trafficComposite = ctr * 0.35 + traffic * 0.25 + consistency * 0.20 + retention * 0.20;
  // Baseline 60, range +/-40 maps to +/-4.0% (+/-0.04000000)
  const trafficDelta = (trafficComposite - 60) / 40;
  const trafficAdjNum = Math.min(0.04, Math.max(-0.04, trafficDelta * 0.04));

  const totalDeltaNum = trustAdjNum + trafficAdjNum;
  const combinedMultiplierNum = Math.min(1.05, Math.max(0.95, 1.0 + totalDeltaNum));

  const multiplierUnits = decimalToUnits(combinedMultiplierNum.toFixed(8));
  const finalUnits = constrainQualityMultiplier(unitsToDecimal(multiplierUnits));

  return {
    multiplierUnits: finalUnits,
    multiplierDecimal: unitsToDecimal(finalUnits),
    trustAdjustmentPercent: (trustAdjNum * 100).toFixed(4),
    trafficAdjustmentPercent: (trafficAdjNum * 100).toFixed(4),
    totalAdjustmentPercent: ((Number(unitsToDecimal(finalUnits)) - 1.0) * 100).toFixed(4),
  };
}

/**
 * Formats an 8-decimal monetary amount into a clean 6-decimal string for publisher dashboard display.
 * Avoids truncation of real small balances (e.g. 0.001200 USDT is preserved, not rounded to 0.00).
 */
export function formatSixDecimalDisplay(value: DecimalInput): string {
  const units = strictMoneyUnits(value, "display_amount");
  const raw = unitsToDecimal(units);
  const [whole, fraction = "00000000"] = raw.split(".");
  return `${whole}.${fraction.slice(0, 6)}`;
}
