const MONEY_SCALE = BigInt(100_000_000);

export function decimalToUnits(value: unknown): bigint {
  const text = String(value ?? "0").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("invalid_deposit_amount");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MONEY_SCALE + BigInt((fraction + "00000000").slice(0, 8));
}

export function unitsToDecimal(units: bigint): string {
  const whole = units / MONEY_SCALE;
  const fraction = (units % MONEY_SCALE).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
}

export function depositBonusRateBasisPoints(amount: unknown): number {
  const units = decimalToUnits(amount);
  if (units < BigInt(100) * MONEY_SCALE) return 0;
  if (units < BigInt(300) * MONEY_SCALE) return 500;
  if (units < BigInt(720) * MONEY_SCALE) return 750;
  if (units < BigInt(2201) * MONEY_SCALE) return 1000;
  return 1200;
}

export function calculateDepositBonus(amount: unknown) {
  const principalUnits = decimalToUnits(amount);
  const rateBasisPoints = depositBonusRateBasisPoints(amount);
  const rawUnits = (principalUnits * BigInt(rateBasisPoints)) / BigInt(10_000);
  const centUnits = BigInt(1_000_000);
  const bonusUnits = ((rawUnits + centUnits / BigInt(2)) / centUnits) * centUnits;
  return {
    rateBasisPoints,
    ratePercent: unitsToDecimal(BigInt(rateBasisPoints) * BigInt(10_000)),
    bonusAmount: unitsToDecimal(bonusUnits),
    totalCredited: unitsToDecimal(principalUnits + bonusUnits),
  };
}
