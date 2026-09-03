const MONEY_SCALE = 8;
const ZERO = BigInt(0);
const MONEY_FACTOR = BigInt(100_000_000);

export function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function wholeNonNegative(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a whole non-negative integer`);
  }
  return number;
}

export function calculateSyncProgress(input: {
  nowMs: number;
  startedAtMs: number;
  endsAtMs: number;
  durationSeconds: number;
  pausedAtMs?: number | null;
}) {
  const referenceMs = input.pausedAtMs ?? input.nowMs;
  const durationMs = Math.max(1, input.durationSeconds * 1000);
  const remainingMs = Math.max(0, input.endsAtMs - referenceMs);
  return clampRatio((durationMs - remainingMs) / durationMs);
}

export function calculateCumulativeExternalDue(input: {
  requiredExternal: number;
  platformDeliveredDuring: number;
  externalAlreadyAdded: number;
  progress: number;
}) {
  const required = Math.max(0, Math.floor(input.requiredExternal));
  const platform = Math.max(0, Math.floor(input.platformDeliveredDuring));
  const alreadyAdded = Math.max(0, Math.floor(input.externalAlreadyAdded));
  const scheduledCombinedIncrease = Math.floor(required * clampRatio(input.progress));
  const desiredExternalCumulative = Math.min(required, Math.max(0, scheduledCombinedIncrease - platform));
  return Math.max(0, desiredExternalCumulative - alreadyAdded);
}

export function decimalToMoneyUnits(value: unknown) {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid money value: ${raw}`);
  const fraction = `${match[3] || ""}${"0".repeat(MONEY_SCALE)}`.slice(0, MONEY_SCALE);
  const units = BigInt(match[2]) * MONEY_FACTOR + BigInt(fraction || "0");
  return match[1] ? -units : units;
}

export function moneyUnitsToDecimal(units: bigint) {
  const negative = units < ZERO;
  const absolute = negative ? -units : units;
  const whole = absolute / MONEY_FACTOR;
  const fraction = String(absolute % MONEY_FACTOR).padStart(MONEY_SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function miniAppImpressionCostUnits(cpm: unknown) {
  const cpmUnits = decimalToMoneyUnits(cpm);
  if (cpmUnits <= ZERO) return ZERO;
  return (cpmUnits + BigInt(500)) / BigInt(1000);
}

export function miniAppImpressionCost(cpm: unknown) {
  return Number(moneyUnitsToDecimal(miniAppImpressionCostUnits(cpm)));
}

export function affordableExternalImpressions(input: {
  requested: number;
  unitCost: bigint;
  remainingBudget: bigint;
  advertiserBalance: bigint;
  dailyBudgetAvailable?: bigint | null;
}) {
  const requested = BigInt(Math.max(0, Math.floor(input.requested)));
  if (requested === ZERO || input.unitCost <= ZERO) return 0;
  let affordable = requested;
  affordable = affordable < input.remainingBudget / input.unitCost ? affordable : input.remainingBudget / input.unitCost;
  affordable = affordable < input.advertiserBalance / input.unitCost ? affordable : input.advertiserBalance / input.unitCost;
  if (input.dailyBudgetAvailable !== null && input.dailyBudgetAvailable !== undefined) {
    const daily = input.dailyBudgetAvailable > ZERO ? input.dailyBudgetAvailable / input.unitCost : ZERO;
    affordable = affordable < daily ? affordable : daily;
  }
  return Number(affordable);
}
