import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { withFinancialPostingContext, type FinancialPostingContext } from "./financialPostingContext";

type DbExecutor = Pool | PoolConnection;

async function attributed<T>(executor: DbExecutor, context: FinancialPostingContext | undefined, action: () => Promise<T>) {
  if (!context) return action();
  if (typeof (executor as PoolConnection).release !== "function") {
    throw new Error("financial_posting_requires_dedicated_connection");
  }
  return withFinancialPostingContext(executor as PoolConnection, context, action);
}

export function isZeroOrdinaryLockEnabled(): boolean {
  return true;
}

export async function creditSettledPublisherBalance(
  executor: DbExecutor, userId: number | string, amount: number | string, context?: FinancialPostingContext
) {
  return isZeroOrdinaryLockEnabled()
    ? creditUserAvailableBalance(executor, userId, amount, context)
    : creditUserLockedBalance(executor, userId, amount, context);
}

export async function creditUserLockedBalance(
  executor: DbExecutor, userId: number | string, amount: number | string, context?: FinancialPostingContext
) {
  return attributed(executor, context, async () => {
    const [result] = await executor.query<ResultSetHeader>(
      "UPDATE users SET balance_locked = balance_locked + ? WHERE id = ?",
      [amount, userId]
    );
    return result.affectedRows === 1;
  });
}

export async function creditUserAvailableBalance(
  executor: DbExecutor, userId: number | string, amount: number | string, context?: FinancialPostingContext
) {
  return attributed(executor, context, async () => {
    const [result] = await executor.query<ResultSetHeader>(
      "UPDATE users SET balance_available = balance_available + ? WHERE id = ?",
      [amount, userId]
    );
    return result.affectedRows === 1;
  });
}

export async function unlockUserBalance(
  executor: DbExecutor, userId: number | string, amount: number | string, context?: FinancialPostingContext
) {
  return attributed(executor, context, async () => {
    const [result] = await executor.query<ResultSetHeader>(
      "UPDATE users SET balance_locked = balance_locked - ?, balance_available = balance_available + ? WHERE id = ?",
      [amount, amount, userId]
    );
    return result.affectedRows === 1;
  });
}
