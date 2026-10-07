export const DEFAULT_MIN_DEPOSIT_AMOUNT = "5.00000000";
export const MAX_DEPOSIT_AMOUNT = "9999999.99999999";
const ZERO = BigInt(0);
const SCALE = BigInt(100000000);
const MAX_SCALED = BigInt("999999999999999");
function scaledDecimal(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(text);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] || "").padEnd(8, "0"));
}
export function validateDepositAmount(value: unknown, minimum: string | number = DEFAULT_MIN_DEPOSIT_AMOUNT) {
  const amount = scaledDecimal(value);
  const min = scaledDecimal(minimum) ?? scaledDecimal(DEFAULT_MIN_DEPOSIT_AMOUNT)!;
  if (amount === null) return { ok: false as const, code: "INVALID_AMOUNT", message: "Enter a valid deposit amount with no more than 8 decimal places." };
  if (amount < min) return { ok: false as const, code: "BELOW_MINIMUM", message: `Minimum deposit amount is $${minimum}` };
  if (amount > MAX_SCALED) return { ok: false as const, code: "ABOVE_MAXIMUM", message: "Amount exceeds maximum supported deposit." };
  const whole = amount / SCALE;
  const fraction = (amount % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return { ok: true as const, normalized: fraction ? `${whole}.${fraction}` : whole.toString() };
}
export function validateProviderPayAmount(value: unknown) {
  const amount = scaledDecimal(value);
  return amount !== null && amount > ZERO && amount <= MAX_SCALED;
}
