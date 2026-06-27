import crypto from "crypto";
import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";

function clean(value: unknown) {
  return String(value || "").trim();
}

export function requireCronSecret(request: Request) {
  const secret = clean(process.env.CRON_SECRET);
  const url = new URL(request.url);
  const route = url.pathname;
  const ip = clean(request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip"));
  if (!secret) {
    console.error("Cron authentication failed: CRON_SECRET is not configured", { route, ip });
    return NextResponse.json({ error: "Cron secret is not configured" }, { status: 503 });
  }

  const supplied = clean(request.headers.get("x-cron-secret"));
  if (!supplied || supplied !== secret) {
    console.warn("Cron authentication failed: invalid or missing secret", { route, ip });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function acquireCronLock(lockName: string, ttlSeconds = 900) {
  const ownerToken = crypto.randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO cron_locks (lock_name, locked_until, owner_token, acquired_at)
     VALUES (?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?, NOW())
     ON DUPLICATE KEY UPDATE
       owner_token = IF(locked_until <= NOW(), VALUES(owner_token), owner_token),
       acquired_at = IF(locked_until <= NOW(), NOW(), acquired_at),
       locked_until = IF(locked_until <= NOW(), VALUES(locked_until), locked_until)`,
    [lockName, ttlSeconds, ownerToken]
  );

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE cron_locks
     SET locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
         owner_token = ?,
         acquired_at = NOW()
     WHERE lock_name = ?
       AND owner_token = ?`,
    [ttlSeconds, ownerToken, lockName, ownerToken]
  );

  if (result.affectedRows !== 1) {
    return null;
  }

  return { lockName, ownerToken };
}

export async function releaseCronLock(lock: { lockName: string; ownerToken: string } | null) {
  if (!lock) return;
  await pool.query(
    "UPDATE cron_locks SET locked_until = NOW() WHERE lock_name = ? AND owner_token = ?",
    [lock.lockName, lock.ownerToken]
  );
}
