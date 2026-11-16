import { decimalToUnits, unitsToDecimal } from "@/lib/channelAllocationMath";

const ZERO = BigInt(0);
const THOUSAND = BigInt(1000);
const HALF_THOUSAND = BigInt(500);

/** Exact incremental advertiser charge; the caller must verify the audit and lock the post. */
export function calculateSmartReachImpressionCharge(input: {
  previouslyBilledViews: number;
  verifiedEligibleViews: number;
  rateSegmentStartViews?: number;
  effectiveCpm: string;
  maximumCpm: string;
}) {
  const { previouslyBilledViews, verifiedEligibleViews } = input;
  const segmentStart=input.rateSegmentStartViews??0;
  if (!Number.isSafeInteger(previouslyBilledViews) || previouslyBilledViews < 0 ||
      !Number.isSafeInteger(verifiedEligibleViews) || verifiedEligibleViews <= previouslyBilledViews ||
      !Number.isSafeInteger(segmentStart) || segmentStart<0 || segmentStart>previouslyBilledViews) {
    throw new Error("smart_reach_stale_or_invalid_view_range");
  }
  const effective = decimalToUnits(input.effectiveCpm);
  const maximum = decimalToUnits(input.maximumCpm);
  if (maximum < decimalToUnits("0.10") || maximum > decimalToUnits("0.50") ||
      effective < decimalToUnits("0.10") || effective > maximum) {
    throw new Error("smart_reach_rate_out_of_range");
  }
  const newViews = BigInt(verifiedEligibleViews - previouslyBilledViews);
  const currentSegmentViews=BigInt(verifiedEligibleViews-segmentStart);
  const priorSegmentViews=BigInt(previouslyBilledViews-segmentStart);
  const chargeUnits=(currentSegmentViews*effective+HALF_THOUSAND)/THOUSAND
    -(priorSegmentViews*effective+HALF_THOUSAND)/THOUSAND;
  if (chargeUnits <= ZERO) throw new Error("smart_reach_zero_charge");
  return {
    newViews,
    chargeUnits,
    chargeDecimal: unitsToDecimal(chargeUnits),
    effectiveCpmDecimal: unitsToDecimal(effective),
  };
}
