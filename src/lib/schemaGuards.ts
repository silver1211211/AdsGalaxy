import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;

export async function columnExists(db: Db, table: string, column: string) {
  const [rows]: any = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
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
