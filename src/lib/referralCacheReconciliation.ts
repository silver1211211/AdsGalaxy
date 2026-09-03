import { getPaidReferralEarnings, normalizeReferralDecimal, rebuildReferralEarningsCache } from "./paidReferralEarnings.ts";

type Result = { affectedRows: number };
export type CacheReconciliationConnection = {
  query: (sql: string, params?: unknown[]) => Promise<[any, unknown?]>;
};

const maskUsername = (value: unknown) => {
  const text = String(value || "").trim();
  if (text.length <= 2) return "**";
  return `${text[0]}${"*".repeat(Math.min(8, text.length - 2))}${text.at(-1)}`;
};

export async function inspectReferralCache(connection: CacheReconciliationConnection, userId: number) {
  const [[user]] = await connection.query(
    "SELECT id,username,balance_available,balance_locked,total_referral_earnings FROM users WHERE id=? FOR UPDATE",
    [userId]
  );
  if (!user) throw new Error("exact_account_not_found");
  const immutablePaidTotal = await getPaidReferralEarnings(connection, userId);
  return {
    userId,
    username: maskUsername(user.username),
    immutablePaidTotal,
    currentCache: normalizeReferralDecimal(user.total_referral_earnings),
    proposedCache: immutablePaidTotal,
    proposedBalanceCorrection: "0.00000000",
    availableBalance: normalizeReferralDecimal(user.balance_available),
    lockedBalance: normalizeReferralDecimal(user.balance_locked),
  };
}

export async function applyReferralCacheRepair(connection: CacheReconciliationConnection, userId: number) {
  if (userId !== 78930) throw new Error("cache_repair_not_approved_for_user");
  const before = await inspectReferralCache(connection, userId);
  const operationKey = `referral-cache-rebuild:${userId}:${before.immutablePaidTotal}`;
  const [audit] = await connection.query(
    `INSERT IGNORE INTO referral_reconciliation_audits(operation_key,user_id,actor,reward_count,debit,metadata)
     VALUES(?,?,'system:approved-cache-repair',0,0,?)`,
    [operationKey, userId, JSON.stringify({ old_cache: before.currentCache, immutable_paid_total: before.immutablePaidTotal, balance_correction: "0.00000000" })]
  );
  await rebuildReferralEarningsCache(connection, userId);
  const after = await inspectReferralCache(connection, userId);
  if (after.currentCache !== after.immutablePaidTotal) throw new Error("post_repair_cache_mismatch");
  return { before, after, operationKey, auditInserted: (audit as Result).affectedRows === 1 };
}
