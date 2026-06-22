import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

const MONETAG_NETWORK = "Monetag";
const DEFAULT_ALLOWED_OPPORTUNITY = 15;
const DELAYED_ALLOWED_OPPORTUNITY = 20;

type StateRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  network_name: string;
  telegram_user_id: string | number | null;
  opportunity_count: number;
  consecutive_user_count: number;
  last_telegram_user_id: string | number | null;
  next_allowed_opportunity: number;
  locked_until: Date | string | null;
};

type Executor = typeof pool | PoolConnection;

export type MonetagProtectionState = {
  allowed: boolean;
  reason: "allowed" | "waiting" | "delayed" | "locked";
  opportunity_count: number;
  next_allowed_opportunity: number;
  locked_until: string | null;
  consecutive_user_count: number;
  last_telegram_user_id: string | null;
};

function toDateString(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isFuture(value: Date | string | null) {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

async function ensureState(executor: Executor, miniappId: number | string) {
  await executor.query(
    `INSERT IGNORE INTO miniapp_network_frequency_state
      (miniapp_id, network_name, opportunity_count, consecutive_user_count, next_allowed_opportunity)
     VALUES (?, ?, 0, 0, ?)`,
    [miniappId, MONETAG_NETWORK, DEFAULT_ALLOWED_OPPORTUNITY]
  );
}

async function getStateForUpdate(executor: Executor, miniappId: number | string) {
  const [rows] = await executor.query<StateRow[]>(
    "SELECT * FROM miniapp_network_frequency_state WHERE miniapp_id = ? AND network_name = ? FOR UPDATE",
    [miniappId, MONETAG_NETWORK]
  );

  return rows[0];
}

function toProtectionState(row: StateRow): MonetagProtectionState {
  const locked = isFuture(row.locked_until);
  const opportunityCount = Number(row.opportunity_count || 0);
  const nextAllowedOpportunity = Number(row.next_allowed_opportunity || DEFAULT_ALLOWED_OPPORTUNITY);

  if (locked) {
    return {
      allowed: false,
      reason: "locked",
      opportunity_count: opportunityCount,
      next_allowed_opportunity: nextAllowedOpportunity,
      locked_until: toDateString(row.locked_until),
      consecutive_user_count: Number(row.consecutive_user_count || 0),
      last_telegram_user_id: row.last_telegram_user_id ? String(row.last_telegram_user_id) : null,
    };
  }

  const allowed = opportunityCount >= nextAllowedOpportunity;
  return {
    allowed,
    reason: allowed ? "allowed" : nextAllowedOpportunity === DELAYED_ALLOWED_OPPORTUNITY ? "delayed" : "waiting",
    opportunity_count: opportunityCount,
    next_allowed_opportunity: nextAllowedOpportunity,
    locked_until: null,
    consecutive_user_count: Number(row.consecutive_user_count || 0),
    last_telegram_user_id: row.last_telegram_user_id ? String(row.last_telegram_user_id) : null,
  };
}

export async function recordMiniappAdOpportunity(miniappId: number | string, telegramUserId: number | string, conn?: PoolConnection) {
  const executor = conn || pool;
  await ensureState(executor, miniappId);
  const row = await getStateForUpdate(executor, miniappId);
  const userId = String(telegramUserId);
  const lastUserId = row.last_telegram_user_id ? String(row.last_telegram_user_id) : null;
  const consecutiveUserCount = lastUserId === userId ? Number(row.consecutive_user_count || 0) + 1 : 1;
  const nextAllowedOpportunity = consecutiveUserCount >= 2 ? DELAYED_ALLOWED_OPPORTUNITY : DEFAULT_ALLOWED_OPPORTUNITY;
  const shouldLock = consecutiveUserCount >= 3 && !isFuture(row.locked_until);

  await executor.query(
    `UPDATE miniapp_network_frequency_state
     SET telegram_user_id = ?,
       opportunity_count = opportunity_count + 1,
       consecutive_user_count = ?,
       last_telegram_user_id = ?,
       next_allowed_opportunity = ?,
       locked_until = CASE WHEN ? THEN DATE_ADD(NOW(), INTERVAL 1 HOUR) ELSE locked_until END,
       last_seen_at = NOW()
     WHERE id = ?`,
    [userId, consecutiveUserCount, userId, nextAllowedOpportunity, shouldLock ? 1 : 0, row.id]
  );

  const updated = await getStateForUpdate(executor, miniappId);
  return toProtectionState(updated);
}

export async function canShowMonetag(miniappId: number | string, _telegramUserId: number | string, conn?: PoolConnection) {
  const executor = conn || pool;
  await ensureState(executor, miniappId);
  const row = await getStateForUpdate(executor, miniappId);

  if (row.locked_until && !isFuture(row.locked_until)) {
    await executor.query(
      "UPDATE miniapp_network_frequency_state SET locked_until = NULL WHERE id = ?",
      [row.id]
    );
    const unlocked = await getStateForUpdate(executor, miniappId);
    return toProtectionState(unlocked);
  }

  return toProtectionState(row);
}

export async function recordMonetagShown(miniappId: number | string, telegramUserId: number | string, conn?: PoolConnection) {
  const executor = conn || pool;
  await ensureState(executor, miniappId);
  const row = await getStateForUpdate(executor, miniappId);

  await executor.query(
    `UPDATE miniapp_network_frequency_state
     SET telegram_user_id = ?,
       opportunity_count = 0,
       consecutive_user_count = 0,
       last_telegram_user_id = NULL,
       next_allowed_opportunity = ?,
       locked_until = NULL,
       last_seen_at = NOW()
     WHERE id = ?`,
    [telegramUserId, DEFAULT_ALLOWED_OPPORTUNITY, row.id]
  );

  const updated = await getStateForUpdate(executor, miniappId);
  return toProtectionState(updated);
}

export async function getMonetagProtectionState(miniappId: number | string) {
  await ensureState(pool, miniappId);
  const [rows] = await pool.query<StateRow[]>(
    "SELECT * FROM miniapp_network_frequency_state WHERE miniapp_id = ? AND network_name = ?",
    [miniappId, MONETAG_NETWORK]
  );

  return toProtectionState(rows[0]);
}

export function maskTelegramUserId(value: string | number | null | undefined) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 4) return "****";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}
