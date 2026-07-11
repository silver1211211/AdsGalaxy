import "server-only";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = Pool | PoolConnection;

export const BOT_USER_VERIFIED_STATUS = "active";
export const BOT_USER_PENDING_STATUS = "pending_verification";
export const BOT_USER_BLOCKED_STATUSES = ["blocked_bot", "user_not_found", "chat_not_found", "unreachable"] as const;
export const BOT_DISABLED_STATUSES = ["paused", "rejected", "deleted", "token_invalid", "bot_deleted", "unreachable", "suspended"] as const;

export function botOperationalCondition(alias = "b") {
  return `${alias}.status = 'active' AND ${alias}.is_deleted = FALSE AND COALESCE(${alias}.health_status, 'active') IN ('active', 'healthy')`;
}

export function botUserVerifiedReachableCondition(alias = "bu") {
  return `${alias}.is_active = TRUE AND ${alias}.status = '${BOT_USER_VERIFIED_STATUS}'`;
}

export function botUserPendingVerificationCondition(alias = "bu") {
  return `${alias}.status = '${BOT_USER_PENDING_STATUS}'`;
}

export function botOwnerExclusionCondition(userAlias = "bu", botAlias = "b") {
  return `NOT EXISTS (SELECT 1 FROM users bot_owner WHERE bot_owner.id = ${botAlias}.user_id AND CAST(bot_owner.telegram_id AS CHAR) = CAST(${userAlias}.chat_id AS CHAR))`;
}

export function botUserActiveCondition(userAlias = "bu", botAlias = "b") {
  return `${botOperationalCondition(botAlias)} AND ${botUserVerifiedReachableCondition(userAlias)} AND ${userAlias}.chat_id IS NOT NULL AND ${userAlias}.chat_id != ''`;
}

export function botUserBlockedCondition(alias = "bu") {
  return `(${alias}.is_active = FALSE AND ${alias}.status <> '${BOT_USER_PENDING_STATUS}') OR ${alias}.status IN (${BOT_USER_BLOCKED_STATUSES.map((status) => `'${status}'`).join(",")})`;
}

export function botUserBroadcastEligibleCondition(userAlias = "bu", botAlias = "b") {
  return `${botUserActiveCondition(userAlias, botAlias)} AND ${botOwnerExclusionCondition(userAlias, botAlias)}`;
}

export function botUserCountExpressions(botAlias = "b") {
  return {
    total: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id)`,
    active: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id AND ${botUserActiveCondition("bu", botAlias)})`,
    verified: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id AND ${botUserVerifiedReachableCondition("bu")})`,
    reachable: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id AND ${botUserVerifiedReachableCondition("bu")})`,
    blocked: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id AND (${botUserBlockedCondition("bu")}))`,
    pending: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id AND ${botUserPendingVerificationCondition("bu")})`,
    deliveryEligible: `(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = ${botAlias}.id AND ${botUserBroadcastEligibleCondition("bu", botAlias)})`,
  };
}

export async function getBotAudienceStats(botId: number | string, db: Db = pool) {
  const [rows] = await db.query<Array<RowDataPacket & {
    total_users: number;
    active_users: number;
    verified_users: number;
    reachable_users: number;
    blocked_users: number;
    pending_verification: number;
    integration_users: number;
    manually_imported: number;
  }>>(
    `SELECT
       COUNT(*) AS total_users,
       SUM(CASE WHEN ${botUserActiveCondition("bu", "b")} THEN 1 ELSE 0 END) AS active_users,
       SUM(CASE WHEN ${botUserVerifiedReachableCondition("bu")} THEN 1 ELSE 0 END) AS verified_users,
       SUM(CASE WHEN ${botUserVerifiedReachableCondition("bu")} THEN 1 ELSE 0 END) AS reachable_users,
       SUM(CASE WHEN ${botUserBlockedCondition("bu")} THEN 1 ELSE 0 END) AS blocked_users,
       SUM(CASE WHEN ${botUserPendingVerificationCondition("bu")} THEN 1 ELSE 0 END) AS pending_verification,
       SUM(CASE WHEN COALESCE(bu.source, 'legacy') = 'integration' OR bu.integration_first_seen_at IS NOT NULL THEN 1 ELSE 0 END) AS integration_users,
       SUM(CASE WHEN COALESCE(bu.source, 'legacy') <> 'integration' AND bu.integration_first_seen_at IS NULL THEN 1 ELSE 0 END) AS manually_imported
     FROM bot_users bu
     JOIN bots b ON b.id = bu.bot_id
     WHERE bu.bot_id = ?`,
    [botId]
  );
  const row = rows[0] || {};
  return {
    total_users: Number(row.total_users || 0),
    active_users: Number(row.active_users || 0),
    verified_users: Number(row.verified_users || 0),
    reachable_users: Number(row.reachable_users || 0),
    blocked_users: Number(row.blocked_users || 0),
    pending_verification: Number(row.pending_verification || 0),
    integration_users: Number(row.integration_users || 0),
    manually_imported: Number(row.manually_imported || 0),
  };
}

export async function getGlobalBotAudienceStats(db: Db = pool) {
  const [rows] = await db.query<Array<RowDataPacket & {
    total_users: number;
    active_users: number;
    delivery_eligible_users: number;
    inactive_users: number;
  }>>(
    `SELECT
       COUNT(*) AS total_users,
       SUM(CASE WHEN ${botUserActiveCondition("bu", "b")} THEN 1 ELSE 0 END) AS active_users,
       SUM(CASE WHEN ${botUserBroadcastEligibleCondition("bu", "b")} THEN 1 ELSE 0 END) AS delivery_eligible_users,
       SUM(CASE WHEN (${botUserBlockedCondition("bu")}) OR b.status <> 'active' OR b.is_deleted = TRUE THEN 1 ELSE 0 END) AS inactive_users
     FROM bot_users bu
     JOIN bots b ON b.id = bu.bot_id`
  );
  const row = rows[0] || {};
  return {
    total_users: Number(row.total_users || 0),
    active_users: Number(row.active_users || 0),
    delivery_eligible_users: Number(row.delivery_eligible_users || 0),
    inactive_users: Number(row.inactive_users || 0),
  };
}
