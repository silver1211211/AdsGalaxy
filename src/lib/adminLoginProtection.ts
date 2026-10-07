import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_LOGIN_ACCOUNT_IP_MAX = 5;
export const ADMIN_LOGIN_IP_MAX = 20;

type LimitScope = "account_ip" | "ip";
type LimitRow = RowDataPacket & {
  failure_count: number;
  retry_after_ms: number;
  window_active: number;
};

type LimitState = {
  available: boolean;
  limited: boolean;
  retryAfterMs: number;
};

function digest(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function adminLoginRateLimitKeys(username: string, ip: string) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedIp = String(ip || "unknown").trim().toLowerCase();
  return {
    accountIp: `security:admin-login:account-ip:${digest(`${normalizedUsername}\u0000${normalizedIp}`)}`,
    ip: `security:admin-login:ip:${digest(normalizedIp)}`,
  };
}

async function readState(scope: LimitScope, keyHash: string, maximumAttempts: number): Promise<LimitState> {
  const [rows] = await pool.query<LimitRow[]>(
    `SELECT failure_count,
            GREATEST(0, TIMESTAMPDIFF(MICROSECOND, NOW(3), locked_until) / 1000) AS retry_after_ms,
            window_started_at > DATE_SUB(NOW(3), INTERVAL 15 MINUTE) AS window_active
     FROM admin_login_rate_limits
     WHERE scope = ? AND key_hash = ?
     LIMIT 1`,
    [scope, keyHash],
  );
  const row = rows[0];
  if (!row) return { available: true, limited: false, retryAfterMs: 0 };
  const retryAfterMs = Math.max(0, Number(row.retry_after_ms || 0));
  return {
    available: true,
    limited: retryAfterMs > 0 || (Boolean(row.window_active) && Number(row.failure_count) >= maximumAttempts),
    retryAfterMs,
  };
}

async function recordFailure(scope: LimitScope, keyHash: string, maximumAttempts: number) {
  await pool.query(
    `INSERT INTO admin_login_rate_limits
       (scope, key_hash, failure_count, window_started_at, locked_until, updated_at)
     VALUES (?, ?, 1, NOW(3), NULL, NOW(3))
     ON DUPLICATE KEY UPDATE
       locked_until = CASE
         WHEN window_started_at <= DATE_SUB(NOW(3), INTERVAL 15 MINUTE) THEN NULL
         WHEN failure_count + 1 >= ? THEN DATE_ADD(NOW(3), INTERVAL 15 MINUTE)
         ELSE locked_until
       END,
       failure_count = IF(
         window_started_at <= DATE_SUB(NOW(3), INTERVAL 15 MINUTE),
         1,
         failure_count + 1
       ),
       window_started_at = IF(
         window_started_at <= DATE_SUB(NOW(3), INTERVAL 15 MINUTE),
         NOW(3),
         window_started_at
       ),
       updated_at = NOW(3)`,
    [scope, keyHash, maximumAttempts],
  );
  return readState(scope, keyHash, maximumAttempts);
}

export async function inspectAdminLoginRateLimit(username: string, ip: string) {
  try {
    const keys = adminLoginRateLimitKeys(username, ip);
    const [accountIp, ipOnly] = await Promise.all([
      readState("account_ip", keys.accountIp, ADMIN_LOGIN_ACCOUNT_IP_MAX),
      readState("ip", keys.ip, ADMIN_LOGIN_IP_MAX),
    ]);
    return {
      available: true,
      limited: accountIp.limited || ipOnly.limited,
      retryAfterMs: Math.max(accountIp.retryAfterMs, ipOnly.retryAfterMs),
    };
  } catch {
    return { available: false, limited: false, retryAfterMs: 0 };
  }
}

export async function recordAdminLoginFailure(username: string, ip: string) {
  try {
    const keys = adminLoginRateLimitKeys(username, ip);
    const [accountIp, ipOnly] = await Promise.all([
      recordFailure("account_ip", keys.accountIp, ADMIN_LOGIN_ACCOUNT_IP_MAX),
      recordFailure("ip", keys.ip, ADMIN_LOGIN_IP_MAX),
    ]);
    await pool.query(
      "DELETE FROM admin_login_rate_limits WHERE updated_at < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 100",
    );
    return {
      available: true,
      limited: accountIp.limited || ipOnly.limited,
      retryAfterMs: Math.max(accountIp.retryAfterMs, ipOnly.retryAfterMs),
    };
  } catch {
    return { available: false, limited: false, retryAfterMs: 0 };
  }
}

export async function clearAdminLoginFailures(username: string, ip: string) {
  try {
    const keys = adminLoginRateLimitKeys(username, ip);
    // A successful account login clears its account+IP failures. The broader
    // IP counter remains so one valid Admin cannot erase attacks on others.
    await pool.query(
      "DELETE FROM admin_login_rate_limits WHERE scope = 'account_ip' AND key_hash = ?",
      [keys.accountIp],
    );
    return true;
  } catch {
    return false;
  }
}
