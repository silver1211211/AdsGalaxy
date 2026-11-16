import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;
const columnCapabilityCache = new Map<string, boolean>();

export async function columnExists(db: Db, table: string, column: string) {
  const cacheKey = `${table}.${column}`;
  if (db === pool && columnCapabilityCache.has(cacheKey)) return columnCapabilityCache.get(cacheKey)!;
  const [rows]: any = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  const exists = rows.length > 0;
  if (db === pool) columnCapabilityCache.set(cacheKey, exists);
  return exists;
}

async function addColumnIfMissing(db: Db, table: string, column: string, definition: string) {
  if (await columnExists(db, table, column)) return;
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

export async function ensureClassicSettlementColumns(db: Db = pool) {
  await addColumnIfMissing(db, "campaigns", "cpc", "DECIMAL(18,8) NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "campaign_posts", "settled_clicks", "INT NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "campaign_posts", "settled_views", "INT NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "campaign_clicks", "post_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements", "advertiser_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements", "channel_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements", "publisher_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements", "clicks_count", "INT NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "ad_settlements", "publisher_reward", "DECIMAL(18,8) NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "ad_settlements_views", "advertiser_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements_views", "channel_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements_views", "publisher_id", "INT NULL");
  await addColumnIfMissing(db, "ad_settlements_views", "views_count", "INT NOT NULL DEFAULT 0");
}

export async function ensureWithdrawalSubmissionColumns(db: Db = pool) {
  await addColumnIfMissing(db, "withdrawals", "network", "VARCHAR(20) NULL");
  await addColumnIfMissing(db, "withdrawals", "address", "VARCHAR(255) NULL");
  await addColumnIfMissing(db, "withdrawals", "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await addColumnIfMissing(db, "withdrawals", "fee", "DECIMAL(18,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "withdrawals", "net_amount", "DECIMAL(18,8) NOT NULL DEFAULT 0");
}

/**
 * AdsGalaxy V1.01 readiness probe (read-only). Reports whether the prepared
 * migration 20261028_0158 has been applied. Nothing calls this on startup and
 * it never mutates the schema; later phases must consult it (together with the
 * CHANNEL_V101_ALLOCATION_ENABLED opt-in) before writing any V1.01 columns.
 */
export async function isChannelV101LedgerSchemaReady(db: Db = pool) {
  const [columns]: any = await db.query(
    `SELECT COUNT(*) AS present FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_allocation_ledger'
       AND COLUMN_NAME IN ('publisher_base_allocation','reserve_base_allocation','quality_adjustment_signed','quality_multiplier','split_publisher_percent','split_platform_percent','split_reserve_percent')`
  );
  const [tables]: any = await db.query(
    `SELECT COUNT(*) AS present FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('channel_reserve_treasury_ledger','channel_cpc_reserve_advances')`
  );
  return Number(columns[0]?.present) === 7 && Number(tables[0]?.present) === 2;
}

/**
 * AdsGalaxy V1.01 Phase 6 Unified Settlement readiness probe (read-only).
 * Confirms presence of all required tables and columns across Phases 2, 4, 5, and 6 migrations.
 */
export async function isChannelV101UnifiedSettlementSchemaReady(db: Db = pool): Promise<boolean> {
  try {
    const requiredTables = [
      "channel_allocation_ledger",
      "channel_reserve_treasury_ledger",
      "channel_cpc_reserve_advances",
      "channel_arr_transitions",
      "channel_cpc_reserve_advance_posts",
      "channel_reserve_treasury_control",
      "channel_unified_settlement_events",
    ];
    const [tableRows]: any = await db.query(
      `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?, ?, ?, ?, ?)`,
      requiredTables
    );
    if (Number(tableRows[0]?.count) < requiredTables.length) return false;

    const requiredColumns = ["unfunded_queue_amount", "post_id", "channel_id"];
    const [columnRows]: any = await db.query(
      `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_cpc_reserve_advances'
         AND COLUMN_NAME IN (?, ?, ?)`,
      requiredColumns
    );
    return Number(columnRows[0]?.count) >= 1;
  } catch {
    return false;
  }
}
