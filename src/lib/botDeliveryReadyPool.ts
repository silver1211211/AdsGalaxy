import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = Pool | PoolConnection;

export async function refreshBotDeliveryReadiness(botId: number | string, db: Db = pool) {
  await db.query(
    `INSERT INTO bot_delivery_ready_pool(bot_id,active_audience_count,ready)
     SELECT b.id,COUNT(bu.id),COUNT(bu.id)>0
     FROM bots b LEFT JOIN bot_users bu ON bu.bot_id=b.id AND bu.is_active=TRUE
       AND bu.status='active' AND bu.chat_id IS NOT NULL AND bu.chat_id<>''
     WHERE b.id=? GROUP BY b.id
     ON DUPLICATE KEY UPDATE active_audience_count=VALUES(active_audience_count),ready=VALUES(ready)`,
    [botId],
  );
}

export async function refreshBotDeliveryReadinessForUser(userId: number | string, db: Db = pool) {
  const [[row]] = await db.query<Array<RowDataPacket & { bot_id: number }>>(
    "SELECT bot_id FROM bot_users WHERE id=?",
    [userId],
  );
  if (row) await refreshBotDeliveryReadiness(row.bot_id, db);
}

export async function markBotReadyState(botId: number | string, ready: boolean, db: Db = pool) {
  await db.query(
    `INSERT INTO bot_delivery_ready_pool(bot_id,active_audience_count,ready)
     VALUES(?,0,?) ON DUPLICATE KEY UPDATE ready=VALUES(ready)`,
    [botId, ready ? 1 : 0],
  );
}
