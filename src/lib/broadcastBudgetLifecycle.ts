const MONEY_SCALE = BigInt(100_000_000);

export function broadcastMoneyUnits(value: unknown) {
  let raw = String(value ?? "").trim();
  if (/e/i.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return BigInt(0);
    raw = numeric.toFixed(8);
  }
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
  if (!match) return BigInt(0);
  const negative = match[1] === "-";
  const fraction = match[3] || "";
  let units = BigInt(match[2]) * MONEY_SCALE + BigInt(fraction.padEnd(8, "0").slice(0, 8));
  if ((fraction[8] || "0") >= "5") units += BigInt(1);
  return negative ? -units : units;
}

export function addBroadcastMoney(left: unknown, right: unknown) {
  const units = broadcastMoneyUnits(left) + broadcastMoneyUnits(right);
  const negative = units < BigInt(0);
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = String(magnitude % MONEY_SCALE).padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function evaluateBroadcastAffordability(budget: unknown, nextDebit: unknown) {
  const budgetUnits = broadcastMoneyUnits(budget);
  const debitUnits = broadcastMoneyUnits(nextDebit);
  const affordable = debitUnits > BigInt(0) && budgetUnits >= debitUnits;
  return {
    affordable,
    exhausted: !affordable,
    remainingAfterReservationUnits: affordable ? budgetUnits - debitUnits : budgetUnits,
  };
}

export function canFundBroadcastDelivery(budget: unknown, nextDebit: unknown) {
  return evaluateBroadcastAffordability(budget, nextDebit).affordable;
}

export function publicBroadcastBudget(budget: unknown) {
  const units = broadcastMoneyUnits(budget);
  return units > BigInt(0) ? Number(units) / Number(MONEY_SCALE) : 0;
}

export function refundedBroadcastStatus(input: {
  status: unknown;
  pauseReason: unknown;
  refundedBudget: unknown;
  nextDebit: unknown;
}) {
  const automaticallyExhausted =
    input.status === "budget_exhausted" && input.pauseReason === "budget_exhausted";
  return automaticallyExhausted && canFundBroadcastDelivery(input.refundedBudget, input.nextDebit)
    ? "active"
    : String(input.status || "");
}
