import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";

type DbExecutor = Pool | PoolConnection;

export async function creditUserLockedBalance(executor: DbExecutor, userId: number | string, amount: number) {
  const [result] = await executor.query<ResultSetHeader>(
    "UPDATE users SET balance_locked = balance_locked + ? WHERE id = ?",
    [amount, userId]
  );

  return result.affectedRows === 1;
}

export async function creditUserAvailableBalance(executor: DbExecutor, userId: number | string, amount: number) {
  const [result] = await executor.query<ResultSetHeader>(
    "UPDATE users SET balance_available = balance_available + ? WHERE id = ?",
    [amount, userId]
  );

  return result.affectedRows === 1;
}

export async function unlockUserBalance(executor: DbExecutor, userId: number | string, amount: number) {
  const [result] = await executor.query<ResultSetHeader>(
    "UPDATE users SET balance_locked = balance_locked - ?, balance_available = balance_available + ? WHERE id = ?",
    [amount, amount, userId]
  );

  return result.affectedRows === 1;
}
