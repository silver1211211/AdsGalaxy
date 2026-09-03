import { rebuildReferralEarningsCache } from "./paidReferralEarnings.ts";

type Result = { affectedRows: number; insertId?: number };
export type Tx = { query: (sql: string, params?: unknown[]) => Promise<[any, unknown?]> };
const SCALE = BigInt("100000000");
const units = (value: unknown) => {
  const [whole, fraction = ""] = String(value ?? 0).split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0").slice(0, 8));
};
const decimal = (value: bigint) => `${value / SCALE}.${String(value % SCALE).padStart(8, "0")}`;

export async function reconcileInvalidReferralRewards(conn: Tx, userId: number, expectedUsername: string) {
  const [[user]] = await conn.query("SELECT id,username,balance_available,balance_locked,total_withdrawn FROM users WHERE id=? FOR UPDATE", [userId]);
  if (!user || String(user.username).trim().toLowerCase() !== expectedUsername.trim().toLowerCase()) throw new Error("exact_account_not_found");
  const [rows] = await conn.query(
    `SELECT l.id reward_id,l.referral_id,l.amount,r.status,r.reward_status
     FROM referral_reward_ledger l JOIN referrals r ON r.id=l.referral_id
     WHERE l.user_id=? AND l.reward_type='referral_join' AND l.status='paid'
       AND (r.status IN ('fraud','rejected') OR r.reward_status='blocked')
     ORDER BY l.id FOR UPDATE`,
    [userId]
  );
  const candidates = rows as Array<{ reward_id: number; referral_id: number; amount: string }>;
  const debit = candidates.reduce((sum, row) => sum + units(row.amount), BigInt(0));
  const oldBalance = units(user.balance_available);
  if (oldBalance < debit) throw new Error("insufficient_available_balance");
  let running = oldBalance;
  let reversed = 0;
  const reversedRewardIds: number[] = [];

  for (const row of candidates) {
    const key = `referral-invalid-reversal:${row.reward_id}`;
    let inserted = false;
    try {
      const [result] = await conn.query(
        `INSERT INTO referral_reward_reversals(idempotency_key,user_id,referral_id,original_reward_id,amount,currency,reason,old_balance,new_balance,actor)
         VALUES(?,?,?,?,?,'USDT','referral_currently_invalid',?,?,'system:approved-reconciliation')`,
        [key, userId, row.referral_id, row.reward_id, row.amount, decimal(running), decimal(running - units(row.amount))]
      );
      if ((result as Result).affectedRows !== 1) throw new Error("reversal_insert_not_applied");
      inserted = true;
    } catch (error: any) {
      if (error?.code !== "ER_DUP_ENTRY") throw error;
      const [[existing]] = await conn.query("SELECT user_id,referral_id,original_reward_id,amount FROM referral_reward_reversals WHERE idempotency_key=? OR original_reward_id=? FOR UPDATE", [key, row.reward_id]);
      if (!existing || Number(existing.user_id) !== userId || Number(existing.referral_id) !== Number(row.referral_id) || Number(existing.original_reward_id) !== Number(row.reward_id) || units(existing.amount) !== units(row.amount)) throw new Error("reversal_idempotency_mismatch");
    }
    if (inserted) {
      const [updated] = await conn.query("UPDATE referral_reward_ledger SET status='reversed',reversal_reference=? WHERE id=? AND user_id=? AND status='paid'", [key, row.reward_id, userId]);
      if ((updated as Result).affectedRows !== 1) throw new Error("original_reward_state_changed");
      running -= units(row.amount);
      reversed += 1;
      reversedRewardIds.push(row.reward_id);
    }
  }

  const [updatedUser] = await conn.query("UPDATE users SET balance_available=? WHERE id=? AND balance_available=?", [decimal(running), userId, user.balance_available]);
  if ((updatedUser as Result).affectedRows !== 1) throw new Error("user_balance_state_changed");
  const paidTotal = await rebuildReferralEarningsCache(conn, userId);

  if (reversed > 0) {
    const operationKey = `referral-invalid-reconciliation:${userId}:${reversedRewardIds.join("-")}`;
    await conn.query(
      `INSERT INTO referral_reconciliation_audits(operation_key,user_id,actor,reward_count,debit,metadata)
       VALUES(?,?,'system:approved-reconciliation',?,?,?)`,
      [operationKey, userId, reversed, decimal(oldBalance - running), JSON.stringify({ reward_ids: reversedRewardIds, reason: "approved_invalid_referral_reversal" })]
    );
  }
  return { userId, oldAvailable: decimal(oldBalance), newAvailable: decimal(running), locked: String(user.balance_locked), debit: decimal(oldBalance - running), referralTotal: paidTotal, reversed };
}
