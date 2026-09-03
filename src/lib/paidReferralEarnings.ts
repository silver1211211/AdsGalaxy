export type ReferralQueryConnection = {
  query: (sql: string, params?: unknown[]) => Promise<[any, unknown?]>;
};

const SCALE = 8;

export function normalizeReferralDecimal(value: unknown): string {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("invalid_referral_decimal");
  const fraction = (match[3] || "").padEnd(SCALE, "0").slice(0, SCALE);
  return `${match[1]}${match[2]}.${fraction}`;
}

export function addReferralDecimals(left: unknown, right: unknown): string {
  const units = (value: unknown) => BigInt(normalizeReferralDecimal(value).replace(".", ""));
  const total = units(left) + units(right);
  const negative = total < BigInt(0);
  const absolute = negative ? -total : total;
  const digits = absolute.toString().padStart(SCALE + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}

/** Canonical paid referral total. Reversed rows are excluded because their status is not paid. */
export async function getPaidReferralEarnings(connection: ReferralQueryConnection, userId: number): Promise<string> {
  const [rows] = await connection.query(
    `SELECT CAST(COALESCE(SUM(amount), 0) AS DECIMAL(24,8)) AS paid_referral_earnings
     FROM referral_reward_ledger
     WHERE user_id = ? AND status = 'paid'`,
    [userId]
  );
  return normalizeReferralDecimal(rows?.[0]?.paid_referral_earnings ?? "0");
}

/** Rebuild the legacy display cache from the immutable paid ledger in the caller's transaction. */
export async function rebuildReferralEarningsCache(
  connection: ReferralQueryConnection,
  userId: number
): Promise<string> {
  const [users] = await connection.query(
    "SELECT id FROM users WHERE id = ? FOR UPDATE",
    [userId]
  );
  if (!users?.[0]) throw new Error("referral_cache_user_not_found");

  const paidTotal = await getPaidReferralEarnings(connection, userId);
  await connection.query(
    "UPDATE users SET total_referral_earnings = ? WHERE id = ?",
    [paidTotal, userId]
  );
  const [verified] = await connection.query(
    "SELECT CAST(total_referral_earnings AS DECIMAL(24,8)) AS total_referral_earnings FROM users WHERE id = ?",
    [userId]
  );
  if (normalizeReferralDecimal(verified?.[0]?.total_referral_earnings) !== paidTotal) {
    throw new Error("referral_cache_sync_failed");
  }
  return paidTotal;
}

export async function settleInsertedReferralReward(
  connection: ReferralQueryConnection,
  input: { ledgerId: number; userId: number; amount: string }
): Promise<boolean> {
  const [settled] = await connection.query(
    `UPDATE referral_reward_ledger
     SET status='paid', settled_amount=amount, settled_at=NOW()
     WHERE id=? AND user_id=? AND amount=? AND status='pending'`,
    [input.ledgerId, input.userId, input.amount]
  );
  if (Number(settled?.affectedRows || 0) !== 1) return false;
  const [credited] = await connection.query(
    "UPDATE users SET balance_available=balance_available+? WHERE id=?",
    [input.amount, input.userId]
  );
  if (Number(credited?.affectedRows || 0) !== 1) throw new Error("referral_balance_credit_failed");
  await rebuildReferralEarningsCache(connection, input.userId);
  return true;
}
