import { decimalToUnits, unitsToDecimal, type DecimalInput } from "@/lib/channelAllocationMath";

export const STANDARD_CPC_CLICK_POLICY_VERSION = "adsgalaxy-standard-cpc-click-v1";

const SCALE = BigInt(100_000_000);
const ZERO = BigInt(0);
export const STANDARD_CPC_ADVANCE_LIMIT_UNITS = BigInt(5) * SCALE;
export const STANDARD_CPC_PUBLISHER_LIMIT_UNITS = SCALE / BigInt(10);

export function isPhase1FinancialBackendEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CHANNEL_PHASE1_FINANCIAL_ENABLED === "true";
}

export function standardCpcAllowance(input: {
  issued: DecimalInput; recovered: DecimalInput; requested: DecimalInput;
  campaignKind: "standard_cpc" | "smart_reach" | "cpm";
}) {
  const issued = decimalToUnits(input.issued);
  const recovered = decimalToUnits(input.recovered);
  const requested = decimalToUnits(input.requested);
  if (issued < ZERO || recovered < ZERO || recovered > issued || requested < ZERO) throw new Error("invalid_advance_state");
  const outstanding = issued - recovered;
  if (outstanding > STANDARD_CPC_ADVANCE_LIMIT_UNITS) throw new Error("advance_limit_already_exceeded");
  const capacity = input.campaignKind === "standard_cpc" ? STANDARD_CPC_ADVANCE_LIMIT_UNITS - outstanding : ZERO;
  const permitted = requested < capacity ? requested : capacity;
  return { outstanding, capacity, permitted, outstandingDecimal: unitsToDecimal(outstanding),
    capacityDecimal: unitsToDecimal(capacity), permittedDecimal: unitsToDecimal(permitted) };
}

export function smartReachCpm(input: {
  selectedMaximum: DecimalInput; activeCpm: DecimalInput; qualifiedImpressions: bigint;
  settledClicks: bigint; observedMinutes: bigint; minutesSinceLastReprice: bigint;
}) {
  const selectedMaximum = decimalToUnits(input.selectedMaximum);
  const active = decimalToUnits(input.activeCpm);
  const floor = decimalToUnits("0.10");
  const upper = decimalToUnits("0.50");
  if (selectedMaximum < floor || selectedMaximum > upper || active < floor || active > selectedMaximum ||
      input.qualifiedImpressions < ZERO || input.settledClicks < ZERO || input.observedMinutes < ZERO ||
      input.minutesSinceLastReprice < ZERO) throw new Error("invalid_smart_reach_pricing_state");
  // Compare CTR as integers: 1%, 0.8%, and 0.6% boundaries.
  let ceiling = upper;
  const views = input.qualifiedImpressions;
  const clicks = input.settledClicks;
  if (views === ZERO || clicks * BigInt(100) >= views) ceiling = floor;
  else if (clicks * BigInt(1000) > views * BigInt(8)) ceiling = decimalToUnits("0.30");
  else if (clicks * BigInt(1000) > views * BigInt(6)) ceiling = decimalToUnits("0.40");
  if (ceiling > selectedMaximum) ceiling = selectedMaximum;
  // A better CTR reduces the rate immediately; increases need both evidence gates.
  if (ceiling <= active) return { nextUnits: ceiling, nextDecimal: unitsToDecimal(ceiling), ceilingUnits: ceiling };
  if (views < BigInt(3000) || input.observedMinutes < BigInt(30) || input.minutesSinceLastReprice < BigInt(30))
    return { nextUnits: active, nextDecimal: unitsToDecimal(active), ceilingUnits: ceiling };
  const step = decimalToUnits("0.10");
  const next = active + step < ceiling ? active + step : ceiling;
  return { nextUnits: next, nextDecimal: unitsToDecimal(next), ceilingUnits: ceiling };
}

export function smartReachImpressionCharge(input: { qualifiedNewViews: bigint; activeCpm: DecimalInput }) {
  const rate = decimalToUnits(input.activeCpm);
  if (input.qualifiedNewViews < ZERO || rate < decimalToUnits("0.10") || rate > decimalToUnits("0.50"))
    throw new Error("invalid_smart_reach_charge");
  const gross = (input.qualifiedNewViews * rate + BigInt(500)) / BigInt(1000);
  const publisher = gross * BigInt(60) / BigInt(100);
  const platform = gross * BigInt(30) / BigInt(100);
  const reserve = gross - publisher - platform;
  return { gross, publisher, platform, reserve,
    grossDecimal: unitsToDecimal(gross), publisherDecimal: unitsToDecimal(publisher),
    platformDecimal: unitsToDecimal(platform), reserveDecimal: unitsToDecimal(reserve) };
}
