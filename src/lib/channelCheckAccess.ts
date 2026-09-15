import "server-only";

import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { redisKeys } from "@/lib/redisCache";
import {
  clearDistributedRateLimit,
  getDistributedRateLimitState,
  recordDistributedRateLimitFailure,
} from "@/lib/redisRateLimit";

const SETTING_KEYS = {
  unlockedUntil: "channel_check_unlocked_until",
  lastUnlockedAt: "channel_check_last_unlocked_at",
  durationMinutes: "channel_check_duration_minutes",
  unlockedByAdminId: "channel_check_unlocked_by_admin_id",
} as const;

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_LOCK_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

type RateLimitEntry = {
  count: number;
  resetAt: number;
  lockedUntil: number;
};

type AdminPasswordRow = RowDataPacket & {
  id: number;
  password_hash: string | null;
};

type AdminColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type SettingRow = RowDataPacket & {
  key: string;
  value: string | null;
};

const attempts = new Map<string, RateLimitEntry>();

function nowMs() {
  return Date.now();
}

function msToDateTime(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "1970-01-01 00:00:00";
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function normalizeDuration(input: unknown, fallback = 60) {
  const parsed = Number.parseInt(String(input || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(24 * 60, parsed));
}

async function ensureUnlockSettings() {
  await pool.query(
    `INSERT IGNORE INTO settings (\`key\`, value, description) VALUES
      (?, '0', 'Temporary channel-check page global unlock expiry as epoch milliseconds'),
      (?, '0', 'Temporary channel-check page last unlock time as epoch milliseconds'),
      (?, '60', 'Temporary channel-check page last configured unlock duration in minutes'),
      (?, '', 'Admin id that last unlocked the temporary channel-check page')`,
    [
      SETTING_KEYS.unlockedUntil,
      SETTING_KEYS.lastUnlockedAt,
      SETTING_KEYS.durationMinutes,
      SETTING_KEYS.unlockedByAdminId,
    ]
  );
}

export async function getChannelCheckUnlockState() {
  await ensureUnlockSettings();
  const [rows] = await pool.query<SettingRow[]>(
    "SELECT `key`, value FROM settings WHERE `key` IN (?)",
    [[
      SETTING_KEYS.unlockedUntil,
      SETTING_KEYS.lastUnlockedAt,
      SETTING_KEYS.durationMinutes,
      SETTING_KEYS.unlockedByAdminId,
    ]]
  );

  const values = new Map(rows.map((row) => [row.key, String(row.value || "")]));
  const unlockedUntilMs = Number.parseInt(values.get(SETTING_KEYS.unlockedUntil) || "0", 10) || 0;
  const lastUnlockedAtMs = Number.parseInt(values.get(SETTING_KEYS.lastUnlockedAt) || "0", 10) || 0;
  const durationMinutes = normalizeDuration(values.get(SETTING_KEYS.durationMinutes), 60);
  const remainingMs = Math.max(0, unlockedUntilMs - nowMs());

  return {
    isUnlocked: remainingMs > 0,
    unlockedUntilMs,
    lastUnlockedAtMs,
    durationMinutes,
    remainingMs,
    unlockedUntilIso: unlockedUntilMs > 0 ? new Date(unlockedUntilMs).toISOString() : null,
    lastUnlockedAtIso: lastUnlockedAtMs > 0 ? new Date(lastUnlockedAtMs).toISOString() : null,
  };
}

export async function unlockChannelCheck(durationInput: unknown, adminId: number) {
  await ensureUnlockSettings();
  const durationMinutes = normalizeDuration(durationInput, 60);
  const unlockedAt = nowMs();
  const unlockedUntil = unlockedAt + durationMinutes * 60 * 1000;

  await pool.query(
    `INSERT INTO settings (\`key\`, value, description) VALUES
      (?, ?, 'Temporary channel-check page global unlock expiry as epoch milliseconds'),
      (?, ?, 'Temporary channel-check page last unlock time as epoch milliseconds'),
      (?, ?, 'Temporary channel-check page last configured unlock duration in minutes'),
      (?, ?, 'Admin id that last unlocked the temporary channel-check page')
     ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description)`,
    [
      SETTING_KEYS.unlockedUntil,
      String(unlockedUntil),
      SETTING_KEYS.lastUnlockedAt,
      String(unlockedAt),
      SETTING_KEYS.durationMinutes,
      String(durationMinutes),
      SETTING_KEYS.unlockedByAdminId,
      String(adminId),
    ]
  );

  return {
    durationMinutes,
    unlockedAtMs: unlockedAt,
    unlockedUntilMs: unlockedUntil,
    unlockedUntilIso: new Date(unlockedUntil).toISOString(),
    unlockedUntilDb: msToDateTime(unlockedUntil),
  };
}

function getAttempt(key: string) {
  const current = nowMs();
  const existing = attempts.get(key);
  if (!existing || existing.resetAt <= current) {
    const next = { count: 0, resetAt: current + RATE_LIMIT_WINDOW_MS, lockedUntil: 0 };
    attempts.set(key, next);
    return next;
  }
  return existing;
}

async function recordFailedAttempt(key: string, distributedKey: string, redisAvailable: boolean) {
  if (redisAvailable) {
    const recorded = await recordDistributedRateLimitFailure(
      distributedKey,
      RATE_LIMIT_MAX_ATTEMPTS,
      RATE_LIMIT_WINDOW_MS,
      RATE_LIMIT_LOCK_MS,
    );
    if (recorded.available) return;
  }
  const entry = getAttempt(key);
  entry.count += 1;
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.lockedUntil = nowMs() + RATE_LIMIT_LOCK_MS;
  }
}

async function clearAttempts(key: string, distributedKey: string) {
  attempts.delete(key);
  await clearDistributedRateLimit(distributedKey);
}

async function getAdminPasswordRows() {
  const [columns] = await pool.query<AdminColumnRow[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'admins'
       AND COLUMN_NAME IN ('status', 'is_active', 'is_deleted', 'password_hash')`
  );
  const columnSet = new Set(columns.map((column) => column.COLUMN_NAME));

  if (!columnSet.has("password_hash")) return [];

  const filters = ["password_hash IS NOT NULL", "password_hash != ''"];
  if (columnSet.has("status")) {
    filters.push("LOWER(COALESCE(status, 'active')) NOT IN ('deleted', 'disabled', 'inactive', 'banned', 'suspended')");
  }
  if (columnSet.has("is_active")) {
    filters.push("COALESCE(is_active, TRUE) = TRUE");
  }
  if (columnSet.has("is_deleted")) {
    filters.push("COALESCE(is_deleted, FALSE) = FALSE");
  }

  const [rows] = await pool.query<AdminPasswordRow[]>(
    `SELECT id, password_hash FROM admins WHERE ${filters.join(" AND ")} ORDER BY id ASC LIMIT 50`
  );
  return rows;
}

export async function verifyTemporaryChannelCheckPassword(password: string, rateLimitKey: string) {
  const cleanPassword = String(password || "");
  const key = rateLimitKey || "unknown";
  const distributedKey = redisKeys.rateLimit("channel-check", key);
  const distributed = await getDistributedRateLimitState(distributedKey, RATE_LIMIT_MAX_ATTEMPTS);
  const entry = distributed.available ? null : getAttempt(key);
  const current = nowMs();

  if (distributed.limited || (entry && entry.lockedUntil > current)) {
    const retryAfterMs = distributed.limited ? distributed.retryAfterMs : Math.max(0, (entry?.lockedUntil || 0) - current);
    return {
      ok: false as const,
      rateLimited: true,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  if (!cleanPassword) {
    await recordFailedAttempt(key, distributedKey, distributed.available);
    return { ok: false as const, rateLimited: false };
  }

  const admins = await getAdminPasswordRows();
  for (const admin of admins) {
    if (!admin.password_hash) continue;
    const matches = await bcrypt.compare(cleanPassword, admin.password_hash);
    if (matches) {
      await clearAttempts(key, distributedKey);
      return { ok: true as const, adminId: Number(admin.id) };
    }
  }

  await recordFailedAttempt(key, distributedKey, distributed.available);
  return { ok: false as const, rateLimited: false };
}

export function formatCountdown(totalMs: number) {
  const seconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
