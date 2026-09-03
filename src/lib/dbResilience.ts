import type { FieldPacket, PoolConnection, QueryResult } from "mysql2/promise";
import pool, { DB_QUERY_TIMEOUT_MS, DB_RETRY_ATTEMPTS } from "@/lib/db";

type MysqlError = Error & { code?: string; errno?: number };

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_STATEMENT_TIMEOUT",
]);

export function isTransientDatabaseError(error: unknown) {
  const candidate = error as MysqlError;
  return TRANSIENT_CODES.has(String(candidate?.code || ""))
    || candidate?.errno === 1_213
    || candidate?.errno === 1_205
    || candidate?.errno === 1_969;
}

function delayForAttempt(attempt: number) {
  const exponential = 75 * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 50);
  return new Promise((resolve) => setTimeout(resolve, exponential + jitter));
}

export async function queryWithRetry<T extends QueryResult>(
  sql: string,
  values: unknown[] = [],
  options: { timeoutMs?: number; attempts?: number; operation?: string } = {},
): Promise<[T, FieldPacket[]]> {
  const attempts = Math.min(5, Math.max(1, options.attempts ?? DB_RETRY_ATTEMPTS));
  const timeout = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? DB_QUERY_TIMEOUT_MS));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pool.query<T>({ sql, timeout }, values);
    } catch (error) {
      const retry = attempt < attempts && isTransientDatabaseError(error);
      console.error("Database operation failed", {
        operation: options.operation || "query",
        attempt,
        retry,
        code: (error as MysqlError)?.code || "UNKNOWN",
      });
      if (!retry) throw error;
      await delayForAttempt(attempt);
    }
  }

  throw new Error("Database retry attempts exhausted");
}

export async function withTransactionRetry<T>(
  operation: (connection: PoolConnection) => Promise<T>,
  options: { attempts?: number; operation?: string } = {},
): Promise<T> {
  const attempts = Math.min(5, Math.max(1, options.attempts ?? DB_RETRY_ATTEMPTS));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const connection = await pool.getConnection();
    try {
      // Keep a blocked row lock from monopolizing a pooled connection. This is
      // intentionally scoped to resilient transactional paths on MariaDB.
      await connection.query("SET SESSION innodb_lock_wait_timeout = 5");
      await connection.query("SET SESSION max_statement_time = 6");
      await connection.beginTransaction();
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {}

      const retry = attempt < attempts && isTransientDatabaseError(error);
      console.error("Database transaction failed", {
        operation: options.operation || "transaction",
        attempt,
        retry,
        code: (error as MysqlError)?.code || "UNKNOWN",
      });
      if (!retry) throw error;
      await delayForAttempt(attempt);
    } finally {
      try {
        // Transaction safeguards are session-scoped. Restore the server defaults
        // before this connection can serve unrelated read-heavy dashboard queries.
        await connection.query("SET SESSION innodb_lock_wait_timeout = DEFAULT");
        await connection.query("SET SESSION max_statement_time = DEFAULT");
        connection.release();
      } catch (resetError) {
        console.error("Database session reset failed; discarding connection", {
          operation: options.operation || "transaction",
          code: (resetError as MysqlError)?.code || "UNKNOWN",
        });
        connection.destroy();
      }
    }
  }

  throw new Error("Database transaction retry attempts exhausted");
}
